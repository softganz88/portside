// IPC contract shared with `src-tauri/src/model.rs`. Change both together.

export type Proto = "TCP" | "UDP";
export type Family = "IPv4" | "IPv6";
export type Ownership = "own" | "other" | "kernel";

export interface Row {
  /** `proto + address + port + inode`, stable across refreshes. */
  key: string;
  proto: Proto;
  family: Family;
  /** Display form: `0.0.0.0`, `127.0.0.1`, `[::]`, `[::1]`. */
  address: string;
  port: number;
  inode: number;
  pid: number | null;
  process: string | null;
  cmdline: string;
  user: string;
  /** Unix epoch milliseconds. */
  startedMs: number | null;
  /** Clock ticks since boot; pass back to `stop_process` as `expectedStartTime`. */
  startTicks: number | null;
  ownership: Ownership;
}

export interface ScanResult {
  rows: Row[];
  selfPid: number;
}

export type StopResult =
  | { kind: "exited" }
  | { kind: "stillRunning" }
  | { kind: "processChanged" }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; errno: number; message: string };

// Commands:
//   invoke<ScanResult>("scan_sockets")
//   invoke<StopResult>("stop_process", { pid, expectedStartTime, force })
