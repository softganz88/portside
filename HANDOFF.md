# Portside — handoff

State as of 2026-09-23 on `main` (see `git log` for the latest commit). Read `SPEC.md` and `DESIGN.md` first; they are the source of truth. This file covers what was built, what was verified and how, and what will surprise you. Open work is in `TODO.md`.

## Status

v1 is feature-complete against SPEC §1 "In scope". All gates pass with zero warnings:

| Gate | Result |
|---|---|
| `cargo test` | 14 passed |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 20 passed |
| `npm run tauri build` + `npm run repack-appimage` | `.deb` + AppImage, 0 warnings; both launch and populate |

Screenshots in `docs/screenshots/` are from the current build.

## How it works

- **Backend** (`src-tauri/src/`). `scan_sockets` reads the four `/proc/net` tables, walks `/proc/*/fd` once to map socket inode → PID, and reads comm/cmdline/stat only for PIDs that own a listening socket. It never errors per-process: unreadable data yields a `Restricted` row (`ownership: "other"`). It returns an error only when all four tables are unreadable. A scan takes ~15–35 ms for ~60 sockets. It is an `async` command so it runs off the GTK main thread.
- **Stop.** `stop_process(pid, expectedStartTime, force)` refuses PID 1 and Portside's own PID, then re-reads `/proc/<pid>/stat` field 22 and returns `processChanged` if it differs (PID reuse guard). Then it signals, and polls every 250 ms for up to 3 s. Exit counts as the stat file being gone, the start time changing, or the process being a zombie. A process already gone counts as `exited` (SPEC §5).
- **IPC contract.** `src-tauri/src/model.rs` ↔ `src/types.ts`. They are hand-mirrored, so change both.
- **Frontend** (`src/`). `App.tsx` owns the state. The refresh loop is a chained `setTimeout(2000)` scheduled after each scan resolves, so scans never overlap, and manual refreshes coalesce onto the in-flight scan. `mergeScan` in `logic.ts` reuses row objects when unchanged so memoized rows skip re-render; that's how selection, sort and scroll survive refreshes. Auto-refresh pauses on user pause, minimize (`onResized` + `isMinimized()`) and `visibilitychange`.

## Decisions worth knowing

