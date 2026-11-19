/*
 * Spotify Play Tracker - tracks your Spotify listening history, with full
 * per-playlist session reports.
 * Copyright (C) 2026 Robert Dreyer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Spotify Web API client for the standalone tracker.
//
// Replaces the Muse connector CLI used by the hosted version. Uses the
// official Spotify Web API with a user-authorized refresh token:
//   GET /v1/me/player/currently-playing
// Credentials come from the environment (.env): SPOTIFY_CLIENT_ID and
// SPOTIFY_CLIENT_SECRET. The refresh token lives in spotify-tokens.json
// (written by `bun run auth`), or in SPOTIFY_REFRESH_TOKEN as a fallback.
// The access token is cached in memory and refreshed on demand; if
// Spotify rotates the refresh token, the new one is written back to the
// tokens file automatically.
//
// One difference from the connector payload: the Web API's `context`
// object has no playlist name, only type/uri/url. For playlist contexts
// this module fetches the name with GET /v1/playlists/{id}?fields=name
// (cached per playlist) so sessions keep their real names.
//
// Ad breaks are detected here too (see getNowPlayingObservation): when
// Spotify serves an ad, the payload carries no track item, which the
// hosted version's poll agent also had to be taught to distinguish from
// "nothing playing".

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..", "..");
const tokensFile =
  process.env.TRACKER_TOKENS_FILE ?? join(projectRoot, "spotify-tokens.json");
const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";

export type Observation =
  | {
      // An ad break: playback is running but Spotify is serving an ad
      // instead of a track. recordPlay treats this as active listening
      // (see actions.ts) — the ad is never logged as a play.
      status: "connected";
      ad_playing: true;
    }
  | {
      status: "connected";
      ad_playing?: false;
      track_uri: string;
      track_name: string;
      artists: string;
      spotify_url: string | null;
      duration_ms: number | null;
      is_explicit: boolean;
      playback_status: string;
      progress_ms: number | null;
      context_name: string | null;
      context_url: string | null;
      context_uri: string | null;
    }
  | { status: "not_connected"; note: string }
  | { status: "nothing_playing" };

type StoredTokens = { refresh_token: string };

let access: { token: string; expiresAt: number } | null = null;
const playlistNameCache = new Map<string, string>();

async function loadTokens(): Promise<StoredTokens | null> {
  try {
    if (existsSync(tokensFile)) {
      const raw = await readFile(tokensFile, "utf8");
      const data: unknown = JSON.parse(raw);
      if (
        data !== null &&
        typeof data === "object" &&
        "refresh_token" in data &&
        typeof (data as { refresh_token: unknown }).refresh_token === "string"
      ) {
        return { refresh_token: (data as { refresh_token: string }).refresh_token };
      }
    }
  } catch {
    // Fall through to the env fallback.
  }
  const envToken = process.env.SPOTIFY_REFRESH_TOKEN;
  return envToken ? { refresh_token: envToken } : null;
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await writeFile(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number; refresh_token?: string } | null> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (
    data === null ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof (data as { access_token: unknown }).access_token !== "string" ||
    !("expires_in" in data) ||
    typeof (data as { expires_in: unknown }).expires_in !== "number"
  ) {
    return null;
  }
  const out = data as {
    access_token: string;
    expires_in: number;
    refresh_token?: unknown;
  };
  return {
    access_token: out.access_token,
    expires_in: out.expires_in,
    refresh_token:
      typeof out.refresh_token === "string" ? out.refresh_token : undefined,
  };
}

async function getAccessToken(): Promise<string | null> {
  if (access && Date.now() < access.expiresAt - 30_000) return access.token;
  const stored = await loadTokens();
  if (!stored || !clientId || !clientSecret) return null;
  const data = await refreshAccessToken(stored.refresh_token);
  if (!data) return null;
  access = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  if (data.refresh_token && data.refresh_token !== stored.refresh_token) {
    try {
      await saveTokens({ refresh_token: data.refresh_token });
    } catch {
      // Token rotation persistence is best-effort; the in-memory access
      // token keeps working until it expires.
    }
  }
  return access.token;
}

async function fetchPlaylistName(
  playlistId: string,
  token: string,
): Promise<string | null> {
  const cached = playlistNameCache.get(playlistId);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      data !== null &&
      typeof data === "object" &&
      "name" in data &&
      typeof (data as { name: unknown }).name === "string"
    ) {
      const name = (data as { name: string }).name;
      playlistNameCache.set(playlistId, name);
      return name;
    }
  } catch {
    return null;
  }
  return null;
}

// Runs one now-playing observation. Returns an error string only for
// transport/API failures; "not_connected" and "nothing_playing" are normal
// outcomes that recordPlay stores as status updates.
export async function getNowPlayingObservation(): Promise<
  Observation | { error: string }
> {
  const token = await getAccessToken();
  if (!token) {
    return {
      status: "not_connected",
      note: "Spotify is not connected yet. Run `bun run auth` once to connect it.",
    };
  }
  let res: Response;
  try {
    res = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      { headers: { authorization: `Bearer ${token}` } },
    );
  } catch {
    return {
      error:
        "Couldn't reach Spotify just now. The next automatic check will retry.",
    };
  }
  if (res.status === 204) return { status: "nothing_playing" };
  if (res.status === 401) {
    // Refresh token rejected or revoked: clear the cache and tell the
    // user to reconnect rather than retrying with a dead token.
    access = null;
    return {
      error:
        "Spotify rejected the connection (token expired or revoked). Run `bun run auth` again to reconnect.",
    };
  }
  if (!res.ok) {
    return {
      error: `Spotify API error (HTTP ${res.status}). The next automatic check will retry.`,
    };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return {
      error:
        "Spotify returned an unreadable response. The next automatic check will retry.",
    };
  }
  if (data === null || typeof data !== "object") {
    return { status: "nothing_playing" };
  }
  // Ad detection (mirrors the hosted version's poll instructions): an
  // ad is playing when the payload's currently_playing_type is "ad",
  // the item is an ad (type "ad" or a spotify:ad: URI), or playback is
  // running (is_playing) but there is no track item with a name —
  // Spotify serves ads without one. This runs before the track checks
  // below so an ad can never be mistaken for "nothing playing" (which
  // used to count toward the auto-pause and close sessions mid-listen).
  const rawItem =
    "item" in data && data.item !== null && typeof data.item === "object"
      ? (data.item as { uri?: unknown; type?: unknown; name?: unknown })
      : null;
  const isAd =
    ("currently_playing_type" in data &&
      data.currently_playing_type === "ad") ||
    (rawItem !== null &&
      (rawItem.type === "ad" ||
        (typeof rawItem.uri === "string" &&
          rawItem.uri.startsWith("spotify:ad:")))) ||
    ("is_playing" in data &&
      data.is_playing === true &&
      (rawItem === null || typeof rawItem.name !== "string"));
  if (isAd) {
    return { status: "connected", ad_playing: true };
  }
  if (!("item" in data) || data.item === null || typeof data.item !== "object") {
    return { status: "nothing_playing" };
  }
  const item = data.item as {
    uri?: unknown;
    name?: unknown;
    artists?: unknown;
    external_urls?: unknown;
    duration_ms?: unknown;
    explicit?: unknown;
  };
  if (typeof item.uri !== "string" || typeof item.name !== "string") {
    return { status: "nothing_playing" };
  }
  const artistsRaw = Array.isArray(item.artists) ? item.artists : [];
  const artists = artistsRaw
    .map((a) =>
      a !== null && typeof a === "object" && "name" in a ? String(a.name) : "",
    )
    .filter(Boolean)
    .join(", ");
  const externalUrls =
    item.external_urls !== null && typeof item.external_urls === "object"
      ? (item.external_urls as { spotify?: unknown })
      : {};
  const context =
    "context" in data && data.context !== null && typeof data.context === "object"
      ? (data.context as {
          type?: unknown;
          uri?: unknown;
          external_urls?: unknown;
        })
      : null;
  let contextName: string | null = null;
  let contextUrl: string | null = null;
  let contextUri: string | null = null;
  if (context) {
    contextUri = typeof context.uri === "string" ? context.uri : null;
    const ctxUrls =
      context.external_urls !== null && typeof context.external_urls === "object"
        ? (context.external_urls as { spotify?: unknown })
        : {};
    contextUrl =
      typeof ctxUrls.spotify === "string" ? ctxUrls.spotify : null;
    if (context.type === "playlist" && contextUri) {
      const playlistId = contextUri.split(":").pop() ?? "";
      if (playlistId) {
        contextName = await fetchPlaylistName(playlistId, token);
      }
    }
  }
  const isPlaying =
    "is_playing" in data && data.is_playing === true ? true : false;
  return {
    status: "connected",
    track_uri: item.uri,
    track_name: item.name,
    artists,
    spotify_url:
      typeof externalUrls.spotify === "string" ? externalUrls.spotify : null,
    duration_ms:
      typeof item.duration_ms === "number" ? item.duration_ms : null,
    is_explicit: item.explicit === true,
    playback_status: isPlaying ? "PLAYING" : "PAUSED",
    progress_ms:
      "progress_ms" in data && typeof data.progress_ms === "number"
        ? data.progress_ms
        : null,
    context_name: contextName,
    context_url: contextUrl,
    context_uri: contextUri,
  };
}
