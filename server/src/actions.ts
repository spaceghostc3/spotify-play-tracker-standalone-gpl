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

// Actions for the standalone Spotify Play Tracker.
//
// Ported from the Muse-hosted version (server/src/actions.ts). The logic
// is unchanged; only the platform plumbing differs:
//   - ctx.db            -> a Drizzle + libSQL database passed in as `db`
//   - ctx.agent.spawnTask (Spotify connector CLI) -> getNowPlayingObservation()
//     in spotify.ts, which calls the Spotify Web API directly
//   - ctx.executePrivileged (oEmbed artwork) -> fetchTrackArtwork() in
//     artwork.ts, a plain fetch
//   - ctx.invalidateQueries() -> dropped (the browser client refetches
//     with react-query after each mutation)
//
// Data flow (one retrieval path):
//   refreshNowPlaying (manual button or the 1-minute timer) observes
//   Spotify once and hands the result to recordPlay, which validates,
//   dedupes, and stores. Auto-pause: recordPlay counts consecutive checks
//   that found no ACTIVE playback (inactiveChecks on the status row):
//   nothing playing at all, or a track present but paused. At 3 inactive
//   checks in a row recordPlay sets autoPaused, and refreshNowPlaying
//   then refuses further automatic polls — the timer keeps firing but
//   each run is a cheap no-op. Only a check that observes a track
//   actually PLAYING resets the counter. A manual check (source:
//   "manual" from the in-app button) is the restart path: it clears the
//   pause and the counter, then polls.
//   Ad breaks: when Spotify plays an ad, the Web API reports no track
//   item, so an ad used to look exactly like "nothing playing": each
//   check incremented inactiveChecks, closed the open playlist session
//   mid-listen, and three ad checks in a row auto-paused the tracker in
//   the middle of a session. spotify.ts now detects ads and reports
//   them as ad_playing observations. An ad check ends the interrupted
//   play at the ad time, keeps the open playlist session open across
//   the break, logs nothing, and resets inactiveChecks to 0 — an ad is
//   active listening, so a run of ads can no longer stop the tracker
//   mid-session. (Ported from the hosted version's 2026-11-04 fix.)
//   recordPlay also maintains playlist sessions: consecutive plays
//   sharing one playlist context (context.uri) are grouped into a
//   session row that opens when the playlist starts and closes when the
//   context changes or playback stops. listSessions additionally groups
//   fragments of one continuous listen that were split into separate
//   session rows (by an ad break, a pause, or a brief gap under ~30
//   minutes) into a single entry. All reads serve from the local
//   database only and render the last-checked time.
//
// Access control: this server binds to localhost by default (see
// server.ts) and carries no in-code authentication, mirroring the
// hosted version's owner-gating. Do not expose it beyond localhost
// without adding authentication first — viewers would inherit the
// same action surface, including deletePlay.

import { asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { fetchTrackArtwork, isSpotifyArtworkUrl } from "./artwork";
import type { Db } from "./db";
import * as schema from "./schema";
import { getNowPlayingObservation } from "./spotify";

export interface PlayOut {
  id: number;
  trackUri: string;
  trackName: string;
  artists: string;
  spotifyUrl: string | null;
  durationMs: number | null;
  isExplicit: boolean;
  playbackStatus: string;
  progressMs: number | null;
  contextName: string | null;
  contextUrl: string | null;
  contextUri: string | null;
  sessionId: number | null;
  artworkUrl: string | null;
  observedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
}

export interface StatusOut {
  status: string;
  lastCheckedAt: string | null;
  currentTrackName: string | null;
  currentArtists: string | null;
  currentTrackUrl: string | null;
  currentPlaybackStatus: string | null;
  currentProgressMs: number | null;
  currentDurationMs: number | null;
  currentContextName: string | null;
  currentContextUri: string | null;
  currentArtworkUrl: string | null;
  note: string | null;
  inactiveChecks: number;
  autoPaused: boolean;
}

export interface DashboardResponse {
  status: StatusOut;
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  recentPlays: PlayOut[];
}

export interface PlaysResponse {
  plays: PlayOut[];
  total: number;
}

export interface SessionOut {
  id: number;
  playlistUri: string;
  playlistName: string;
  playlistUrl: string | null;
  startedAt: string;
  endedAt: string | null;
  tracks: PlayOut[];
}

export interface SessionsResponse {
  sessions: SessionOut[];
  total: number;
}

export interface TopTrack {
  trackUri: string;
  trackName: string;
  artists: string;
  spotifyUrl: string | null;
  plays: number;
  lastPlayedAt: string;
  rankDelta: number | null;
}

export interface TopArtist {
  artist: string;
  plays: number;
  lastPlayedAt: string;
  rankDelta: number | null;
}

export interface DayCount {
  day: string;
  plays: number;
}

export interface ReportsResponse {
  periodDays: number;
  totalPlays: number;
  topTracks: TopTrack[];
  topArtists: TopArtist[];
  daily: DayCount[];
}

export interface RecordPlayResponse {
  recorded: boolean;
  deduped: boolean;
  playId: number | null;
}

export interface RefreshResponse {
  started: boolean;
  message: string;
  autoPaused: boolean;
}

export interface DeleteResponse {
  deleted: true;
}

type PlayRow = typeof schema.plays.$inferSelect;

function toPlay(row: PlayRow): PlayOut {
  return {
    id: row.id,
    trackUri: row.trackUri,
    trackName: row.trackName,
    artists: row.artists,
    spotifyUrl: row.spotifyUrl,
    durationMs: row.durationMs,
    isExplicit: row.isExplicit,
    playbackStatus: row.playbackStatus,
    progressMs: row.progressMs,
    contextName: row.contextName,
    contextUrl: row.contextUrl,
    contextUri: row.contextUri,
    sessionId: row.sessionId,
    // Host-checked on the way out as well as on the way in, so any row
    // stored before the artwork check existed can't serve a bad URL.
    artworkUrl: safeArtworkUrl(row.artworkUrl),
    observedAt: row.observedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

// Automatic checks pause after this many consecutive checks find
// nothing actively playing (nothing playing, or a track paused);
// a manual check restarts them.
const AUTO_PAUSE_THRESHOLD = 3;

// Fragments of one continuous playlist listen that were split by an ad
// break, a pause, or a brief gap in the checks are grouped into a single
// Sessions-tab entry when the idle gap between them is within this
// window. A genuinely separate listen after a longer idle gap stays its
// own entry.
const SESSION_MERGE_WINDOW_MS = 30 * 60 * 1000;

// Free-text fields (track name, artists, context name/URI, playback
// status, note) are capped at 1000 characters at the request boundary:
// real Spotify metadata is far shorter than that, and an unbounded text
// field is a storage/abuse hole. Anything longer fails validation and
// nothing is stored.
const textCap = z.string().max(1000);

// Artwork URLs are stored on play rows and rendered as <img src>, so
// they are host-checked: only https URLs on Spotify's image CDNs pass
// (see artwork.ts). Anything else is dropped to null wherever it would
// be stored or served, and the row renders its typographic tile.
function safeArtworkUrl(value: string | null): string | null {
  return value !== null && isSpotifyArtworkUrl(value) ? value : null;
}

// recordPlay's URL fields (spotify_url, context_url) are stored on play
// and session rows and later rendered as <a href> links, so they are
// validated as Spotify URLs at the action boundary: only https URLs on
// open.spotify.com pass. A non-Spotify URL fails validation and nothing
// is stored.
const spotifyUrlSchema = z
  .string()
  .max(2000)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return (
          parsed.protocol === "https:" && parsed.hostname === "open.spotify.com"
        );
      } catch {
        return false;
      }
    },
    { message: "must be an https://open.spotify.com URL" },
  )
  .nullable()
  .optional();

