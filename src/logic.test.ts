import { describe, expect, it } from "vitest";
import type { Row } from "./types";
import {
  browserUrl,
  copyAddress,
  DEFAULT_SORT,
  matchesFilter,
  mergeScan,
  nextSort,
  relativeTime,
  sortRows,
  startedLabel,
  stopBlocked,
  stopConfirmTail,
} from "./logic";

function row(p: Partial<Row>): Row {
  const base: Row = {
    key: "",
    proto: "TCP",
    family: "IPv4",
    address: "0.0.0.0",
    port: 3000,
    inode: 1,
    pid: 48213,
    process: "node",
    cmdline: "node vite",
    user: "hope",
    startedMs: null,
    startTicks: 1,
    ownership: "own",
  };
  const r = { ...base, ...p };
  return { ...r, key: p.key ?? `${r.proto}${r.address}:${r.port}:${r.inode}` };
}

describe("matchesFilter", () => {
  it(":port is an exact match", () => {
    expect(matchesFilter(row({ port: 8080 }), ":8080", "All")).toBe(true);
    expect(matchesFilter(row({ port: 18080 }), ":8080", "All")).toBe(false);
    expect(matchesFilter(row({ port: 80 }), ":8080", "All")).toBe(false);
  });
  it("port matches by prefix", () => {
    expect(matchesFilter(row({ port: 3000 }), "30", "All")).toBe(true);
    expect(matchesFilter(row({ port: 3001 }), "30", "All")).toBe(true);
    expect(matchesFilter(row({ port: 1300, process: "x", cmdline: "", user: "u" }), "30", "All")).toBe(false);
  });
  it("substring on process, cmdline, user and address, case-insensitive", () => {
    const r = row({ process: "Postgres", cmdline: "/usr/lib/postgresql -D /data", user: "postgres", address: "127.0.0.1" });
    expect(matchesFilter(r, "POSTG", "All")).toBe(true);
    expect(matchesFilter(r, "-d /DATA", "All")).toBe(true);
    expect(matchesFilter(r, "127.0", "All")).toBe(true);
    expect(matchesFilter(r, "nginx", "All")).toBe(false);
  });
  it("matches Restricted and kernel labels", () => {
    expect(matchesFilter(row({ pid: null, process: null, ownership: "other" }), "restr", "All")).toBe(true);
    expect(matchesFilter(row({ pid: null, process: null, ownership: "kernel" }), "kern", "All")).toBe(true);
  });
  it("a lone ':' matches everything, not just IPv6 addresses", () => {
    expect(matchesFilter(row({ address: "0.0.0.0", family: "IPv4" }), ":", "All")).toBe(true);
    expect(matchesFilter(row({ address: "[::1]", family: "IPv6" }), ":", "All")).toBe(true);
  });
  it("ANDs with protocol", () => {
    expect(matchesFilter(row({ proto: "UDP" }), "", "TCP")).toBe(false);
    expect(matchesFilter(row({ proto: "UDP" }), "", "UDP")).toBe(true);
    expect(matchesFilter(row({ proto: "UDP", port: 53 }), ":53", "TCP")).toBe(false);
    expect(matchesFilter(row({ proto: "UDP" }), "  ", "All")).toBe(true);
  });
});

describe("sortRows", () => {
  const a = row({ port: 22 });
  const b = row({ port: 3000, proto: "UDP" });
  const c = row({ port: 3000, proto: "TCP", address: "[::]", family: "IPv6" });
  const d = row({ port: 3000, proto: "TCP", address: "0.0.0.0" });
  const keys = (rs: Row[]) => rs.map((r) => r.key);

  it("default: port asc, TCP before UDP, then address", () => {
    expect(keys(sortRows([b, c, a, d], DEFAULT_SORT))).toEqual(keys([a, d, c, b]));
  });
  it("desc reverses the column but keeps a stable tiebreak", () => {
    expect(keys(sortRows([a, b, c, d], { col: "port", dir: "desc" }))).toEqual(keys([d, c, b, a]));
  });
  it("sorts by process with null pids last on pid asc", () => {
    const k = row({ port: 1, pid: null, process: null, ownership: "kernel" });
    const n = row({ port: 2, pid: 10, process: "alpha" });
    expect(keys(sortRows([k, n], { col: "pid", dir: "asc" }))).toEqual(keys([n, k]));
    expect(keys(sortRows([n, k], { col: "process", dir: "asc" }))).toEqual(keys([n, k]));
    expect(keys(sortRows([n, k], { col: "process", dir: "desc" }))).toEqual(keys([k, n]));
  });
  it("does not mutate its input", () => {
    const input = [b, a];
    sortRows(input, DEFAULT_SORT);
    expect(input).toEqual([b, a]);
  });
  it("sorting by address groups wildcards first, then by family, then numerically", () => {
    const v4wild = row({ port: 1, address: "0.0.0.0", family: "IPv4" });
    const v6wild = row({ port: 2, address: "[::]", family: "IPv6" });
    const v4a = row({ port: 3, address: "10.0.0.5", family: "IPv4" });
    const v4b = row({ port: 4, address: "192.168.1.5", family: "IPv4" });
    const v6a = row({ port: 5, address: "[::1]", family: "IPv6" });
    expect(
      keys(sortRows([v6a, v4b, v6wild, v4a, v4wild], { col: "address", dir: "asc" })),
    ).toEqual(keys([v4wild, v6wild, v4a, v4b, v6a]));
  });
  it("nextSort toggles direction on the same column and resets on a new one", () => {
    const s1 = nextSort(DEFAULT_SORT, "port");
    expect(s1).toEqual({ col: "port", dir: "desc" });
    expect(nextSort(s1, "port")).toEqual({ col: "port", dir: "asc" });
    expect(nextSort(s1, "user")).toEqual({ col: "user", dir: "asc" });
  });
});

