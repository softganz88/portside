import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Row, ScanResult, StopResult } from "./types";
import {
  browserUrl,
  copyAddress,
  DEFAULT_SORT,
  displayName,
  matchesFilter,
  mergeScan,
  nextSort,
  sortRows,
  stopBlocked,
  stopConfirmTail,
  type ProtoFilter,
  type SortCol,
} from "./logic";
import { ROW_HEIGHT, Table } from "./Table";
import { Details } from "./Details";
import { Dialog, ShortcutsDialog } from "./Dialog";
import { CheckIcon, PauseIcon, PlayIcon, RefreshIcon, SearchIcon, XIcon } from "./icons";

const INTERVAL = 2000;
const PROTOS: ProtoFilter[] = ["All", "TCP", "UDP"];

type DialogState = { kind: "confirm" | "escalate"; row: Row } | { kind: "help" } | null;

function RefreshState({ updatedAt, paused }: { updatedAt: number | null; paused: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (paused) {
    return (
      <span className="paused">
        <PauseIcon size={12} /> Paused
      </span>
    );
  }
  const ago = updatedAt === null ? "" : `Updated ${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago · `;
  return <span>{ago}Auto-refresh 2s</span>;
}

export default function App() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const rowsRef = useRef<Row[] | null>(null);
  const [selfPid, setSelfPid] = useState<number | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [filter, setFilter] = useState("");
  const [proto, setProto] = useState<ProtoFilter>("All");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selected, setSelected] = useState<string | null>(null);
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(new Set());
  const [stopping, setStopping] = useState<ReadonlySet<number>>(new Set());
  const [stopError, setStopError] = useState<{ key: string; msg: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [spinKey, setSpinKey] = useState(0);

  const filterRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const toastTimer = useRef<number>();

  // Coalesces concurrent callers, so a manual refresh never overlaps the loop's scan.
  const scan = useCallback(() => {
    inflight.current ??= (async () => {
      try {
        const res = await invoke<ScanResult>("scan_sockets");
        const m = mergeScan(rowsRef.current, res.rows);
        rowsRef.current = m.rows;
        setRows(m.rows);
        setSelfPid(res.selfPid);
        setScanFailed(false);
        setUpdatedAt(Date.now());
        if (m.added.length) {
          setNewKeys((s) => new Set([...s, ...m.added]));
          setTimeout(() => {
            setNewKeys((s) => new Set([...s].filter((k) => !m.added.includes(k))));
          }, 1500);
        }
      } catch {
        rowsRef.current = null;
        setRows([]);
        setScanFailed(true);
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  const active = !paused && !minimized && !hidden;
  useEffect(() => {
    if (!active) return;
    let live = true;
    let t: number | undefined;
    const tick = async () => {
      await scan();
      if (live) t = window.setTimeout(tick, INTERVAL);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [active, scan]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    // The initial `hidden` state is seeded from document.hidden at render time; if
    // visibilitychange fired between that render and this effect running, this
    // listener missed it and `hidden` would be stuck. Sync once, right after adding it.
    onVis();
    const win = getCurrentWindow();
    const unlisten = win.onResized(() => {
      win.isMinimized().then(setMinimized, () => setMinimized(false));
    });
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      unlisten.then((u) => u(), () => {});
    };
  }, []);

  const visible = useMemo(
    () => sortRows((rows ?? []).filter((r) => matchesFilter(r, filter, proto)), sort),
    [rows, filter, proto, sort],
  );
  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [r.key, r])), [rows]);
  const selectedRow = (selected && byKey.get(selected)) || null;
  const closed = selected !== null && rows !== null && !selectedRow && !scanFailed;
  const selIndex = visible.findIndex((r) => r.key === selected);
  if (selIndex >= 0) lastIndex.current = selIndex;

  // W1: editing the filter or protocol down to exactly one match selects it.
  // Keyed on [filter, proto] only (not `visible`), so a row closing on a
  // later scan — which can also shrink the visible set to one — never jumps
  // the selection (SPEC §3.2: selection only moves on an arrow key then).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    const cur = visibleRef.current;
    if (cur.length === 1 && (filter.trim() || proto !== "All")) setSelected(cur[0].key);
  }, [filter, proto]);

  const showToast = useCallback((text: string, ok = false) => {
    setToast({ text, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  // Rows are windowed, so the target may not be in the DOM: scroll by index, then focus.
  const focusRow = (key: string) => {
    const list = gridRef.current;
    const i = visible.findIndex((r) => r.key === key);
    if (!list || i < 0) return;
    // Row i spans [(i+1)·h, (i+2)·h) in content coordinates; the sticky header covers the first h.
    if (list.scrollTop > i * ROW_HEIGHT) list.scrollTop = i * ROW_HEIGHT;
    else if (list.scrollTop < (i + 2) * ROW_HEIGHT - list.clientHeight) list.scrollTop = (i + 2) * ROW_HEIGHT - list.clientHeight;
    const focus = () => {
      const el = list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      el?.focus({ preventScroll: true });
      return !!el;
    };
    if (!focus()) requestAnimationFrame(focus);
  };
  const moveTo = (key: string) => {
    setSelected(key);
    focusRow(key);
  };
  const focusList = () => {
    const key = selIndex >= 0 ? selected : visible[0]?.key;
    if (key) focusRow(key);
    else gridRef.current?.querySelector<HTMLElement>("[role=grid]")?.focus();
  };

  // Return focus to the list once a dialog has unmounted (the page is inert while it is open).
  const hadDialog = useRef(false);
  useEffect(() => {
    if (dialog) hadDialog.current = true;
    else if (hadDialog.current) {
      hadDialog.current = false;
      focusList();
    }
  }, [dialog]);

  const refresh = () => {
    setSpinKey((k) => k + 1);
    scan();
  };

  const copy = async (text: string, label: string) => {
    try {
      await writeText(text);
      showToast(`Copied ${label}`);
    } catch {
      showToast("Couldn't copy to clipboard.");
    }
  };
  const copyAddr = (row: Row) => copy(copyAddress(row), copyAddress(row));
  const copyPid = (row: Row) => row.pid !== null && copy(String(row.pid), `PID ${row.pid}`);
  const copyCommand = (row: Row) => row.cmdline && copy(row.cmdline, "command line");
  const open = async (row: Row) => {
    const url = browserUrl(row);
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      showToast(`Couldn't open ${url}: ${String(e)}`);
    }
  };

  const requestStop = (row: Row) => {
    const blocked = row.pid !== null && stopping.has(row.pid) ? "Stopping…" : stopBlocked(row, selfPid);
    if (blocked) showToast(blocked);
    else setDialog({ kind: "confirm", row });
  };

  const stop = async (row: Row, force: boolean) => {
    const pid = row.pid!;
    setDialog(null);
    setStopError(null);
    setStopping((s) => new Set(s).add(pid));
    const fail = (msg: string) => setStopError({ key: row.key, msg });
    try {
      const res = await invoke<StopResult>("stop_process", { pid, expectedStartTime: row.startTicks, force });
      switch (res.kind) {
        case "exited":
          showToast(`Stopped ${displayName(row)} (${pid})`, true);
          break;
        case "stillRunning":
          // Up to 3 s have passed since Stop was sent; the user may have opened
          // another dialog in the meantime. Only pop the escalate dialog when
          // nothing else is open, otherwise report it inline instead of
          // clobbering whatever the user is looking at.
          if (dialogRef.current === null) setDialog({ kind: "escalate", row });
          else fail(`${displayName(row)} did not exit.`);
          break;
        case "processChanged":
          fail("Process changed — refresh and try again.");
          break;
        case "refused":
          fail(res.reason);
          break;
        case "failed":
          fail(res.message);
          break;
      }
    } catch (e) {
      fail(String(e));
    } finally {
      setStopping((s) => {
        const n = new Set(s);
        n.delete(pid);
        return n;
      });
      scan();
    }
  };

  // Also receives window events targeting <body>: focus lands there when the focused row closes.
  type NavEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "preventDefault">;
  const onGridKey = (e: NavEvent) => {
    const n = visible.length;
    if (!n || e.ctrlKey || e.altKey || e.metaKey) return;
    const page = Math.max(1, Math.floor((gridRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);
    const cur = selIndex;
    const from = cur < 0 ? lastIndex.current : cur;
    const step = cur < 0 ? 0 : 1; // a closed or filtered-out selection lands on the nearest row first
    let i: number;
    switch (e.key) {
      case "ArrowDown": i = from + step; break;
      case "ArrowUp": i = from - step; break;
      case "PageDown": i = from + page * step; break;
      case "PageUp": i = from - page * step; break;
      case "Home": i = 0; break;
      case "End": i = n - 1; break;
      default: return;
    }
    e.preventDefault();
    moveTo(visible[Math.min(n - 1, Math.max(0, i))].key);
  };

  const onFilterKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (filter) setFilter("");
      else focusList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[0]) moveTo(visible[0].key);
      else focusList();
    }
  };

  const clearFilter = () => {
    setFilter("");
    setProto("All");
    filterRef.current?.focus();
  };

  // Window-level shortcuts; read through a ref so the listener always sees the latest state.
  const onKey = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === "F5" || (ctrl && !e.shiftKey && k === "r")) {
      e.preventDefault();
      if (!dialog) refresh();
      return;
    }
    if (dialog) return;
    if (e.target === document.body) onGridKey(e);
    const inText = e.target instanceof HTMLInputElement && e.target.type === "text";
    if (ctrl && !e.shiftKey && k === "f") {
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    } else if (e.altKey && !ctrl && /^Digit[123]$/.test(e.code)) {
      e.preventDefault();
      setProto(PROTOS[Number(e.code.slice(5)) - 1]);
    } else if (ctrl && k === "c") {
      if (inText || !selectedRow) return;
      if (e.shiftKey) {
        e.preventDefault();
        copyPid(selectedRow);
      } else if (!window.getSelection()?.toString()) {
        e.preventDefault();
        copyAddr(selectedRow);
      }
    } else if (!inText && !ctrl && !e.altKey) {
      if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setDialog({ kind: "help" });
      } else if (k === "p") {
        setPaused((p) => !p);
      } else if (k === "o" && selectedRow) {
        open(selectedRow);
      } else if (e.key === "Delete" && selectedRow) {
        requestStop(selectedRow);
      }
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const total = rows?.length ?? 0;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="filter">
          <SearchIcon />
          <input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={onFilterKey}
            placeholder="Filter by port, process, user…"
            aria-label="Filter sockets"
            spellCheck={false}
            autoComplete="off"
          />
          {filter ? (
            <button type="button" className="clear" tabIndex={-1} aria-label="Clear filter" title="Clear filter (Esc)" onClick={clearFilter}>
              <XIcon />
            </button>
          ) : (
            <kbd className="hint" aria-hidden="true">/</kbd>
          )}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Protocol">
          {PROTOS.map((v, i) => (
            <label key={v} title={`${v} (Alt+${i + 1})`}>
              <input type="radio" name="proto" value={v} checked={proto === v} onChange={() => setProto(v)} />
              <span>{v}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={paused ? "Resume auto-refresh (P)" : "Pause auto-refresh (P)"}
          title={paused ? "Resume auto-refresh (P)" : "Pause auto-refresh (P)"}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button type="button" className="icon-btn" aria-label="Refresh now (F5)" title="Refresh now (F5)" onClick={refresh}>
          <span key={spinKey} className={spinKey ? "spin" : undefined}>
            <RefreshIcon />
          </span>
        </button>
      </header>

      {scanFailed && (
        <div className="banner" role="alert">
          <span>Can't read socket tables from /proc.</span>
          <button type="button" className="btn" onClick={() => scan()}>Retry</button>
        </div>
      )}

      <main className="main">
        <Table
          gridRef={gridRef}
          rows={rows && visible}
          total={total}
          failed={scanFailed}
          filterLabel={filter.trim() || proto}
          selectedKey={selected}
          newKeys={newKeys}
          stoppingPids={stopping}
          sort={sort}
          onSort={(col: SortCol) => setSort((s) => nextSort(s, col))}
          onSelect={setSelected}
          onKeyDown={onGridKey}
          onFocusRow={focusRow}
          onClearFilter={clearFilter}
        />
        <Details
          row={selectedRow}
          closed={closed}
          selfPid={selfPid}
          error={stopError && stopError.key === selected ? stopError.msg : null}
          stopping={selectedRow?.pid != null && stopping.has(selectedRow.pid)}
          onCopyAddress={copyAddr}
          onCopyPid={copyPid}
          onCopyCommand={copyCommand}
          onOpen={open}
          onStop={requestStop}
        />
      </main>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            {toast.ok && <span className="ok"><CheckIcon /></span>}
            {toast.text}
          </div>
        )}
      </div>

      <footer className="status">
        <span aria-live="polite">{`Showing ${visible.length} of ${total}`}</span>
        <RefreshState updatedAt={updatedAt} paused={paused} />
      </footer>

      {(dialog?.kind === "confirm" || dialog?.kind === "escalate") && (
        <Dialog
          title={dialog.kind === "confirm" ? "Stop process" : `${displayName(dialog.row)} did not exit.`}
          onCancel={() => setDialog(null)}
        >
          {dialog.kind === "confirm" && (
            <p>
              Stop <strong>{displayName(dialog.row)}</strong>
              {stopConfirmTail(dialog.row, rows ?? [])}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setDialog(null)}>
              {dialog.kind === "confirm" ? "Cancel" : "Keep running"}
            </button>
            <button type="button" className="btn danger" onClick={() => stop(dialog.row, dialog.kind === "escalate")}>
              {dialog.kind === "confirm" ? "Stop" : "Force stop"}
            </button>
          </div>
        </Dialog>
      )}
      {dialog?.kind === "help" && <ShortcutsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