const listPlaysRequest = z.object({
  query: z.string().max(200).default(""),
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const listSessionsRequest = z.object({
  limit: z.number().int().positive().max(100).default(30),
  offset: z.number().int().min(0).default(0),
});

const getReportsRequest = z.object({
  // 0 = all time, otherwise a rolling window in days.
  periodDays: z.number().int().min(0).max(3650).default(30),
});

const recordPlayRequest = z.object({
  status: z.enum(["connected", "not_connected", "nothing_playing"]),
  // True when the check observed a Spotify ad break instead of a track.
  // Ads are active listening: they are not logged as plays, the open
  // playlist session stays open across them, and they reset (not
  // increment) the auto-pause inactive counter.
  ad_playing: z.boolean().default(false),
  track_uri: z.string().min(1).max(200).optional(),
  // Free-text fields capped at 1000 characters (see textCap above).
  track_name: textCap.min(1).optional(),
  artists: textCap.default(""),
  spotify_url: spotifyUrlSchema,
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  is_explicit: z.boolean().default(false),
  playback_status: textCap.default("PLAYING"),
  progress_ms: z.number().int().nonnegative().nullable().optional(),
  context_name: textCap.nullable().optional(),
  context_url: spotifyUrlSchema,
  context_uri: textCap.nullable().optional(),
  note: textCap.nullable().optional(),
});

const deletePlayRequest = z.object({ id: z.number().int().positive() });

const refreshNowPlayingRequest = z.object({
  // "cron" is the scheduled automatic check; "manual" is the in-app
  // button. The timer passes "cron"; the button passes "manual".
  source: z.enum(["cron", "manual"]).default("cron"),
});

export async function getDashboard(db: Db): Promise<DashboardResponse> {
  const statusRows = await db
    .select()
    .from(schema.trackerStatus)
    .where(eq(schema.trackerStatus.id, 1))
    .limit(1);
  const sRow = statusRows[0];

  const all = await db
    .select({
      trackUri: schema.plays.trackUri,
      artists: schema.plays.artists,
    })
    .from(schema.plays);
  const uniqueTracks = new Set(all.map((r) => r.trackUri)).size;
  const artistSet = new Set<string>();
  for (const r of all) {
    for (const name of r.artists.split(", ")) {
      const trimmed = name.trim();
      if (trimmed) artistSet.add(trimmed.toLowerCase());
    }
  }
  const recent = await db
    .select()
    .from(schema.plays)
    .orderBy(desc(schema.plays.observedAt), desc(schema.plays.id))
    .limit(15);
  // Artwork for the Now Playing card: the latest play's cached
  // thumbnail when it is the track the status snapshot describes.
  const latestPlay = recent[0];
  const currentArtworkUrl =
    sRow?.currentTrackName &&
    latestPlay &&
    latestPlay.trackName === sRow.currentTrackName
      ? safeArtworkUrl(latestPlay.artworkUrl)
      : null;
  const statusOut: StatusOut = sRow
    ? {
        status: sRow.status,
        lastCheckedAt: sRow.lastCheckedAt
          ? sRow.lastCheckedAt.toISOString()
          : null,
        currentTrackName: sRow.currentTrackName,
        currentArtists: sRow.currentArtists,
        currentTrackUrl: sRow.currentTrackUrl,
        currentPlaybackStatus: sRow.currentPlaybackStatus,
        currentProgressMs: sRow.currentProgressMs,
        currentDurationMs: sRow.currentDurationMs,
        currentContextName: sRow.currentContextName,
        currentContextUri: sRow.currentContextUri,
        currentArtworkUrl,
        note: sRow.note,
        inactiveChecks: sRow.inactiveChecks,
        autoPaused: sRow.autoPaused,
      }
    : {
        status: "never_checked",
        lastCheckedAt: null,
        currentTrackName: null,
        currentArtists: null,
        currentTrackUrl: null,
        currentPlaybackStatus: null,
        currentProgressMs: null,
        currentDurationMs: null,
        currentContextName: null,
        currentContextUri: null,
        currentArtworkUrl: null,
        note: null,
        inactiveChecks: 0,
        autoPaused: false,
      };
  return {
    status: statusOut,
    totalPlays: all.length,
    uniqueTracks,
    uniqueArtists: artistSet.size,
    recentPlays: recent.map(toPlay),
  };
}

export async function listPlays(
  db: Db,
  rawArgs: unknown,
): Promise<PlaysResponse> {
  const args = listPlaysRequest.parse(rawArgs);
  const q = args.query.trim().toLowerCase();
  let rows = await db
    .select()
    .from(schema.plays)
    .orderBy(desc(schema.plays.observedAt), desc(schema.plays.id))
    .limit(20000);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.trackName.toLowerCase().includes(q) ||
        r.artists.toLowerCase().includes(q) ||
        (r.contextName ?? "").toLowerCase().includes(q),
    );
  }
  const total = rows.length;
  const page = rows.slice(args.offset, args.offset + args.limit);
  return { plays: page.map(toPlay), total };
}

