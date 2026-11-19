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

// Standalone Spotify Play Tracker server.
//
// Serves the built client (client/dist) and one POST endpoint per action
// at /api/<action>, and polls Spotify on a timer. Run with:
//   bun run build:client   (once, and after any client change)
//   bun start
// Then open http://127.0.0.1:3000 in a browser.
//
// The server binds to localhost by default (HOST env override). It
// carries no authentication, mirroring the hosted version's
// owner-gating — do not expose it beyond localhost without adding
// authentication first.

import { join } from "node:path";
import * as actions from "./actions";
import { createDb, type Db } from "./db";
import { ZodError } from "zod";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60000);
const distDir = join(import.meta.dir, "..", "..", "client", "dist");

const db: Db = await createDb();

const handlers: Record<string, (db: Db, args: unknown) => Promise<unknown>> = {
  getDashboard: () => actions.getDashboard(db),
  listPlays: (_db, args) => actions.listPlays(db, args),
  listSessions: (_db, args) => actions.listSessions(db, args),
  getReports: (_db, args) => actions.getReports(db, args),
  deletePlay: (_db, args) => actions.deletePlay(db, args),
  refreshNowPlaying: (_db, args) => actions.refreshNowPlaying(db, args),
};

async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const action = url.pathname.slice("/api/".length);
  const handler = handlers[action];
  if (!handler) {
    return Response.json({ error: `Unknown action: ${action}` }, { status: 404 });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const result = await handler(db, body);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error(`[api/${action}]`, err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function handleStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = join(distDir, pathname);
  if (!filePath.startsWith(distDir)) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, {
    headers: { "content-type": contentType(filePath) },
  });
}

// Automatic checks: same cadence and semantics as the hosted version's
// 1-minute cron job. Overlapping ticks are skipped (a slow Spotify call
// must not swallow the next check), and auto-pause is enforced inside
// refreshNowPlaying itself.
let pollRunning = false;
async function cronTick() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const res = await actions.refreshNowPlaying(db, { source: "cron" });
    console.log(`[poll] ${new Date().toISOString()} ${res.message}`);
  } catch (err) {
    console.error("[poll] error", err);
  } finally {
    pollRunning = false;
  }
}
setInterval(cronTick, POLL_INTERVAL_MS);
// One check shortly after startup so the first page load has fresh data.
setTimeout(cronTick, 2000);

Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req);
    return handleStatic(req);
  },
});

console.log(`Spotify Play Tracker running at http://${HOST}:${PORT}`);
console.log(
  `Polling Spotify every ${Math.round(POLL_INTERVAL_MS / 1000)}s. Press Ctrl+C to stop.`,
);