| Decision | Why |
|---|---|
| Window starts hidden (`visible: false`), shown on `PageLoadEvent::Finished`, plus an unconditional show after 2 s that first re-navigates to the app if `Finished` never fired (`lib.rs`) | Showing the window before WebKit's web process is up makes the UI process wait out a **500 ms sync-IPC timeout** on ~half of launches. Found with strace: main thread timed `futex` wait after sending on the web-process IPC socket. Hidden-until-loaded removed it (binary ≥1 s launches: 8/20 → 0/20). The 2 s fallback exists because a hanging load or a crashed web process never fires `Finished`; without it the app ran with no window. Showing alone left a blank window, so the fallback first navigates to the app URL once (`tauri://localhost`, or `devUrl` in dev). It starts a fresh web process. `reload()` doesn't work there, because a web process killed before the first commit leaves the webview with no URL. Verified by killing `WebKitWebProcess` ~140 ms after launch: 3/3 launches came up with the full UI instead of a blank one. |
| AppImage repacked after build (`scripts/repack-appimage.sh`) with its squashfs uncompressed | The AppImage runtime mounts its squashfs through FUSE on every launch, so decompressing ~160 MB of WebKit pages cost ~700 ms. Unpacked, the AppImage is as fast as the bare binary, so bundling itself costs nothing. Tauri can't pass `mksquashfs` options. Block size doesn't close the gap (zstd, 20 interleaved launches each, in-app marks, 2026-09-23): 32 KiB 83 MB / 1222 ms median, 64 KiB 80 MB / 1231 ms, 128 KiB (Tauri's default) 76 MB / 1286 ms, 256 KiB 74 MB / 1442 ms, 1 MiB 77 MB / 1533 ms; every zstd launch was over 1 s. In that run, uncompressed was 858 ms and the bare binary 671 ms. Measured options: zstd 76 MB / ~1.3 s; mixed (only WebKit/JSC/ICU uncompressed) 178 MB / ~0.9–1.0 s with 11 of 50 launches over 1 s (shipped in v0.1.2); **fully uncompressed 225 MB / ~0.8 s, 1 of 60 launches over 1 s (current)**. It runs ~0.2 s behind the bare binary. |
| window-state plugin restores everything **except** `VISIBLE` | Restoring visibility would show the window immediately and bring the stall back. |
| Dark mode: `follow_gtk_dark_theme()` sets GTK's prefer-dark when the GTK theme name (or `GTK_THEME`) contains "dark" | Cinnamon expresses dark mode via the theme name (`Mint-Y-Dark-Aqua`) while the freedesktop portal reports "no preference", so WebKit would render light. The `gtk` crate is a direct dependency only for this (already compiled in via Tauri). |
| CSS `::-webkit-scrollbar` styling | WebKitGTK's native overlay scrollbars paint **above** modal `<dialog>`s. |
| Proto badge has a `--bg` fill | Light `--success` on `--selected` is 4.38:1, under AA. The fill keeps DESIGN's hex values unchanged. |
| "Copy command" button | SPEC §1 lists copy command line; DESIGN's action list omits it. SPEC wins. |
| Sort headers are Tab stops | Otherwise sorting isn't keyboard-reachable; the rows remain a single roving tab stop. |
| List windowing in `Table.tsx`: only rows near the viewport (10 above/below overscan) are in the DOM; spacers stand in for the rest | At 1,234 sockets, rendering every row made first render 483–599 ms, filter clear 336–396 ms and sort 228–342 ms. With windowing: 72–110, 20–41 and 13–51 ms. Refresh cycles stay 62–91 ms and filter keystrokes 15–32 ms. `focusRow` scrolls by index (fixed 32 px rows) because the target may not be rendered. When the selected row is out of the DOM, a zero-height stand-in after the header holds the Tab stop so the order stays headers → row. |

Wording SPEC doesn't specify, chosen during the build (change freely):
- Kernel-row Stop tooltip: "This socket belongs to the kernel; there is no process to stop."
- Own-uid row with an unresolved pid (rare: same-user process whose `/proc/<pid>/fd` couldn't be walked) Stop tooltip: "Can't identify this process. Portside does not run with elevated rights." `ownership` is derived from `uid == getuid()` (SPEC §2's literal definition), not from pid resolvability, so this case is distinct from `other` and needed its own, truthful wording.
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
| 10 | ✅ | Every action done by keyboard, focus rings visible. Reduced motion: with Cinnamon animations off (`org.cinnamon.desktop.interface enable-animations false` → GTK `gtk-enable-animations` false → WebKit `prefers-reduced-motion: reduce`), a new row got no highlight and the refresh icon didn't rotate; with animations on, the highlight faded over ~1.4 s and the icon rotated |
| 11 | ✅ | Fixture tests for `tcp`, `tcp6`, `udp`, `udp6` |
| 12 | ✅ | Release binary/`.deb`: populated in 518–637 ms (median 566, 20 runs). AppImage after `npm run repack-appimage` (uncompressed): medians 779–875 ms across four runs of 10–20 launches, 1 of 60 launches over 1 s (1122 ms). Unrepacked AppImage: ~1.3 s. Measured with in-app marks; machine speed varied ~12% between sessions (bare binary 566 → 634 ms median) |

## Gotchas for whoever picks this up

- **Don't time startup by polling the screen.** Full-band `get_image` polling slowed the app and roughly doubled the numbers. Use in-app marks instead: temporarily `eprintln!("MARK {ms} name")` at `setup`, `on_page_load`, and a `mark` command invoked from JS after a double `requestAnimationFrame` post-first-scan. Launch 20× and diff against the exec timestamp. Don't commit the marks. The `startup-bench` skill (`.claude/skills/startup-bench/bench.sh`) automates all of this, including rebuilding the original checkout afterwards.
- **strace changes the race.** Full `strace -f` makes every launch stall; `strace -k` makes none stall. Use plain `-f -tt -T` and look for the main thread's `ETIMEDOUT` futex. Ignore JavaScriptCore `pas_scavenger` and GLib thread-pool timeouts; they're idle noise.
- **Window lookup with xdotool.** `xdotool search --pid` also returns windows without `_NET_WM_PID` (e.g. Nemo showing the "Portside" folder). Check `xdotool getwindowpid` and skip the 10×10 GTK leader window. `xdotool key --window` sends synthetic events that WebKit ignores; activate the window and use plain `xdotool key`.
- **Debug build loads `devUrl`** (`http://localhost:1420`); only `npm run tauri build` embeds the frontend. A bare `cargo build --release` produces a binary that also tries `devUrl`.
- **Light-theme screenshots** without touching system settings: `GTK_THEME=Mint-Y ./src-tauri/target/release/portside`.
- **AppImage flags:** `--appimage-offset` and `--appimage-extract` return without launching. `--appimage-extract-and-run` and any other flag (even `--help`) launch the app. `--appimage-extract-and-run` also leaves `/tmp/appimage_extracted_*` behind if the app is killed.
- **Bundle identifier** is `dev.portside.Portside`. Tauri warns on a `.app` suffix, which breaks the zero-warnings gate.
- The SubagentStop hook in this user's setup runs `cargo test` / `tsc` / `npm test` in the repo; `npm test` is `vitest run`.

## History

Built by a lead agent with two parallel implementers: backend (Sonnet) and frontend (Opus), on git worktrees, merged into `main`. After that, a manual verification pass fixed:
- scan blocking the UI thread
- empty-filter `Enter` leaving focus in the filter
- scrollbars over dialogs
- actions hidden below the fold in the details panel (now a sticky footer)
- Cinnamon dark mode
- badge contrast
- the WebKit startup stall and its no-window failure modes

Later work, each measured before and after with in-app marks:
- list windowing for 1,000+ sockets, plus a fix keeping the sort headers in the Tab order
- the AppImage repack step

Releases: v0.1.0 to v0.1.3 on GitHub (`softganz88/portside`). Cut the next one with `/release X.Y.Z` (`.claude/skills/release/`); its `--publish` step hasn't run against a real release yet. v0.1.2 shipped the mixed-compression AppImage; v0.1.3 ships the fully uncompressed one.

`git log` has one commit per fix.
