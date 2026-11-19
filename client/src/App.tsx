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

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./safe-area";
import { api, type ApiResponse } from "./api";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type Status = Dashboard["status"];
type Play = Dashboard["recentPlays"][number];
type Reports = ApiResponse<typeof api, "getReports">;
type Sessions = ApiResponse<typeof api, "listSessions">;
type Session = Sessions["sessions"][number];

const TILE_COLORS = [
  "#1ed760",
  "#f5b841",
  "#4cc2ff",
  "#ff7a9e",
  "#b18cff",
  "#ffb35c",
  "#5cd6c0",
];

function tileColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TILE_COLORS[Math.abs(h) % TILE_COLORS.length] ?? "#1ed760";
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDayFull(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtSpan(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

function fmtDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1 hour ago";
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function TrackTile({ name, size }: { name: string; size: number }) {
  const letter = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="font-display flex shrink-0 items-center justify-center rounded-[10px] font-bold text-[#0c1210]"
      style={{
        width: size,
        height: size,
        backgroundColor: tileColor(name),
        fontSize: size * 0.45,
      }}
    >
      {letter}
    </div>
  );
}

function TrackArt({
  name,
  artworkUrl,
  size,
}: {
  name: string;
  artworkUrl: string | null;
  size: number;
}) {
  if (artworkUrl) {
    return (
      <img
        src={artworkUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-[10px] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return <TrackTile name={name} size={size} />;
}

function NowPlayingCard({
  status,
  checking,
  onCheck,
  checkMessage,
}: {
  status: Status;
  checking: boolean;
  onCheck: () => void;
  checkMessage: string | null;
}) {
  const progress =
    status.currentProgressMs !== null && status.currentDurationMs
      ? Math.min(100, (status.currentProgressMs / status.currentDurationMs) * 100)
      : null;
  const isPlaying = status.currentPlaybackStatus === "PLAYING";
  const paused = status.autoPaused;
  const adBreak = status.status === "ad_break";

  const ownerRequired = status.status === "owner_required";
  const pillColor = paused
    ? "var(--amber)"
    : adBreak
      ? "var(--accent)"
      : status.status === "connected"
        ? "var(--accent)"
        : status.status === "not_connected" || ownerRequired
          ? "var(--danger)"
          : "var(--dim)";
  const pillLabel = paused
    ? "Auto-checks paused"
    : adBreak
      ? "Ad break · tracking continues"
      : ownerRequired
        ? "Owner only"
        : status.status === "connected"
          ? "Spotify connected"
          : status.status === "not_connected"
            ? "Spotify not connected"
            : status.status === "nothing_playing"
              ? "Connected · nothing playing"
              : "Not checked yet";

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-[var(--dim)] uppercase">
          Now playing
        </p>
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: pillColor }}
        >
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: pillColor }}
          />
          {pillLabel}
        </span>
      </div>

      {ownerRequired ? (
        <div className="mt-3">
          <h1 className="font-display text-2xl leading-tight font-bold text-[var(--text)]">
            This tracker is private
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            You're opening a shared link to a personal listening tracker.
            Only its owner can see the history, sessions, and reports —
            if that's you, open the tracker from your own Muse instead.
          </p>
        </div>
      ) : adBreak ? (
        <div className="mt-3">
          <h1 className="font-display text-2xl leading-tight font-bold text-[var(--text)]">
            Ad break
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Spotify is playing an ad. It isn't logged as a play, your
            playlist session stays open across the break, and the automatic
            checks keep running.
          </p>
        </div>
      ) : status.currentTrackName ? (
        <div className="mt-3">
          <div className="flex items-center gap-4">
            <TrackArt
              name={status.currentTrackName}
              artworkUrl={status.currentArtworkUrl}
              size={64}
            />
            <div className="min-w-0">
              <h1 className="font-display truncate text-2xl leading-tight font-bold text-[var(--text)]">
                {status.currentTrackUrl ? (
                  <a
                    href={status.currentTrackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {status.currentTrackName}
                  </a>
                ) : (
                  status.currentTrackName
                )}
              </h1>
              <p className="truncate text-base text-[var(--dim)]">
                {status.currentArtists}
              </p>
              <p className="mt-0.5 text-sm text-[var(--dim)]">
                {isPlaying ? "Playing" : "Paused"}
                {status.currentContextName
                  ? ` · from ${status.currentContextName}`
                  : ""}
              </p>
            </div>
          </div>
          {progress !== null && (
            <div className="mt-4">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"
                role="progressbar"
                aria-label="Track progress at last check"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: "var(--accent)",
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-[var(--dim)]">
                <span>{fmtDuration(status.currentProgressMs) ?? "0:00"}</span>
                <span>{fmtDuration(status.currentDurationMs) ?? ""}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <h1 className="font-display text-2xl leading-tight font-bold text-[var(--text)]">
            {status.status === "never_checked"
              ? "No checks yet"
              : status.status === "not_connected"
                ? "Spotify isn't connected"
                : "Nothing playing at the last check"}
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            {status.status === "never_checked"
              ? "Run a check while something plays on Spotify and your history starts building from there."
              : status.status === "not_connected"
                ? "Connect Spotify in Settings → Connections, then run a check."
                : "Plays are logged when a check finds a track playing or paused."}
          </p>
        </div>
      )}

      {paused && (
        <p
          className="mt-3 rounded-[10px] px-3 py-2 text-sm"
          style={{ backgroundColor: "var(--surface-alt)" }}
        >
          Automatic checks stopped after three checks in a row found
          nothing actively playing — either nothing was playing, or a
          track was sitting paused (which is what Spotify keeps
          reporting after a session is left open, even once its tab is
          closed). Tap <strong>Resume checks</strong> when you're
          listening again — it runs a check right away and turns the
          every-minute checks back on.
        </p>
      )}
      {!ownerRequired && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-ink)",
            }}
          >
            {checking
              ? "Checking…"
              : paused
                ? "Resume checks"
                : "Check now"}
          </button>
          <p className="text-xs text-[var(--dim)]">
            {paused
              ? `Paused · last checked ${timeAgo(status.lastCheckedAt)}`
              : `Last checked ${timeAgo(status.lastCheckedAt)}`}
            {status.lastCheckedAt
              ? ` · ${fmtDateTime(status.lastCheckedAt)}`
              : ""}
            {!paused && status.inactiveChecks > 0
              ? ` · ${status.inactiveChecks} of 3 checks without active playback before auto-pause`
              : ""}
          </p>
        </div>
      )}
      {checkMessage && (
        <p className="mt-2 text-xs" style={{ color: "var(--amber)" }}>
          {checkMessage}
        </p>
      )}
      {checking && (
        <p className="mt-2 text-xs text-[var(--dim)]">
          A check takes up to a minute — this page refreshes itself while it
          runs.
        </p>
      )}
    </section>
  );
}

