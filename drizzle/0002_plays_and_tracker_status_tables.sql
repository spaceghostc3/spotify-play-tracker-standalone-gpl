-- Spotify Play Tracker - tracks your Spotify listening history, with full
-- per-playlist session reports.
-- Copyright (C) 2026 Robert Dreyer
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU General Public License for more details.
--
-- You should have received a copy of the GNU General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_uri TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artists TEXT NOT NULL DEFAULT '',
  spotify_url TEXT,
  duration_ms INTEGER,
  is_explicit INTEGER NOT NULL DEFAULT 0,
  playback_status TEXT NOT NULL DEFAULT 'PLAYING',
  progress_ms INTEGER,
  context_name TEXT,
  context_url TEXT,
  observed_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE tracker_status (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'never_checked',
  last_checked_at INTEGER,
  current_track_name TEXT,
  current_artists TEXT,
  current_track_url TEXT,
  current_playback_status TEXT,
  current_progress_ms INTEGER,
  current_duration_ms INTEGER,
  current_context_name TEXT,
  note TEXT
);