export async function listSessions(
  db: Db,
  rawArgs: unknown,
): Promise<SessionsResponse> {
  const args = listSessionsRequest.parse(rawArgs);
  const allSessions = await db
    .select()
    .from(schema.playlistSessions)
    .orderBy(
      desc(schema.playlistSessions.startedAt),
      desc(schema.playlistSessions.id),
    )
    .limit(5000);

  // Group fragments of one continuous listen into a single entry:
  // consecutive sessions for the same playlist whose idle gap is
  // within SESSION_MERGE_WINDOW_MS are one listen that was split by
  // an ad break, a pause, or a brief gap in the checks. A genuinely
  // separate listen after a longer idle gap stays its own entry.
  const chronological = [...allSessions].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id,
  );
  const groups: (typeof allSessions)[] = [];
  for (const s of chronological) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    if (
      group &&
      prev &&
      prev.playlistUri === s.playlistUri &&
      prev.endedAt !== null &&
      s.startedAt.getTime() - prev.endedAt.getTime() <= SESSION_MERGE_WINDOW_MS
    ) {
      group.push(s);
    } else {
      groups.push([s]);
    }
  }

  // Newest listen first, as before.
  groups.reverse();
  const total = groups.length;
  const page = groups.slice(args.offset, args.offset + args.limit);
  const sessions: SessionOut[] = [];
  for (const group of page) {
    const first = group[0];
    const lastFrag = group[group.length - 1];
    if (!first || !lastFrag) continue;
    const tracks: (typeof schema.plays.$inferSelect)[] = [];
    for (const frag of group) {
      const fragTracks = await db
        .select()
        .from(schema.plays)
        .where(eq(schema.plays.sessionId, frag.id))
        .orderBy(asc(schema.plays.observedAt), asc(schema.plays.id))
        .limit(500);
      tracks.push(...fragTracks);
    }
    tracks.sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.id - b.id,
    );
    sessions.push({
      id: first.id,
      playlistUri: first.playlistUri,
      // Freshest name/URL win: the playlist may have been renamed
      // between fragments.
      playlistName: lastFrag.playlistName,
      playlistUrl: lastFrag.playlistUrl ?? first.playlistUrl,
      startedAt: first.startedAt.toISOString(),
      endedAt: lastFrag.endedAt ? lastFrag.endedAt.toISOString() : null,
      tracks: tracks.map(toPlay),
    });
  }
  return { sessions, total };
}

