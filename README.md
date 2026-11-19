# Spotify Play Tracker — Standalone Edition

A private replacement for statsforspotify-style "recently played" tracking
that runs on your own machine (Windows, Linux, or macOS) and serves a local
web page you open in a browser. It logs what a connected Spotify account is
playing, keeps the history permanently (no ads, no first-in-first-out
cutoff), and reports on it — top tracks and artists, searchable history,
and end-to-end playlist sessions.

Updated 2026-11-11 to match the hosted tracker: ad-break handling and
Sessions-tab grouping (both from the hosted 2026-11-04 fix — see "Using
it"), free-text fields capped at 1000 characters, and artwork URLs
host-checked against Spotify's image CDNs. Re-verified the same day:
typecheck clean, client builds, and a scripted sequence confirmed the
ad-break behavior (no play logged, session stays open, auto-pause
counter reset), session grouping, the 1000-character cap, and artwork
host-check rejection.

GPL edition (2026-11-18): this copy is licensed under the GNU General
Public License v3 (or any later version) — see License below. The only
changes from the 2026-11-11 package are the license file, the copyright
headers on the source files, and this section.

## Requirements

- **Bun** (the project pins `bun@1.3.10`; any recent Bun 1.x works).
  Install from https://bun.sh — one command on all three OSes.
- **A free Spotify developer app** (for API access). See "Spotify setup".
- **A browser** to open the local page.
- No Node.js, database server, or hosting account needed. Storage is a
  local SQLite file; the app binds to localhost only.

## Quick start

```bash
# 1. Unzip this package and enter it
cd spotify-play-tracker-standalone

# 2. Install dependencies
bun install

# 3. Build the browser client (once, and after any client change)
bun run build:client

# 4. Set up Spotify access (one time; see "Spotify setup" below)
cp .env.example .env
# ...fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET...
bun run auth

# 5. Start the tracker
bun start

# 6. Open http://127.0.0.1:3000 in your browser
```

Keep the terminal running while you want tracking — the poll timer lives
in the server process. Press Ctrl+C to stop it.

## Spotify setup

1. Go to https://developer.spotify.com/dashboard and sign in with the
   Spotify account you want to track. Create an app (any name/description).
2. In the app's settings, add this Redirect URI:
   `http://127.0.0.1:8888/callback`
3. Copy the app's Client ID and Client Secret into `.env`.
4. Run `bun run auth`. It prints an authorization URL: open it, sign in,
   and authorize. Spotify redirects to a `127.0.0.1` address that won't
   load — that's expected. Copy the full URL (or just the `code=` value)
   from the address bar and paste it at the prompt.
5. The helper saves a refresh token to `spotify-tokens.json` (mode 0600,
   gitignored). The server uses it to obtain short-lived access tokens;
   if Spotify rotates the refresh token, the new one is saved back
   automatically.

Requested scopes: `user-read-playback-state` (see what's playing) and
`playlist-read-private` (resolve playlist names for your private
playlists). No playback control, no library changes, no data written to
Spotify — the app only reads.

## Using it

Open http://127.0.0.1:3000. Four tabs:

- **Now Playing** — the current/last track snapshot (title, artists,
  playlist context, cover art, progress), totals (plays, unique tracks,
  unique artists), and the **Check now** button for an immediate manual
  check. If automatic checks have paused, this card shows "Auto-checks
  paused" and the button reads **Resume checks**.
- **History** — every logged play, newest first, searchable by track,
  artist, or playlist. Each row has a **Remove** button that deletes just
  that play.
- **Sessions** — playlist listens end to end: playlist name (linked),
  date, session start/end, total span, and tracks in play order with
  cover art and per-track start–end times. Fragments of one listen that
  were split by an ad break, a pause, or a brief gap (under about 30
  minutes) are shown as a single session entry; a genuinely separate
  listen after a longer gap stays its own entry. Sessions with all
  tracks removed show an honest empty note.
- **Reports** — top tracks and artists for 7 days, 30 days, or all time,
  with rank movement vs the previous period and a plays-per-day chart.

Everyday notes:

- History starts at go-live. There is no backfill: plays from before the
  tracker existed are not recoverable from Spotify through this app.
- Times shown are when the tracker observed a track ("Logged"), accurate
  to within about a minute at the default 1-minute poll interval. A track
  skipped within about a minute of starting may be missed entirely.
- If you stop listening, automatic checks pause after 3 inactive checks;
  tap **Resume checks** before your next listen or that listen will not
  be logged.
- Ad breaks don't stop tracking: when Spotify plays an ad, the check
  sees the break — the ad is never logged as a play, an open playlist
  session stays open across it, and the break counts as active
  listening, so a run of consecutive ads can't trip the 3-check
  auto-pause mid-session. During a break the Now Playing card shows
  "Ad break · tracking continues."

## Data

- The database is `tracker.db` in the project root (override with
  `TRACKER_DB_FILE`). One row per distinct play; thousands of plays are
  still well under a megabyte. Back it up by copying the file while the
  server is stopped.
- **Bringing your existing history:** copy `app.db` from the hosted
  tracker over `tracker.db` before first start. The server detects the
  existing schema and marks all migrations applied, so your plays,
  sessions, and status carry over untouched.
- `spotify-tokens.json` holds only the Spotify refresh token — never
  share it or commit it (it's gitignored, as is `.env`).

## Configuration

Environment variables (`.env` file or shell; Bun loads `.env`
automatically):

| Variable | Default | Purpose |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | — | Spotify app client ID (required for polling) |
| `SPOTIFY_CLIENT_SECRET` | — | Spotify app client secret (required for polling) |
| `SPOTIFY_REFRESH_TOKEN` | — | Fallback if `spotify-tokens.json` is absent |
| `PORT` | `3000` | Web port |
| `HOST` | `127.0.0.1` | Bind address (keep localhost unless you add auth) |
| `POLL_INTERVAL_MS` | `60000` | Automatic check interval; timing accuracy scales with it |
| `TRACKER_DB_FILE` | `./tracker.db` | Database file path |
| `TRACKER_TOKENS_FILE` | `./spotify-tokens.json` | Refresh-token file path |

Scripts (`package.json`):

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies from `bun.lock` |
| `bun run build:client` | Bundle the React client + compile Tailwind CSS into `client/dist/` |
| `bun run auth` | One-time Spotify authorization (writes `spotify-tokens.json`) |
| `bun start` | Run the server + poll timer |
| `bun run typecheck` | Type-check client and server |

## Project structure

```
client/                  React frontend (single-page app)
  index.html             Page template (references ./main.js, ./theme.css)
  src/
    App.tsx              All tabs: Now Playing, History, Sessions, Reports
    api.ts               Fetch client: POST /api/<action>
    main.tsx             App bootstrap (QueryClient, #root)
    safe-area.tsx        Safe-area top spacer (stub for the hosted SDK's)
    theme.css            Tailwind v4 styles
    globals.d.ts
server/                  Backend (Bun)
  src/
    server.ts            HTTP server (static files + /api/*) and poll timer
    actions.ts           All tracker logic (port of the hosted actions)
    spotify.ts           Spotify Web API client (token refresh, now-playing)
    artwork.ts           Cover art via Spotify's public oEmbed endpoint
    db.ts                Drizzle + libSQL database and migration runner
    schema.ts            Drizzle table definitions
drizzle/                 Database migrations 0001–0005, applied in order
scripts/
  build-client.ts        Client build (Bun.build + Tailwind CLI + copy HTML)
  get-refresh-token.ts   `bun run auth` helper
package.json             Scripts and dependencies
bun.lock                 Pinned dependency tree
tsconfig.json / tsconfig.client.json / tsconfig.server.json
.env.example             Configuration template
```

## What changed from the hosted version

- **Database:** the space SDK's `ctx.db` became Drizzle over a local
  libSQL/SQLite file, using the same schema and migrations.
- **Spotify polling:** the connector CLI became direct Spotify Web API
  calls (`/v1/me/player/currently-playing`) with an OAuth refresh token.
  The Web API's playlist context has no name, so playlist names are
  fetched with `/v1/playlists/{id}?fields=name` and cached.
- **Scheduling:** the managed cron job became an in-process timer
  (`setInterval`, 60s default) with an overlap guard; auto-pause is still
  enforced inside `refreshNowPlaying`.
- **Artwork:** the privileged host call became a plain `fetch` to
  Spotify's public oEmbed endpoint (15s timeout, origin+path only).
- **Ad breaks and session grouping (2026-11-11):** ported from the
  hosted tracker's 2026-11-04 fix. The Web API payload is checked for
  an ad (`currently_playing_type: "ad"`, an ad-type or `spotify:ad:`
  item, or playback running with no track item) before the track
  checks, and `recordPlay` handles the ad observation exactly as the
  hosted version does; `listSessions` groups split fragments of one
  listen the same way (30-minute window).
- **Validation caps and artwork host check (2026-11-11):** also ported
  from the hosted version. Free-text fields (track name, artists,
  context name/URI, playback status, note) are capped at 1000
  characters, and artwork URLs are accepted only as https URLs on
  Spotify's image CDNs (`*.scdn.co`, `*.spotifycdn.com`) — checked when
  fetched, when reused from a cached row, and again on the way out.
- **Client transport:** the SDK action client became `fetch` POSTs to
  `/api/<action>`; the SDK query client became a plain react-query
  `QueryClient`; the SDK safe-area component became a local stub. The
  only change to `App.tsx` itself is that one import line.
- **Checks are synchronous:** in the hosted version a check returned
  "result lands within a minute" because a poll agent reported back
  asynchronously; here the check runs inline and the button message
  describes the actual outcome.
- **What did not change:** dedupe rules (including the paused-track fix),
  session open/close rules, the 3-inactive-check auto-pause, report
  math, validation caps, and the Spotify-URL-only rule for stored links.

## Security notes

- The server binds to `127.0.0.1` by default and has no login, mirroring
  the hosted version's owner-gating. Treat localhost binding as the
  access control: do not set `HOST` to a public address or expose the
  port without adding authentication — anyone who can reach it could
  invoke every endpoint, including deleting plays.
- No secret, token, password, or Spotify credential appears in source
  code. Credentials live in `.env` and `spotify-tokens.json` only.
- All database access uses Drizzle's parameterized query builder; no raw
  SQL string concatenation is present (migrations are static files).
- Stored URLs are validated to `https://open.spotify.com` before they
  are saved and later rendered as links. Artwork URLs are likewise
  accepted only on Spotify's image CDNs (https, `*.scdn.co` or
  `*.spotifycdn.com`) before they are saved and rendered as images.
- Free-text fields are capped at 1000 characters at the request
  boundary; anything longer is rejected and nothing is stored.

## Troubleshooting

- **"Spotify isn't connected yet"** — run `bun run auth` (after filling
  in `.env`), then restart the server. The Check now button re-tests
  immediately.
- **"Spotify rejected the connection"** — the refresh token was revoked
  or the app's credentials changed. Run `bun run auth` again.
- **"Nothing playing" while music plays** — the Web API only reports an
  active Spotify session. Open Spotify on a device and start playback,
  then tap Check now. A 204 response (nothing) is normal when idle.
- **Port in use** — set `PORT` in `.env` (e.g. `PORT=3001`) and reopen
  that URL.
- **Build note** — `bun install` may report one blocked postinstall
  (`@parcel/watcher`). That's Tailwind's optional file watcher for
  `--watch` mode; one-shot builds don't need it, and the build works
  without it.
- **Windows notes** — all commands are identical in PowerShell. Bun's
  installer and the `bun` commands work the same; `.env` and path
  handling need no changes.

## License

Spotify Play Tracker is free software: you can redistribute it and/or
modify it under the terms of the GNU General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. The full license text is in the
`LICENSE` file at the root of this package, and every source file
carries the GPL copyright notice header.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

Copyright (C) 2026 Robert Dreyer.
