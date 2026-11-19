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

// Standalone replacement for the Muse-hosted SafeAreaTopScrim component.
// Renders a top spacer that honors the device safe-area inset (notches,
// etc.) on mobile browsers; a no-op height on desktop.
export function SafeAreaTopScrim({
  backgroundColor,
}: {
  backgroundColor?: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ height: "env(safe-area-inset-top)", backgroundColor }}
    />
  );
}
