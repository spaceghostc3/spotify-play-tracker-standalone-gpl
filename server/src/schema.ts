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

// Drizzle schema for the Spotify Play Tracker.
//
// `plays` is the permanent play history — one row per distinct play the
// tracker observes. It is never pruned: replacing the short FIFO rolling
// list on stats sites is the whole point.
// `playlist_sessions` groups consecutive plays that share one playlist
// context into a single listening session: opened when playback from a
// playlist is first observed, closed when the context changes or playback
// stops. Times are poll observations (~1 minute apart), so session and
// track start/end times are accurate to within about a minute.
// `tracker_status` is a single-row table (id = 1) holding the latest poll
// state: when the tracker last checked Spotify, whether it was connected,
// and a snapshot of the track seen at that check for the Now Playing card.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const plays = sqliteTable("plays", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackUri: text("track_uri").notNull(),
  trackName: text("track_name").notNull(),
  // Artist names joined with ", " for display; also searched as text.
  artists: text("artists").notNull().default(""),
  spotifyUrl: text("spotify_url"),
  durationMs: integer("duration_ms"),
  isExplicit: integer("is_explicit", { mode: "boolean" })
    .notNull()
    .default(false),
  playbackStatus: text("playback_status").notNull().default("PLAYING"),
  progressMs: integer("progress_ms"),
  contextName: text("context_name"),
  contextUrl: text("context_url"),
  // Spotify URI of the playback context (e.g. spotify:playlist:...). Only
  // playlist contexts open a playlist session.
  contextUri: text("context_uri"),
  // The playlist session this play belongs to, if any.
  sessionId: integer("session_id"),
  // Cover-art thumbnail URL from Spotify's public oEmbed endpoint for this
  // track, fetched once when the track is first seen. Null until fetched
  // (or when oEmbed has no art for the track).
  artworkUrl: text("artwork_url"),
  // When the tracker first observed this play.
  observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
  // Updated when a later poll sees the same track still playing.
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  // When this play stopped being the current track (a different track was
  // observed, or playback stopped). Null while it is the latest play.
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
});

export const playlistSessions = sqliteTable("playlist_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playlistUri: text("playlist_uri").notNull(),
  playlistName: text("playlist_name").notNull(),
  playlistUrl: text("playlist_url"),
  // First poll that observed playback from this playlist.
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  // Poll that observed the context change or stop that ended the session.
  // Null while the session is still open.
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
});

export const trackerStatus = sqliteTable("tracker_status", {
  id: integer("id").primaryKey(),
  // connected | not_connected | nothing_playing | error
  status: text("status").notNull().default("never_checked"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  currentTrackName: text("current_track_name"),
  currentArtists: text("current_artists"),
  currentTrackUrl: text("current_track_url"),
  currentPlaybackStatus: text("current_playback_status"),
  currentProgressMs: integer("current_progress_ms"),
  currentDurationMs: integer("current_duration_ms"),
  currentContextName: text("current_context_name"),
  currentContextUri: text("current_context_uri"),
  note: text("note"),
  // Legacy counter: consecutive checks that found nothing playing.
  // Superseded by inactiveChecks (migration 0005); no longer maintained.
  emptyChecks: integer("empty_checks").notNull().default(0),
  // Consecutive checks that found no ACTIVE playback: either nothing
  // playing at all, or a track present but paused. A Spotify session
  // left open (e.g. a closed browser tab) keeps reporting its last
  // track as paused forever, so paused checks must count too — only a
  // check that observes a track actually PLAYING resets this counter.
  inactiveChecks: integer("inactive_checks").notNull().default(0),
  // True once inactiveChecks reaches the auto-stop threshold (3): the
  // automatic every-minute checks stop spawning polls until a manual
  // check (the in-app "Resume checks" / "Check now" button, which passes
  // source: "manual") clears the pause and resets the counter.
  autoPaused: integer("auto_paused", { mode: "boolean" })
    .notNull()
    .default(false),
});
