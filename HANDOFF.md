# Portside — handoff

State as of 2026-09-23, commit `ce7173c` on `main`. Read `SPEC.md` and `DESIGN.md` first; they are the source of truth. This file covers what was built, what was verified and how, and what will surprise you. Open work is in `TODO.md`.

## Status

v1 is feature-complete against SPEC §1 "In scope". All gates pass with zero warnings:

| Gate | Result |
|---|---|
| `cargo test` | 14 passed |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 20 passed |
| `npm run tauri build` | `.deb` + AppImage, 0 warnings; both launch and populate |

Screenshots in `docs/screenshots/` are from the current build.

## How it works

- **Backend** (`src-tauri/src/`). `scan_sockets` reads the four `/proc/net` tables, walks `/proc/*/fd` once to map socket inode → PID, and reads comm/cmdline/stat only for PIDs that own a listening socket. It never errors per-process: unreadable data yields a `Restricted` row (`ownership: "other"`). It returns an error only when all four tables are unreadable. A scan takes ~15–35 ms for ~60 sockets. It is an `async` command so it runs off the GTK main thread.
- **Stop.** `stop_process(pid, expectedStartTime, force)` refuses PID 1 and Portside's own PID, then re-reads `/proc/<pid>/stat` field 22 and returns `processChanged` if it differs (PID reuse guard). Then it signals, and polls every 250 ms for up to 3 s. Exit counts as the stat file being gone, the start time changing, or the process being a zombie. A process already gone counts as `exited` (SPEC §5).
- **IPC contract.** `src-tauri/src/model.rs` ↔ `src/types.ts`. They are hand-mirrored, so change both.
- **Frontend** (`src/`). `App.tsx` owns the state. The refresh loop is a chained `setTimeout(2000)` scheduled after each scan resolves, so scans never overlap, and manual refreshes coalesce onto the in-flight scan. `mergeScan` in `logic.ts` reuses row objects when unchanged so memoized rows skip re-render; that's how selection, sort and scroll survive refreshes. Auto-refresh pauses on user pause, minimize (`onResized` + `isMinimized()`) and `visibilitychange`.

## Decisions worth knowing

| Decision | Why |
|---|---|
| Window starts hidden (`visible: false`), shown on `PageLoadEvent::Finished`, plus an unconditional show after 2 s (`lib.rs`) | Showing the window before WebKit's web process is up makes the UI process wait out a **500 ms sync-IPC timeout** on ~half of launches. Found with strace: main thread timed `futex` wait after sending on the web-process IPC socket. Hidden-until-loaded removed it (binary ≥1 s launches: 8/20 → 0/20). The 2 s fallback exists because a hanging load or a crashed web process never fires `Finished`; without it the app ran with no window. |
| window-state plugin restores everything **except** `VISIBLE` | Restoring visibility would show the window immediately and bring the stall back. |
| Dark mode: `follow_gtk_dark_theme()` sets GTK's prefer-dark when the GTK theme name (or `GTK_THEME`) contains "dark" | Cinnamon expresses dark mode via the theme name (`Mint-Y-Dark-Aqua`) while the freedesktop portal reports "no preference", so WebKit would render light. The `gtk` crate is a direct dependency only for this (already compiled in via Tauri). |
| CSS `::-webkit-scrollbar` styling | WebKitGTK's native overlay scrollbars paint **above** modal `<dialog>`s. |
| Proto badge has a `--bg` fill | Light `--success` on `--selected` is 4.38:1, under AA. The fill keeps DESIGN's hex values unchanged. |
| "Copy command" button | SPEC §1 lists copy command line; DESIGN's action list omits it. SPEC wins. |
| Sort headers are Tab stops | Otherwise sorting isn't keyboard-reachable; the rows remain a single roving tab stop. |
| No list virtualization | Not measured as needed; marked `ponytail:` in `Table.tsx`. See TODO. |

Wording SPEC doesn't specify, chosen during the build (change freely):
- Kernel-row Stop tooltip: "This socket belongs to the kernel; there is no process to stop."
- Confirm dialog title: "Stop process".
- Copy toasts: "Copied localhost:5432", "Copied PID 48213", "Copied command line".
- Pressing `Delete` on a row that can't be stopped toasts its tooltip reason.