export async function getReports(
  db: Db,
  rawArgs: unknown,
): Promise<ReportsResponse> {
  const args = getReportsRequest.parse(rawArgs);
  const rows = await db
    .select()
    .from(schema.plays)
    .orderBy(asc(schema.plays.observedAt))
    .limit(20000);
  const now = Date.now();
  const dayMs = 86400000;
  const periodMs = args.periodDays > 0 ? args.periodDays * dayMs : null;
  const start = periodMs !== null ? now - periodMs : null;
  const prevStart = periodMs !== null ? now - 2 * periodMs : null;

  const inCurrent = (t: number) => start === null || t >= start;
  const inPrev = (t: number) =>
    prevStart !== null && start !== null && t >= prevStart && t < start;

  type TrackAgg = {
    trackUri: string;
    trackName: string;
    artists: string;
    spotifyUrl: string | null;
    plays: number;
    lastPlayedAt: number;
  };
  const curTracks = new Map<string, TrackAgg>();
  const prevTracks = new Map<string, number>();
  const curArtists = new Map<
    string,
    { artist: string; plays: number; lastPlayedAt: number }
  >();
  const prevArtists = new Map<string, number>();
  let totalPlays = 0;

  for (const r of rows) {
    const t = r.observedAt.getTime();
    if (inCurrent(t)) {
      totalPlays += 1;
      const existing = curTracks.get(r.trackUri);
      if (existing) {
        existing.plays += 1;
        existing.lastPlayedAt = Math.max(existing.lastPlayedAt, t);
      } else {
        curTracks.set(r.trackUri, {
          trackUri: r.trackUri,
          trackName: r.trackName,
          artists: r.artists,
          spotifyUrl: r.spotifyUrl,
          plays: 1,
          lastPlayedAt: t,
        });
      }
      for (const name of r.artists.split(", ")) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        const a = curArtists.get(key);
        if (a) {
          a.plays += 1;
          a.lastPlayedAt = Math.max(a.lastPlayedAt, t);
        } else {
          curArtists.set(key, {
            artist: trimmed,
            plays: 1,
            lastPlayedAt: t,
          });
        }
      }
    } else if (inPrev(t)) {
      prevTracks.set(r.trackUri, (prevTracks.get(r.trackUri) ?? 0) + 1);
      for (const name of r.artists.split(", ")) {
        const trimmed = name.trim().toLowerCase();
        if (!trimmed) continue;
        prevArtists.set(trimmed, (prevArtists.get(trimmed) ?? 0) + 1);
      }
    }
  }

  const rankMap = (counts: Map<string, number>) => {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const map = new Map<string, number>();
    sorted.forEach(([key], i) => map.set(key, i + 1));
    return map;
  };
  const prevTrackRanks = rankMap(prevTracks);
  const prevArtistRanks = rankMap(prevArtists);

  const topTracks: TopTrack[] = [...curTracks.values()]
    .sort((a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 25)
    .map((t, i) => {
      const prevRank = prevTrackRanks.get(t.trackUri);
      return {
        trackUri: t.trackUri,
        trackName: t.trackName,
        artists: t.artists,
        spotifyUrl: t.spotifyUrl,
        plays: t.plays,
        lastPlayedAt: new Date(t.lastPlayedAt).toISOString(),
        rankDelta:
          periodMs === null || prevRank === undefined
            ? null
            : prevRank - (i + 1),
      };
    });

  const topArtists: TopArtist[] = [...curArtists.values()]
    .sort((a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 25)
    .map((a, i) => {
      const prevRank = prevArtistRanks.get(a.artist.toLowerCase());
      return {
        artist: a.artist,
        plays: a.plays,
        lastPlayedAt: new Date(a.lastPlayedAt).toISOString(),
        rankDelta:
          periodMs === null || prevRank === undefined
            ? null
            : prevRank - (i + 1),
      };
    });

  // Daily buckets for the last 14 days (server-local bucketing by UTC
  // date key; the client labels the axis by date only).
  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, 0);
  }
  for (const r of rows) {
    const key = r.observedAt.toISOString().slice(0, 10);
    if (dailyMap.has(key)) {
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
    }
  }
  const daily: DayCount[] = [...dailyMap.entries()].map(([day, plays]) => ({
    day,
    plays,
  }));

  return {
    periodDays: args.periodDays,
    totalPlays,
    topTracks,
    topArtists,
    daily,
  };
}