describe("mergeScan", () => {
  const a = row({ port: 1 });
  const b = row({ port: 2 });
  it("reports nothing as added on the first scan", () => {
    expect(mergeScan(null, [a, b])).toEqual({ rows: [a, b], added: [], removed: false });
  });
  it("reuses unchanged row objects", () => {
    const m = mergeScan([a, b], [{ ...a }, { ...b, user: "root" }]);
    expect(m.rows[0]).toBe(a);
    expect(m.rows[1]).not.toBe(b);
    expect(m.rows[1].user).toBe("root");
    expect(m.added).toEqual([]);
    expect(m.removed).toBe(false);
  });
  it("reports added keys and removals", () => {
    const c = row({ port: 3 });
    const m = mergeScan([a, b], [a, c]);
    expect(m.added).toEqual([c.key]);
    expect(m.removed).toBe(true);
  });
});

describe("addresses and URLs", () => {
  it("copyAddress maps wildcards to localhost and keeps IPv6 brackets", () => {
    expect(copyAddress(row({ address: "0.0.0.0", port: 5432 }))).toBe("localhost:5432");
    expect(copyAddress(row({ address: "[::]", port: 80 }))).toBe("localhost:80");
    expect(copyAddress(row({ address: "[::1]", port: 3000 }))).toBe("[::1]:3000");
    expect(copyAddress(row({ address: "192.168.1.5", port: 22 }))).toBe("192.168.1.5:22");
  });
  it("browserUrl uses localhost for wildcard and loopback", () => {
    for (const address of ["0.0.0.0", "[::]", "127.0.0.53", "[::1]"]) {
      expect(browserUrl(row({ address, port: 8000 }))).toBe("http://localhost:8000");
    }
    expect(browserUrl(row({ address: "192.168.1.5", port: 80 }))).toBe("http://192.168.1.5:80");
    expect(browserUrl(row({ address: "[fe80::1]", port: 80 }))).toBe("http://[fe80::1]:80");
  });
  it("has no browser URL for UDP", () => {
    expect(browserUrl(row({ proto: "UDP", address: "0.0.0.0" }))).toBeNull();
  });
});

describe("stop confirmation and blocking", () => {
  const r = row({ port: 3000 });
  it("counts other rows of the same pid with pluralization", () => {
    expect(stopConfirmTail(r, [r])).toBe(" (PID 48213)? It is listening on :3000.");
    expect(stopConfirmTail(r, [r, row({ port: 3000, address: "[::]" })])).toBe(
      " (PID 48213)? It is listening on :3000 and 1 other port.",
    );
    const all = [r, row({ port: 3001 }), row({ port: 3002 }), row({ port: 9, pid: 7 })];
    expect(stopConfirmTail(r, all)).toBe(" (PID 48213)? It is listening on :3000 and 2 other ports.");
  });
  it("explains why stop is blocked", () => {
    expect(stopBlocked(row({ pid: null, ownership: "other" }), 5)).toBe(
      "Owned by another user. Portside does not run with elevated rights.",
    );
    expect(stopBlocked(row({ pid: null, ownership: "kernel" }), 5)).toMatch(/kernel/);
    expect(stopBlocked(row({ pid: null, ownership: "own" }), 5)).toBe(
      "Can't identify this process. Portside does not run with elevated rights.",
    );
    expect(stopBlocked(row({ pid: 5 }), 5)).toBe("This is Portside itself.");
    expect(stopBlocked(row({ pid: 1 }), 5)).toBe("PID 1 is the init process and can't be stopped.");
    expect(stopBlocked(row({ pid: 42, startTicks: null }), 5)).toBe(
      "Process changed — refresh and try again.",
    );
    expect(stopBlocked(row({ pid: 42 }), 5)).toBeNull();
  });
});

describe("time", () => {
  const now = new Date(2026, 8, 23, 17, 5, 0).getTime();
  it("relativeTime buckets", () => {
    expect(relativeTime(now - 5_000, now)).toBe("5 s ago");
    expect(relativeTime(now + 5_000, now)).toBe("0 s ago");
    expect(relativeTime(now - 125_000, now)).toBe("2 min ago");
    expect(relativeTime(now - 3 * 3600_000 - 60_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 50 * 3600_000, now)).toBe("2 d ago");
  });
  it("startedLabel shows time today and adds a date otherwise", () => {
    expect(startedLabel(new Date(2026, 8, 23, 14, 2).getTime(), now)).toBe("14:02 · 3 h ago");
    const older = startedLabel(new Date(2026, 8, 21, 9, 7).getTime(), now);
    expect(older).toMatch(/09:07 · 2 d ago$/);
    expect(older).not.toMatch(/^09:07/);
  });
});