## Acceptance criteria (SPEC §6)

| # | Status | How it was verified |
|---|---|---|
| 1 | ✅ | `python3 -m http.server 8765` row appeared on the next scan |
| 2 | ✅ | `:8765` filter → 1 row, auto-selected, `Showing 1 of 58` |
| 3 | ✅ | Keyboard only (`Delete`, `Tab`, `Enter` via `xdotool key`): confirm opened with Cancel focused, server exited, toast, row gone |
| 4 | ✅ | `bash -c "trap '' TERM; exec nc -l 8766"` → "nc did not exit." after ~3 s, Force stop killed it |
| 5 | ✅ | root / `systemd-resolve` `:53` rows show `Restricted`; Stop disabled with the tooltip |
| 6 | ✅ | `xclip -o` after `Ctrl+C` on `0.0.0.0:8765` → `localhost:8765` |
| 7 | ✅ | Screenshot diff across 10 refreshes: only scrollbar fade and "Updated Ns ago" differ |
| 8 | ✅ | Paused 5 s: new server not shown; `F5` showed it while still paused. Minimize pause: tokio-thread `syscr` (from `/proc/<pid>/task/*/io`) was 0 while minimized |
| 9 | ✅ | WCAG ratios computed from `styles.css` tokens for all 23 fg/bg pairs actually used, per theme. All pass after the badge fix; minimum 5.02:1 text, 5.08:1 focus ring |
| 10 | ⚠️ | Every action done by keyboard, focus rings visible. `prefers-reduced-motion` rule exists but was **not** tested with the system setting on |
| 11 | ✅ | Fixture tests for `tcp`, `tcp6`, `udp`, `udp6` |
| 12 | ⚠️ | Release binary/`.deb`: populated in 518–637 ms (median 566, 20 runs). **AppImage: 1191–1683 ms (median 1506), misses < 1 s.** Its cost is mounting and decompressing bundled WebKit every launch (see TODO) |

## Gotchas for whoever picks this up

- **Don't time startup by polling the screen.** Full-band `get_image` polling slowed the app and roughly doubled the numbers. Use in-app marks instead: temporarily `eprintln!("MARK {ms} name")` at `setup`, `on_page_load`, and a `mark` command invoked from JS after a double `requestAnimationFrame` post-first-scan. Launch 20× and diff against the exec timestamp. Don't commit the marks.
- **strace changes the race.** Full `strace -f` makes every launch stall; `strace -k` makes none stall. Use plain `-f -tt -T` and look for the main thread's `ETIMEDOUT` futex. Ignore JavaScriptCore `pas_scavenger` and GLib thread-pool timeouts; they're idle noise.
- **Window lookup with xdotool.** `xdotool search --pid` also returns windows without `_NET_WM_PID` (e.g. Nemo showing the "Portside" folder). Check `xdotool getwindowpid` and skip the 10×10 GTK leader window. `xdotool key --window` sends synthetic events that WebKit ignores; activate the window and use plain `xdotool key`.
- **Debug build loads `devUrl`** (`http://localhost:1420`); only `npm run tauri build` embeds the frontend. A bare `cargo build --release` produces a binary that also tries `devUrl`.
- **Light-theme screenshots** without touching system settings: `GTK_THEME=Mint-Y ./src-tauri/target/release/portside`.
- **Bundle identifier** is `dev.portside.Portside`. Tauri warns on a `.app` suffix, which breaks the zero-warnings gate.
- The SubagentStop hook in this user's setup runs `cargo test` / `tsc` / `npm test` in the repo; `npm test` is `vitest run --passWithNoTests`.

## History

Built by a lead agent with two parallel implementers: backend (Sonnet) and frontend (Opus), on git worktrees, merged into `main`. After that, a manual verification pass fixed:
- scan blocking the UI thread
- empty-filter `Enter` leaving focus in the filter
- scrollbars over dialogs
- actions hidden below the fold in the details panel (now a sticky footer)
- Cinnamon dark mode
- badge contrast
- the WebKit startup stall and its no-window failure modes

`git log` has one commit per fix.
