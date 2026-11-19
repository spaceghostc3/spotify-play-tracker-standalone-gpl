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

// Builds the browser client into client/dist/:
//   1. Bundles client/src/main.tsx -> client/dist/main.js (Bun.build)
//   2. Compiles Tailwind CSS: client/src/theme.css -> client/dist/theme.css
//      (Tailwind v4 CLI, which auto-detects classes in client/src)
//   3. Copies client/index.html -> client/dist/index.html
//
// Run with: bun run build:client

import { cpSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const bundle = await Bun.build({
  entrypoints: [join(root, "client/src/main.tsx")],
  outdir: join(root, "client/dist"),
  target: "browser",
  minify: true,
});
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log);
  console.error("Client bundle failed.");
  process.exit(1);
}

const tailwind = Bun.spawnSync(
  [
    "bun",
    "x",
    "@tailwindcss/cli",
    "-i",
    join(root, "client/src/theme.css"),
    "-o",
    join(root, "client/dist/theme.css"),
    "--minify",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (tailwind.exitCode !== 0) {
  console.error("Tailwind build failed.");
  process.exit(tailwind.exitCode ?? 1);
}

cpSync(join(root, "client/index.html"), join(root, "client/dist/index.html"));
console.log("Client built into client/dist/ (main.js, theme.css, index.html).");
