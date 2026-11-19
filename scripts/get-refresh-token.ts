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

// One-time Spotify authorization helper. Run with: bun run auth
//
// 1. Prints a Spotify authorization URL. Open it, sign in, and authorize.
// 2. Spotify redirects to http://127.0.0.1:8888/callback — that page
//    won't load (nothing serves it), which is expected. Copy the full
//    URL from the address bar (or just the code= value) and paste it
//    at the prompt.
// 3. Exchanges the code for tokens and saves the refresh token to
//    spotify-tokens.json (mode 0600, gitignored).
//
// Prerequisites: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env, and
// the redirect URI below added to the Spotify app's settings at
// https://developer.spotify.com/dashboard (App settings -> Redirect URIs).

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {
  console.error(
    "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first (see .env.example).",
  );
  process.exit(1);
}

const redirectUri = "http://127.0.0.1:8888/callback";
const scope = ["user-read-playback-state", "playlist-read-private"].join(" ");
const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  scope,
  redirect_uri: redirectUri,
})}`;

console.log("1. Open this URL in your browser and authorize the app:");
console.log(`   ${authUrl}`);
console.log(
  "2. After authorizing, Spotify redirects to a 127.0.0.1 address that won't load — that's expected.",
);
const input = prompt(
  "3. Paste the full redirect URL (or just the code= value) here: ",
) ?? "";

let code = input.trim();
if (code.includes("code=")) {
  try {
    const query = code.split("?")[1] ?? code;
    code = new URLSearchParams(query).get("code") ?? "";
  } catch {
    code = "";
  }
}
if (!code) {
  console.error("No authorization code found. Run `bun run auth` again.");
  process.exit(1);
}

const res = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }),
});
if (!res.ok) {
  console.error(`Token exchange failed (HTTP ${res.status}): ${await res.text()}`);
  process.exit(1);
}
const data = (await res.json()) as { refresh_token?: unknown };
if (typeof data.refresh_token !== "string") {
  console.error("Spotify did not return a refresh token. Try again.");
  process.exit(1);
}
const tokensFile = join(import.meta.dir, "..", "spotify-tokens.json");
await writeFile(
  tokensFile,
  `${JSON.stringify({ refresh_token: data.refresh_token }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`Connected! Refresh token saved to ${tokensFile}.`);
console.log("Now run: bun start");
