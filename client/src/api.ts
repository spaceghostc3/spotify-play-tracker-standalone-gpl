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

// Typed fetch client for the standalone server. The server exposes one
// POST endpoint per action at /api/<action>; this module mirrors the
// method names the App expects (getDashboard, listPlays, listSessions,
// getReports, refreshNowPlaying, deletePlay) and the response types
// defined in server/src/actions.ts (imported as types only, so no server
// code lands in the browser bundle).

import type {
  DashboardResponse,
  DeleteResponse,
  PlaysResponse,
  RefreshResponse,
  ReportsResponse,
  SessionsResponse,
} from "../../server/src/actions";

async function post<T>(action: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data: unknown = await res.json();
      if (
        data !== null &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
      ) {
        message = (data as { error: string }).error;
      }
    } catch {
      // Keep the default message.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  getDashboard: (args: {}): Promise<DashboardResponse> =>
    post("getDashboard", args),
  listPlays: (args: {
    query: string;
    limit: number;
    offset: number;
  }): Promise<PlaysResponse> => post("listPlays", args),
  listSessions: (args: {
    limit: number;
    offset: number;
  }): Promise<SessionsResponse> => post("listSessions", args),
  getReports: (args: { periodDays: number }): Promise<ReportsResponse> =>
    post("getReports", args),
  refreshNowPlaying: (args: {
    source: "manual" | "cron";
  }): Promise<RefreshResponse> => post("refreshNowPlaying", args),
  deletePlay: (args: { id: number }): Promise<DeleteResponse> =>
    post("deletePlay", args),
};

// Matches the App's usage: ApiResponse<typeof api, "getDashboard"> is the
// awaited return type of that method.
export type ApiResponse<TApi, TAction extends keyof TApi> =
  TApi[TAction] extends (args: never) => Promise<infer R> ? R : never;
export type ApiRequest<TApi, TAction extends keyof TApi> =
  TApi[TAction] extends (args: infer A) => unknown ? A : never;
