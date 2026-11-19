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

// SQLite database for the standalone tracker (Drizzle + libSQL).
//
// The database file defaults to ./tracker.db in the project root
// (TRACKER_DB_FILE overrides it). On startup, drizzle migrations in
// drizzle/0001..0005 are applied in order, tracked in a _migrations
// table. A database copied from the Muse-hosted version (app.db) is
// detected by its existing `plays` table and marked fully migrated, so
// an existing listening history carries over untouched.

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

const projectRoot = join(import.meta.dir, "..", "..");
const dbFile = process.env.TRACKER_DB_FILE ?? join(projectRoot, "tracker.db");
const drizzleDir = join(projectRoot, "drizzle");

const MIGRATION_FILES = [
  "0001_initial.sql",
  "0002_plays_and_tracker_status_tables.sql",
  "0003_playlist_sessions_and_track_artwork.sql",
  "0004_auto_pause_after_empty_checks.sql",
  "0005_inactive_checks_auto_pause.sql",
];

async function migrate(client: Client): Promise<void> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)",
  );
  const appliedRows = await client.execute("SELECT name FROM _migrations");
  const applied = new Set(
    appliedRows.rows.map((r) => String(r["name"])),
  );
  const tableRows = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const tables = new Set(tableRows.rows.map((r) => String(r["name"])));
  if (applied.size === 0 && tables.has("plays")) {
    // Pre-migrated database (e.g. app.db copied from the hosted tracker):
    // the schema already includes every migration, so just record them.
    for (const file of MIGRATION_FILES) {
      await client.execute("INSERT OR IGNORE INTO _migrations (name) VALUES (?)", [
        file,
      ]);
    }
    return;
  }
  const available = new Set(readdirSync(drizzleDir));
  for (const file of MIGRATION_FILES) {
    if (applied.has(file) || !available.has(file)) continue;
    const sql = readFileSync(join(drizzleDir, file), "utf8");
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part.trim();
      if (statement) await client.execute(statement);
    }
    await client.execute("INSERT INTO _migrations (name) VALUES (?)", [file]);
  }
}

export async function createDb(): Promise<Db> {
  const client = createClient({ url: `file:${dbFile}` });
  await migrate(client);
  return drizzle(client, { schema });
}