function PlayRow({
  play,
  onDelete,
}: {
  play: Play;
  onDelete: (id: number) => void;
}) {
  const dur = fmtDuration(play.durationMs);
  return (
    <li className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <TrackArt name={play.trackName} artworkUrl={play.artworkUrl} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[var(--text)]">
          {play.spotifyUrl ? (
            <a
              href={play.spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {play.trackName}
            </a>
          ) : (
            play.trackName
          )}
          {play.isExplicit && (
            <span className="ml-1.5 rounded bg-[var(--surface-alt)] px-1 text-[11px] font-bold text-[var(--dim)]">
              E
            </span>
          )}
        </p>
        <p className="truncate text-sm text-[var(--dim)]">
          {play.artists}
          {play.contextName ? ` · ${play.contextName}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-[var(--text)]">
          {fmtDateTime(play.observedAt)}
        </p>
        <p className="text-xs text-[var(--dim)]">
          {dur ? `${dur} · ` : ""}logged
        </p>
        <button
          type="button"
          onClick={() => onDelete(play.id)}
          aria-label={`Remove ${play.trackName} from history`}
          className="mt-0.5 text-xs font-medium"
          style={{ color: "var(--danger)" }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function RankDelta({ delta }: { delta: number | null }) {
  if (delta === null)
    return <span className="text-xs text-[var(--dim)]">—</span>;
  if (delta > 0)
    return (
      <span
        className="text-xs font-semibold"
        style={{ color: "var(--accent)" }}
      >
        ▲ {delta}
      </span>
    );
  if (delta < 0)
    return (
      <span
        className="text-xs font-semibold"
        style={{ color: "var(--danger)" }}
      >
        ▼ {Math.abs(delta)}
      </span>
    );
  return <span className="text-xs text-[var(--dim)]">• 0</span>;
}

function ReportsView({ periodDays }: { periodDays: number }) {
  const reports = useQuery({
    queryKey: ["reports", periodDays],
    queryFn: () => api.getReports({ periodDays }),
  });

  if (reports.isPending) {
    return <p className="py-8 text-center text-sm text-[var(--dim)]">Loading reports…</p>;
  }
  if (reports.error) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--danger)" }}>
        Reports couldn't load. Pull to retry in a moment.
      </p>
    );
  }
  const data: Reports = reports.data;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.plays));

  if (data.totalPlays === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="font-display text-lg font-bold text-[var(--text)]">
          No plays in this period yet
        </p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Reports are built from your logged plays, so they fill in as the
          tracker checks Spotify every minute while something is playing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-lg font-bold text-[var(--text)]">
          Plays per day · last 14 days
        </h2>
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-28 items-end gap-1.5">
            {data.daily.map((d) => (
              <div
                key={d.day}
                className="flex flex-1 flex-col items-center justify-end gap-1"
                title={`${fmtDayLabel(d.day)}: ${d.plays} plays`}
              >
                <span className="text-[11px] font-medium text-[var(--dim)]">
                  {d.plays > 0 ? d.plays : ""}
                </span>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(4, (d.plays / maxDaily) * 72)}px`,
                    backgroundColor:
                      d.plays > 0 ? "var(--accent)" : "var(--surface-alt)",
                  }}
                />
                <span className="text-[10px] text-[var(--dim)]">
                  {fmtDayLabel(d.day).split(" ")[1]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-bold text-[var(--text)]">
          Top tracks
        </h2>
        <ol className="mt-3 space-y-2">
          {data.topTracks.map((t, i) => (
            <li
              key={t.trackUri}
              className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <span className="font-display w-7 shrink-0 text-center text-lg font-bold text-[var(--dim)]">
                {i + 1}
              </span>
              <TrackTile name={t.trackName} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[var(--text)]">
                  {t.spotifyUrl ? (
                    <a
                      href={t.spotifyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {t.trackName}
                    </a>
                  ) : (
                    t.trackName
                  )}
                </p>
                <p className="truncate text-sm text-[var(--dim)]">
                  {t.artists} · last played {fmtDateTime(t.lastPlayedAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold text-[var(--text)]">
                  {t.plays} {t.plays === 1 ? "play" : "plays"}
                </p>
                <RankDelta delta={t.rankDelta} />
              </div>
            </li>
          ))}
        </ol>
        {periodDays > 0 && (
          <p className="mt-2 text-xs text-[var(--dim)]">
            ▲▼ compares this period's rank with the previous {periodDays}{" "}
            days. "—" means it wasn't in the previous period's chart.
          </p>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-bold text-[var(--text)]">
          Top artists
        </h2>
        <ol className="mt-3 space-y-2">
          {data.topArtists.map((a, i) => (
            <li
              key={a.artist}
              className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <span className="font-display w-7 shrink-0 text-center text-lg font-bold text-[var(--dim)]">
                {i + 1}
              </span>
              <TrackTile name={a.artist} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[var(--text)]">
                  {a.artist}
                </p>
                <p className="truncate text-sm text-[var(--dim)]">
                  last played {fmtDateTime(a.lastPlayedAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold text-[var(--text)]">
                  {a.plays} {a.plays === 1 ? "play" : "plays"}
                </p>
                <RankDelta delta={a.rankDelta} />
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  const open = session.endedAt === null;
  const span = fmtSpan(session.startedAt, session.endedAt);
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display truncate text-lg leading-tight font-bold text-[var(--text)]">
            {session.playlistUrl ? (
              <a
                href={session.playlistUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {session.playlistName}
              </a>
            ) : (
              session.playlistName
            )}
          </h3>
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            {fmtDayFull(session.startedAt)} · {fmtTime(session.startedAt)} –{" "}
            {session.endedAt ? fmtTime(session.endedAt) : "…"}
            {span ? ` · ${span}` : ""} · {session.tracks.length}{" "}
            {session.tracks.length === 1 ? "track" : "tracks"}
          </p>
        </div>
        {open && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{
              backgroundColor: "var(--surface-alt)",
              color: "var(--accent)",
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
            In progress
          </span>
        )}
      </div>
      {session.tracks.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {session.tracks.map((t, i) => {
            const dur = fmtDuration(t.durationMs);
            return (
              <li key={t.id} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-right text-xs font-medium text-[var(--dim)]">
                  {i + 1}
                </span>
                <TrackArt
                  name={t.trackName}
                  artworkUrl={t.artworkUrl}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-[var(--text)]">
                    {t.spotifyUrl ? (
                      <a
                        href={t.spotifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {t.trackName}
                      </a>
                    ) : (
                      t.trackName
                    )}
                    {t.isExplicit && (
                      <span className="ml-1.5 rounded bg-[var(--surface-alt)] px-1 text-[11px] font-bold text-[var(--dim)]">
                        E
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-[var(--dim)]">
                    {t.artists}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium whitespace-nowrap text-[var(--text)]">
                    {fmtTime(t.observedAt)} –{" "}
                    {t.endedAt ? fmtTime(t.endedAt) : "…"}
                  </p>
                  <p className="text-xs text-[var(--dim)]">
                    {dur ? `${dur} long` : "length unknown"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-[var(--dim)]">
          No tracks from this session are in the history — they may have been
          removed from the History tab.
        </p>
      )}
    </section>
  );
}

function SessionsView() {
  const [pageSize, setPageSize] = useState(20);
  const sessionsQuery = useQuery({
    queryKey: ["sessions", pageSize],
    queryFn: () => api.listSessions({ limit: pageSize, offset: 0 }),
  });

  if (sessionsQuery.isPending) {
    return (
      <p className="py-8 text-center text-sm text-[var(--dim)]">
        Loading sessions…
      </p>
    );
  }
  if (sessionsQuery.error) {
    return (
      <p
        className="py-8 text-center text-sm"
        style={{ color: "var(--danger)" }}
      >
        Sessions couldn't load. Try again in a moment.
      </p>
    );
  }
  const data = sessionsQuery.data;
  if (data.total === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="font-display text-lg font-bold text-[var(--text)]">
          No playlist sessions yet
        </p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          A session starts when you play something from a playlist and ends
          when the playlist changes or playback stops. Play from a playlist
          on Spotify and the next check, about a minute away, opens one
          here.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="space-y-4">
        {data.sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-[var(--dim)]">
        Showing {data.sessions.length} of {data.total} sessions
      </p>
      {data.sessions.length < data.total && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => setPageSize((n) => n + 20)}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--text)]"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"history" | "sessions" | "reports">(
    "history",
  );
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [periodDays, setPeriodDays] = useState(30);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [pendingSince, setPendingSince] = useState<number | null>(null);

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.getDashboard({}),
    refetchInterval: pendingSince ? 8000 : false,
  });

  const lastCheckedAt = dashboard.data?.status.lastCheckedAt ?? null;
  useEffect(() => {
    if (pendingSince === null) return;
    if (
      lastCheckedAt &&
      new Date(lastCheckedAt).getTime() >= pendingSince - 5000
    ) {
      setPendingSince(null);
      queryClient.invalidateQueries({ queryKey: ["plays"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    }
    const t = setTimeout(() => setPendingSince(null), 150000);
    return () => clearTimeout(t);
  }, [pendingSince, lastCheckedAt, queryClient]);

  const playsQuery = useQuery({
    queryKey: ["plays", search, pageSize],
    queryFn: () =>
      api.listPlays({ query: search, limit: pageSize, offset: 0 }),
  });

  const refresh = useMutation({
    mutationFn: () => api.refreshNowPlaying({ source: "manual" }),
    onSuccess: (res) => {
      setCheckMessage(res.message);
      if (res.started) setPendingSince(Date.now());
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => {
      setCheckMessage(
        "Couldn't start a check just now. Try again in a moment.",
      );
    },
  });

  const deletePlay = useMutation({
    mutationFn: (id: number) => api.deletePlay({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plays"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const status = dashboard.data?.status;
  const checking = pendingSince !== null || refresh.isPending;

  const periodOptions = useMemo(
    () => [
      { label: "7 days", value: 7 },
      { label: "30 days", value: 30 },
      { label: "All time", value: 0 },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-10">
        {dashboard.isPending && (
          <p className="py-16 text-center text-sm text-[var(--dim)]">
            Loading your play history…
          </p>
        )}
        {dashboard.error && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <p className="font-display text-lg font-bold text-[var(--text)]">
              The tracker couldn't load
            </p>
            <p className="mt-1 text-sm text-[var(--dim)]">
              Your logged plays are stored safely — try reopening the page in
              a moment.
            </p>
          </div>
        )}

        {status && (
          <>
            <NowPlayingCard
              status={status}
              checking={checking}
              onCheck={() => refresh.mutate()}
              checkMessage={checkMessage}
            />

            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Plays logged", value: dashboard.data?.totalPlays ?? 0 },
                { label: "Unique tracks", value: dashboard.data?.uniqueTracks ?? 0 },
                { label: "Unique artists", value: dashboard.data?.uniqueArtists ?? 0 },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-center"
                >
                  <p className="font-display text-2xl font-bold text-[var(--text)]">
                    {s.value}
                  </p>
                  <p className="text-xs text-[var(--dim)]">{s.label}</p>
                </div>
              ))}
            </div>

            <div
              className="mt-6 grid grid-cols-3 gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1"
              role="tablist"
              aria-label="Views"
            >
              {(
                [
                  { key: "history", label: "History" },
                  { key: "sessions", label: "Sessions" },
                  { key: "reports", label: "Reports" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className="rounded-full py-2 text-sm font-semibold"
                  style={
                    tab === t.key
                      ? {
                          backgroundColor: "var(--accent)",
                          color: "var(--accent-ink)",
                        }
                      : { color: "var(--dim)" }
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "history" && (
              <section className="mt-5">
                <label htmlFor="play-search" className="sr-only">
                  Search plays by track, artist, or playlist
                </label>
                <input
                  id="play-search"
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPageSize(50);
                  }}
                  placeholder="Search track, artist, or playlist…"
                  className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
                />

                {playsQuery.isPending && (
                  <p className="py-8 text-center text-sm text-[var(--dim)]">
                    Loading plays…
                  </p>
                )}
                {playsQuery.error && (
                  <p
                    className="py-8 text-center text-sm"
                    style={{ color: "var(--danger)" }}
                  >
                    Search couldn't load. Try again in a moment.
                  </p>
                )}
                {playsQuery.data && playsQuery.data.total === 0 && (
                  <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
                    <p className="font-display text-lg font-bold text-[var(--text)]">
                      {search
                        ? "No plays match that search"
                        : "No plays logged yet"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--dim)]">
                      {search
                        ? "Try a different track, artist, or playlist name."
                        : "Play something on Spotify and tap Check now — or, if the card above shows auto-checks paused, tap Resume checks there."}
                    </p>
                  </div>
                )}
                {playsQuery.data && playsQuery.data.plays.length > 0 && (
                  <>
                    <ul className="mt-4 space-y-2">
                      {playsQuery.data.plays.map((p) => (
                        <PlayRow
                          key={p.id}
                          play={p}
                          onDelete={(id) => deletePlay.mutate(id)}
                        />
                      ))}
                    </ul>
                    <p className="mt-3 text-center text-xs text-[var(--dim)]">
                      Showing {playsQuery.data.plays.length} of{" "}
                      {playsQuery.data.total} plays
                    </p>
                    {playsQuery.data.plays.length < playsQuery.data.total && (
                      <div className="mt-2 text-center">
                        <button
                          type="button"
                          onClick={() => setPageSize((n) => n + 50)}
                          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--text)]"
                        >
                          Show more
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {tab === "sessions" && (
              <section className="mt-5">
                <SessionsView />
              </section>
            )}

            {tab === "reports" && (
              <section className="mt-5">
                <div
                  className="mb-5 flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1"
                  role="group"
                  aria-label="Report period"
                >
                  {periodOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setPeriodDays(o.value)}
                      aria-pressed={periodDays === o.value}
                      className="flex-1 rounded-full py-2 text-sm font-semibold"
                      style={
                        periodDays === o.value
                          ? {
                              backgroundColor: "var(--accent)",
                              color: "var(--accent-ink)",
                            }
                          : { color: "var(--dim)" }
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <ReportsView periodDays={periodDays} />
              </section>
            )}

            <footer className="mt-10 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="font-display text-sm font-bold text-[var(--text)]">
                How tracking works
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
                This tracker checks what's playing on your Spotify account
                about every minute and logs each track it finds — and unlike
                the rolling lists on stats sites, nothing is ever dropped:
                your full history stays searchable here. History starts from
                the first check (Spotify doesn't offer a past-plays feed to
                import), and the time on each play is when the tracker logged
                it. Consecutive plays from one playlist are grouped into a
                session on the Sessions tab, with the playlist's start and
                end times and each track's start and end times. Fragments
                of one listen that were split by an ad break, a pause, or
                a brief gap (under about 30 minutes) are shown as a single
                session entry, so one continuous listen to a playlist is
                one entry; a genuinely separate listen after a longer gap
                stays its own entry. Because the
                tracker checks every minute rather than watching a live
                feed, those start and end times are accurate to within about
                a minute, not to the second — and a track you skip within a
                minute of it starting can still slip through. Plays from
                before the checks ran every minute were sampled less often,
                so earlier sessions can be missing tracks that played
                between checks. To avoid checking around the clock for
                nothing, the automatic checks pause themselves after three
                checks in a row find nothing actively playing — either
                nothing playing at all, or a track sitting paused. A
                paused track counts because closing a Spotify tab or app
                doesn't end its session: Spotify keeps reporting that last
                track as paused, and left unchecked the tracker would keep
                seeing it forever (it is logged once, as a single play,
                not over and over). The card at the top
                shows "Auto-checks paused" when that happens. Restarting is
                manual: tap Resume checks there (or Check now) and the
                every-minute checks turn back on until three inactive
                checks pause them again. Plays that happen while checks
                are paused aren't logged — the tracker can only record
                what a check actually sees. When Spotify plays an ad
                instead of a track, the check sees the ad break: the ad
                itself is never logged as a play, an open playlist session
                stays open across the break, and the ad resets — rather
                than counts toward — the three inactive checks that pause
                automatic checking, so a run of consecutive ads can't stop
                the tracker in the middle of a session.
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
