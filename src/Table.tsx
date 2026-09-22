import { memo, type KeyboardEvent, type RefObject } from "react";
import { displayName, type Sort, type SortCol } from "./logic";
import { LockIcon } from "./icons";
import type { Row } from "./types";

const COLS: { col: SortCol; label: string; num?: boolean }[] = [
  { col: "port", label: "Port", num: true },
  { col: "proto", label: "Proto" },
  { col: "address", label: "Address" },
  { col: "process", label: "Process" },
  { col: "pid", label: "PID", num: true },
  { col: "user", label: "User" },
];

interface RowProps {
  row: Row;
  selected: boolean;
  tabbable: boolean;
  isNew: boolean;
  stopping: boolean;
  onSelect: (key: string) => void;
}

const RowView = memo(function RowView({ row, selected, tabbable, isNew, stopping, onSelect }: RowProps) {
  const cls = `row${selected ? " selected" : ""}${isNew ? " new" : ""}`;
  return (
    <div
      role="row"
      className={cls}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-key={row.key}
      onClick={() => onSelect(row.key)}
    >
      <div role="gridcell" className="num">{row.port}</div>
      <div role="gridcell">
        <span className={row.proto === "TCP" ? "badge tcp" : "badge"}>{row.proto}</span>
      </div>
      <div role="gridcell" className="mono ellipsis" title={row.address}>{row.address}</div>
      <div role="gridcell" className="ellipsis" title={row.cmdline || undefined}>
        {stopping ? (
          <span className="muted">
            <span className="spinner" aria-hidden="true" /> Stopping…
          </span>
        ) : row.process ? (
          row.process
        ) : row.ownership === "kernel" ? (
          <span className="muted">kernel</span>
        ) : (
          <span className="muted">
            <span className="lock"><LockIcon /></span> {displayName(row)}
          </span>
        )}
      </div>
      <div role="gridcell" className={row.pid === null ? "num muted" : "num"}>{row.pid ?? "—"}</div>
      <div role="gridcell" className="ellipsis">{row.user}</div>
    </div>
  );
});

interface Props {
  gridRef: RefObject<HTMLDivElement>;
  rows: Row[] | null; // null = first scan pending
  total: number;
  failed: boolean;
  filterLabel: string;
  selectedKey: string | null;
  newKeys: ReadonlySet<string>;
  stoppingPids: ReadonlySet<number>;
  sort: Sort;
  onSort: (col: SortCol) => void;
  onSelect: (key: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClearFilter: () => void;
}

export function Table(p: Props) {
  const rows = p.rows ?? [];
  const tabKey = rows.some((r) => r.key === p.selectedKey) ? p.selectedKey : rows[0]?.key;

  let empty = null;
  if (p.rows && !p.failed && rows.length === 0) {
    empty =
      p.total === 0 ? (
        <div className="empty">
          <p className="headline">Nothing is listening.</p>
        </div>
      ) : (
        <div className="empty">
          <p className="headline">No sockets match "{p.filterLabel}"</p>
          <button type="button" className="btn" onClick={p.onClearFilter}>Clear filter</button>
        </div>
      );
  }

  return (
    <div className="list" ref={p.gridRef}>
      <div
        role="grid"
        aria-label="Listening sockets"
        aria-rowcount={rows.length + 1}
        aria-busy={p.rows === null}
        tabIndex={-1}
        onKeyDown={p.onKeyDown}
      >
        <div role="row" className="row head">
          {COLS.map(({ col, label, num }) => {
            const active = p.sort.col === col;
            return (
              <div
                key={col}
                role="columnheader"
                aria-sort={active ? (p.sort.dir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button type="button" className={num ? "num" : ""} onClick={() => p.onSort(col)}>
                  {label}
                  {active && <span className="arrow" aria-hidden="true">{p.sort.dir === "asc" ? "▲" : "▼"}</span>}
                </button>
              </div>
            );
          })}
        </div>
        {p.rows === null &&
          Array.from({ length: 6 }, (_, i) => <div key={i} className="row skeleton" aria-hidden="true" />)}
        {/* ponytail: no virtualization; add windowing if a 1000-row render measures >150 ms */}
        {rows.map((r) => (
          <RowView
            key={r.key}
            row={r}
            selected={r.key === p.selectedKey}
            tabbable={r.key === tabKey}
            isNew={p.newKeys.has(r.key)}
            stopping={r.pid !== null && p.stoppingPids.has(r.pid)}
            onSelect={p.onSelect}
          />
        ))}
      </div>
      {empty}
    </div>
  );
}