export async function recordPlay(
  db: Db,
  rawArgs: unknown,
): Promise<RecordPlayResponse> {
  const args = recordPlayRequest.parse(rawArgs);
  const now = new Date();
  let recorded = false;
  let deduped = false;
  let playId: number | null = null;

  const hasTrack =
    args.status === "connected" && args.track_uri && args.track_name;
  // Defense in depth: if an ad ever arrives dressed as a track (ad
  // items can carry a name), a spotify:ad: URI still means ad break —
  // ads must never become play rows.
  const adBreak =
    args.ad_playing ||
    (typeof args.track_uri === "string" &&
      args.track_uri.startsWith("spotify:ad:"));
  const trackObserved = !adBreak && Boolean(hasTrack);
  const isPlaylistContext = (uri: string | null | undefined) =>
    typeof uri === "string" && uri.startsWith("spotify:playlist:");

  // The currently open playlist session, if any (at most one exists:
  // sessions are closed as soon as the context changes or stops).
  const openRows = await db
    .select()
    .from(schema.playlistSessions)
    .where(isNull(schema.playlistSessions.endedAt))
    .orderBy(desc(schema.playlistSessions.id))
    .limit(1);
  let openSession = openRows[0] ?? null;

  const closeOpenSession = async () => {
    if (!openSession) return;
    await db
      .update(schema.playlistSessions)
      .set({ endedAt: now })
      .where(eq(schema.playlistSessions.id, openSession.id));
    openSession = null;
  };

  const latestRows = await db
    .select()
    .from(schema.plays)
    .orderBy(desc(schema.plays.observedAt), desc(schema.plays.id))
    .limit(1);
  const last = latestRows[0];

  // Playback stopped or moved out of the playlist context: the latest
  // play ends at this check. An ad break also ends the interrupted
  // track here — the track really did stop when the ad started — but
  // unlike a stop, an ad never closes the open playlist session: the
  // listen continues on the other side of the break.
  if (
    last &&
    last.endedAt === null &&
    (!trackObserved ||
      (last.sessionId !== null && args.context_uri !== last.contextUri))
  ) {
    await db
      .update(schema.plays)
      .set({ endedAt: now })
      .where(eq(schema.plays.id, last.id));
  }
  if (
    openSession &&
    !adBreak &&
    (!trackObserved || args.context_uri !== openSession.playlistUri)
  ) {
    await closeOpenSession();
  }

  if (trackObserved) {
    const trackUri = args.track_uri as string;
    const trackName = args.track_name as string;

    // Session bookkeeping: a playlist-context track belongs to the
    // open session for that playlist, opening one if needed.
    let sessionId: number | null = null;
    if (isPlaylistContext(args.context_uri)) {
      if (!openSession) {
        const insertedSession = await db
          .insert(schema.playlistSessions)
          .values({
            playlistUri: args.context_uri as string,
            playlistName: args.context_name ?? "Playlist",
            playlistUrl: args.context_url ?? null,
            startedAt: now,
          })
          .returning({ id: schema.playlistSessions.id });
        const newId = insertedSession[0]?.id ?? null;
        if (newId !== null) {
          openSession = {
            id: newId,
            playlistUri: args.context_uri as string,
            playlistName: args.context_name ?? "Playlist",
            playlistUrl: args.context_url ?? null,
            startedAt: now,
            endedAt: null,
          };
        }
      }
      sessionId = openSession ? openSession.id : null;
      if (openSession && args.context_name) {
        // Keep the freshest playlist name on the open session.
        await db
          .update(schema.playlistSessions)
          .set({ playlistName: args.context_name })
          .where(eq(schema.playlistSessions.id, openSession.id));
      }
    }

    if (last && last.trackUri === trackUri && last.endedAt === null) {
      const elapsed = now.getTime() - last.observedAt.getTime();
      const duration = last.durationMs ?? args.duration_ms ?? 0;
      // A paused observation of the same track whose progress has
      // not advanced past where the stored play left it is the
      // same play sitting paused, however long it has been sitting:
      // a session left open in Spotify reports its last track as
      // paused at a frozen progress indefinitely, and the elapsed
      // window alone would re-log it as a fresh play every
      // duration + 2 minutes. A much lower progress than stored
      // means the track was restarted, so that falls through to a
      // new play; so does a paused observation whose progress moved
      // well past the stored progress (it played on and re-paused
      // beyond a full play's span — the elapsed window decides).
      const progressNow = args.progress_ms ?? null;
      const progressPrev = last.progressMs;
      const samePlayPaused =
        args.playback_status !== "PLAYING" &&
        (progressNow === null ||
          progressPrev === null ||
          (progressNow <= progressPrev + 15000 &&
            progressNow + 30000 >= progressPrev));
      // Same track still in progress (or paused) since the last poll:
      // extend the existing play instead of logging a duplicate.
      if (
        duration === 0 ||
        elapsed <= duration + 120000 ||
        samePlayPaused
      ) {
        await db
          .update(schema.plays)
          .set({
            lastSeenAt: now,
            progressMs: args.progress_ms ?? last.progressMs,
            playbackStatus: args.playback_status,
            contextName: args.context_name ?? last.contextName,
            contextUrl: args.context_url ?? last.contextUrl,
            contextUri: args.context_uri ?? last.contextUri,
            sessionId: last.sessionId ?? sessionId,
          })
          .where(eq(schema.plays.id, last.id));
        deduped = true;
        playId = last.id;
      }
    }
    if (!deduped) {
      // A different track takes over: the previous play ends now.
      if (last && last.endedAt === null) {
        await db
          .update(schema.plays)
          .set({ endedAt: now })
          .where(eq(schema.plays.id, last.id));
      }
      // Reuse artwork already cached for this track, if any — but
      // only a URL that passes the Spotify-CDN host check (see
      // safeArtworkUrl above); anything else is dropped.
      const artRows = await db
        .select({ artworkUrl: schema.plays.artworkUrl })
        .from(schema.plays)
        .where(eq(schema.plays.trackUri, trackUri))
        .limit(50);
      let artworkUrl =
        artRows.find(
          (r) => r.artworkUrl !== null && isSpotifyArtworkUrl(r.artworkUrl),
        )?.artworkUrl ?? null;
      if (artworkUrl === null && args.spotify_url) {
        try {
          artworkUrl = await fetchTrackArtwork(args.spotify_url);
        } catch {
          // Artwork is decorative: a failed lookup just leaves the
          // typographic tile in place.
          artworkUrl = null;
        }
      }
      const inserted = await db
        .insert(schema.plays)
        .values({
          trackUri,
          trackName,
          artists: args.artists,
          spotifyUrl: args.spotify_url ?? null,
          durationMs: args.duration_ms ?? null,
          isExplicit: args.is_explicit,
          playbackStatus: args.playback_status,
          progressMs: args.progress_ms ?? null,
          contextName: args.context_name ?? null,
          contextUrl: args.context_url ?? null,
          contextUri: args.context_uri ?? null,
          sessionId,
          artworkUrl,
          observedAt: now,
          lastSeenAt: now,
        })
        .returning({ id: schema.plays.id });
      recorded = true;
      playId = inserted[0]?.id ?? null;
      if (artworkUrl !== null) {
        // Backfill earlier plays of the same track that have no art.
        const stale = await db
          .select({ id: schema.plays.id })
          .from(schema.plays)
          .where(eq(schema.plays.trackUri, trackUri))
          .limit(200);
        for (const row of stale) {
          await db
            .update(schema.plays)
            .set({ artworkUrl })
            .where(eq(schema.plays.id, row.id));
        }
      }
    }
  }

  // Auto-pause bookkeeping: only a check that observes a track
  // actually PLAYING resets the inactive counter (and clears any
  // pause). A check that found nothing playing — or a track sitting
  // paused, which is what a Spotify session left open after its tab
  // or app closed reports forever — increments it, and at the
  // threshold the automatic checks pause until a manual check
  // restarts them. An ad break resets the counter instead: an ad is
  // active listening (playback is running and the user is there),
  // and consecutive ad slots routinely run longer than the three
  // checks that used to auto-pause the tracker mid-session.
  // Not-connected checks leave the counter alone — a dropped
  // connection is not evidence that listening stopped.
  const prevStatusRows = await db
    .select()
    .from(schema.trackerStatus)
    .where(eq(schema.trackerStatus.id, 1))
    .limit(1);
  const prevInactive = prevStatusRows[0]?.inactiveChecks ?? 0;
  const prevPaused = prevStatusRows[0]?.autoPaused ?? false;
  const activelyPlaying =
    trackObserved && args.playback_status === "PLAYING";
  let inactiveChecks = prevInactive;
  let autoPaused = prevPaused;
  if (activelyPlaying) {
    inactiveChecks = 0;
    autoPaused = false;
  } else if (adBreak) {
    inactiveChecks = 0;
  } else if (trackObserved || args.status === "nothing_playing") {
    inactiveChecks = prevInactive + 1;
    if (inactiveChecks >= AUTO_PAUSE_THRESHOLD) autoPaused = true;
  }

  const statusValues = {
    status: adBreak ? "ad_break" : args.status,
    lastCheckedAt: now,
    currentTrackName: trackObserved ? (args.track_name as string) : null,
    currentArtists: trackObserved ? args.artists : null,
    currentTrackUrl: trackObserved ? (args.spotify_url ?? null) : null,
    currentPlaybackStatus: trackObserved ? args.playback_status : null,
    currentProgressMs: trackObserved ? (args.progress_ms ?? null) : null,
    currentDurationMs: trackObserved ? (args.duration_ms ?? null) : null,
    currentContextName: trackObserved ? (args.context_name ?? null) : null,
    currentContextUri: trackObserved ? (args.context_uri ?? null) : null,
    note: args.note ?? null,
    inactiveChecks,
    autoPaused,
  };
  await db
    .insert(schema.trackerStatus)
    .values({ id: 1, ...statusValues })
    .onConflictDoUpdate({
      target: schema.trackerStatus.id,
      set: statusValues,
    });

  return { recorded, deduped, playId };
}

