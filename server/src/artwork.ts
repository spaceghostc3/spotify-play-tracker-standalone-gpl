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

// Cover art for the Spotify Play Tracker.
//
// The Spotify now-playing payload carries no album artwork, so cover art
// comes from Spotify's public oEmbed endpoint:
//   GET https://open.spotify.com/oembed?url=<track page URL>
// returns JSON with a `thumbnail_url` (300x300). The returned URL is
// stored on the play row and rendered as an <img src>, so it is
// host-checked here first: only https URLs on Spotify's image CDNs —
// i.scdn.co and the image-cdn-*.spotifycdn.com mirrors the oEmbed
// endpoint returns — pass; anything else becomes null. Returns null on
// any failure; artwork is decorative, so a miss just leaves the
// typographic tile in place.

// Kept in sync with the same check in actions.ts.
export function isSpotifyArtworkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return host.endsWith(".scdn.co") || host.endsWith(".spotifycdn.com");
  } catch {
    return false;
  }
}

export async function fetchTrackArtwork(
  spotifyUrl: string,
): Promise<string | null> {
  let trackUrl: string;
  try {
    const parsed = new URL(spotifyUrl);
    if (parsed.hostname !== "open.spotify.com") return null;
    trackUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      data !== null &&
      typeof data === "object" &&
      "thumbnail_url" in data &&
      typeof (data as { thumbnail_url: unknown }).thumbnail_url === "string"
    ) {
      const thumbnail = (data as { thumbnail_url: string }).thumbnail_url;
      return isSpotifyArtworkUrl(thumbnail) ? thumbnail : null;
    }
    return null;
  } catch {
    return null;
  }
}
