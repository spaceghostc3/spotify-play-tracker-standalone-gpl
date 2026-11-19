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

CREATE TABLE playlist_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_uri TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  playlist_url TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
--> statement-breakpoint
ALTER TABLE plays ADD COLUMN context_uri TEXT;
--> statement-breakpoint
ALTER TABLE plays ADD COLUMN session_id INTEGER;
--> statement-breakpoint
ALTER TABLE plays ADD COLUMN ended_at INTEGER;
--> statement-breakpoint
ALTER TABLE plays ADD COLUMN artwork_url TEXT;
--> statement-breakpoint
ALTER TABLE tracker_status ADD COLUMN current_context_uri TEXT;
