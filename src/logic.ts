import type { Row } from "./types";

export type ProtoFilter = "All" | "TCP" | "UDP";
export type SortCol = "port" | "proto" | "address" | "process" | "pid" | "user";
export interface Sort {
  col: SortCol;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: Sort = { col: "port", dir: "asc" };

export function displayName(row: Row): string {
  return row.process ?? (row.ownership === "kernel" ? "kernel" : "Restricted");
}

export function matchesFilter(row: Row, text: string, proto: ProtoFilter): boolean {
  if (proto !== "All" && row.proto !== proto) return false;
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/^:\d+$/.test(t)) return row.port === Number(t.slice(1));
  if (String(row.port).startsWith(t)) return true;
  return [displayName(row), row.cmdline, row.user, row.address].some((f) =>
    f.toLowerCase().includes(t),
  );
}

const cmp = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

function defaultCmp(a: Row, b: Row): number {
  return (
    cmp(a.port, b.port) || cmp(a.proto, b.proto) || cmp(a.address, b.address) || cmp(a.key, b.key)
  );
}

const colValue: Record<SortCol, (r: Row) => string | number> = {
  port: (r) => r.port,
  proto: (r) => r.proto,
  address: (r) => r.address,
  process: (r) => displayName(r).toLowerCase(),
  pid: (r) => r.pid ?? Number.MAX_SAFE_INTEGER,
  user: (r) => r.user.toLowerCase(),
};

/** Sorts by the column in the given direction; ties fall back to the default order (always ascending). */
export function sortRows(rows: readonly Row[], sort: Sort): Row[] {
  const get = colValue[sort.col];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(get(a), get(b)) || defaultCmp(a, b));
}

export function nextSort(cur: Sort, col: SortCol): Sort {
  return cur.col === col
    ? { col, dir: cur.dir === "asc" ? "desc" : "asc" }
    : { col, dir: "asc" };
}

function sameRow(a: Row, b: Row): boolean {
  for (const k in a) if (a[k as keyof Row] !== b[k as keyof Row]) return false;
  return true;
}

export interface Merge {
  /** Next rows, reusing previous objects for unchanged rows so memoized row components skip. */
  rows: Row[];
  added: string[];
  removed: boolean;
}

/** `prev` is null on the very first scan, which reports nothing as added. */
export function mergeScan(prev: readonly Row[] | null, next: readonly Row[]): Merge {
  if (!prev) return { rows: [...next], added: [], removed: false };
  const old = new Map(prev.map((r) => [r.key, r]));
  const added: string[] = [];
  const rows = next.map((r) => {
    const o = old.get(r.key);
    if (!o) {
      added.push(r.key);
      return r;
    }
    return sameRow(o, r) ? o : r;
  });
  const nextKeys = new Set(next.map((r) => r.key));
  return { rows, added, removed: prev.some((r) => !nextKeys.has(r.key)) };
}

const WILDCARD = new Set(["0.0.0.0", "[::]"]);

export function copyAddress(row: Row): string {
  return `${WILDCARD.has(row.address) ? "localhost" : row.address}:${row.port}`;
}

function isLocal(address: string): boolean {
  return WILDCARD.has(address) || address === "[::1]" || address.startsWith("127.");
}

export function browserUrl(row: Row): string | null {
  if (row.proto !== "TCP") return null;
  return `http://${isLocal(row.address) ? "localhost" : row.address}:${row.port}`;
}

/** Text after the bold process name: " (PID 48213)? It is listening on :3000 and 2 other ports." */
export function stopConfirmTail(row: Row, all: readonly Row[]): string {
  const others = all.filter((r) => r.pid === row.pid).length - 1;
  const more = others > 0 ? ` and ${others} other port${others === 1 ? "" : "s"}` : "";
  return ` (PID ${row.pid})? It is listening on :${row.port}${more}.`;
}

/** Why Stop is unavailable for this row, or null when it can be stopped. */
export function stopBlocked(row: Row, selfPid: number | null): string | null {
  if (row.pid === null) {
    return row.ownership === "kernel"
      ? "This socket belongs to the kernel; there is no process to stop."
      : "Owned by another user. Portside does not run with elevated rights.";
  }
  if (row.pid === selfPid) return "This is Portside itself.";
  if (row.pid === 1) return "PID 1 is the init process and can't be stopped.";
  return null;
}

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** `14:02 · 3 h ago`, prefixed with a short date (`Sep 21 14:02 · 2 d ago`) when not today. */
export function startedLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = d.toDateString() === new Date(now).toDateString();
  const date = today ? "" : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} `;
  return `${date}${time} · ${relativeTime(ms, now)}`;
}