export async function deletePlay(
  db: Db,
  rawArgs: unknown,
): Promise<DeleteResponse> {
  const args = deletePlayRequest.parse(rawArgs);
  await db.delete(schema.plays).where(eq(schema.plays.id, args.id));
  return { deleted: true };
}

export async function refreshNowPlaying(
  db: Db,
  rawArgs: unknown,
): Promise<RefreshResponse> {
  const args = refreshNowPlayingRequest.parse(rawArgs);
  const statusRows = await db
    .select()
    .from(schema.trackerStatus)
    .where(eq(schema.trackerStatus.id, 1))
    .limit(1);
  const statusRow = statusRows[0];
  const wasPaused = statusRow?.autoPaused ?? false;

  if (wasPaused && args.source === "cron") {
    // Paused after AUTO_PAUSE_THRESHOLD consecutive inactive checks:
    // automatic polls stop here until a manual check restarts them.
    return {
      started: false,
      autoPaused: true,
      message:
        "Automatic checks are paused after three checks in a row found nothing actively playing. A manual check restarts them.",
    };
  }

  if (wasPaused && args.source === "manual") {
    // Manual restart: clear the pause and the inactive counter up
    // front, so the automatic checks resume even if this poll's
    // recordPlay lands after the next timer tick.
    await db
      .update(schema.trackerStatus)
      .set({ autoPaused: false, inactiveChecks: 0 })
      .where(eq(schema.trackerStatus.id, 1));
  }

  // Unlike the hosted version, where a poll agent reported back
  // asynchronously, the standalone check runs inline: the result is
  // already stored by the time this returns.
  const observation = await getNowPlayingObservation();
  if ("error" in observation) {
    return { started: false, autoPaused: false, message: observation.error };
  }
  await recordPlay(db, observation);
  const afterRows = await db
    .select()
    .from(schema.trackerStatus)
    .where(eq(schema.trackerStatus.id, 1))
    .limit(1);
  const autoPaused = afterRows[0]?.autoPaused ?? false;

  let message: string;
  if (observation.status === "not_connected") {
    message =
      "Spotify isn't connected yet. Run `bun run auth` once to connect it.";
  } else if (observation.status === "nothing_playing") {
    message = "Checked — nothing playing right now.";
  } else if (observation.ad_playing) {
    message =
      "Checked — Spotify is playing an ad. It isn't logged as a play, and any open playlist session stays open across the break.";
  } else {
    message = `Checked — now playing "${observation.track_name}" by ${observation.artists || "unknown artist"}.`;
  }
  if (wasPaused && args.source === "manual") {
    message = `Tracking restarted — automatic checks are back on. ${message}`;
  }
  return { started: true, autoPaused, message };
}
