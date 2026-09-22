import type { ReactNode } from "react";
import { browserUrl, displayName, startedLabel, stopBlocked } from "./logic";
import { LockIcon } from "./icons";
import type { Row } from "./types";

interface Props {
  row: Row | null;
  closed: boolean;
  selfPid: number | null;
  error: string | null;
  stopping: boolean;
  onCopyAddress: (row: Row) => void;
  onCopyPid: (row: Row) => void;
  onOpen: (row: Row) => void;
  onStop: (row: Row) => void;
}

export function Details({ row, closed, selfPid, error, stopping, onCopyAddress, onCopyPid, onOpen, onStop }: Props) {
  if (!row || closed) {
    return (
      <aside className="details" aria-label="Socket details">
        <p className="hint">{closed ? "This socket has closed" : "Select a socket to see details."}</p>
      </aside>
    );
  }

  const blocked = stopping ? "Stopping…" : stopBlocked(row, selfPid);
  const url = browserUrl(row);
  const field = (label: string, value: ReactNode, cls = "") => (
    <div className="field">
      <dt>{label}</dt>
      <dd className={cls}>{value}</dd>
    </div>
  );

  return (
    <aside className="details" aria-label="Socket details">
      <h2 className={row.process ? "title" : "title muted"}>
        {row.pid === null && row.ownership !== "kernel" && <span className="lock"><LockIcon size={16} /></span>}
        {displayName(row)}
      </h2>
      <dl>
        {field("Address", `${row.address}:${row.port}`, "mono")}
        {field("Protocol", `${row.proto} · ${row.family}`)}
        {field("PID", row.pid ?? "—", "mono")}
        {field("User", row.user)}
        {field("Started", row.startedMs === null ? "—" : startedLabel(row.startedMs, Date.now()))}
        {field("Command", row.cmdline || "—", row.cmdline ? "command" : "")}
      </dl>
      <div className="actions">
        <button type="button" className="btn" onClick={() => onCopyAddress(row)}>Copy address</button>
        <button
          type="button"
          className="btn"
          disabled={row.pid === null}
          title={row.pid === null ? "The PID of this socket is unknown." : undefined}
          onClick={() => onCopyPid(row)}
        >
          Copy PID
        </button>
        <button
          type="button"
          className="btn"
          disabled={!url}
          title={url ? `Open ${url} (O)` : "Only TCP ports can be opened in a browser."}
          onClick={() => onOpen(row)}
        >
          Open in browser
        </button>
        <hr />
        <button
          type="button"
          className="btn danger-outline"
          aria-disabled={blocked ? true : undefined}
          title={blocked ?? "Stop process (Delete)"}
          onClick={() => !blocked && onStop(row)}
        >
          Stop process
        </button>
      </div>
      <div className="error" role="alert">{error}</div>
    </aside>
  );
}
