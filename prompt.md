# Build prompt — Portside

Build **Portside**, a compact Linux desktop app that shows every listening TCP/UDP socket, which process owns it, and lets the user stop that process safely. Target Linux Mint 22.1 (Cinnamon/X11). `SPEC.md` (behavior) and `DESIGN.md` (visuals) in this folder are the source of truth; if this prompt and those files ever disagree, they win.

## Goal
Answer "what's on port X, and can I stop it?" in under five seconds, fully by keyboard, in a window that looks native and calm in light and dark themes.

## Stack
- **Tauri 2.x** shell; plugins: `window-state`, `clipboard-manager`, `opener`.
- **Frontend:** React 18 + TypeScript (strict) + Vite. Plain CSS with custom properties for the tokens in DESIGN.md — no UI kit, no Tailwind.
- **Backend:** Rust. Read `/proc` directly (no `ss`/`lsof`/`netstat` subprocesses). Crates: `serde`, `thiserror`, `nix` (signals, uid). No database.
- **Tests:** `cargo test` for parsers with fixture files; Vitest for filter/sort logic.

## Requirements
1. Rust command `scan_sockets()` parses `/proc/net/{tcp,tcp6,udp,udp6}` (TCP LISTEN, unconnected UDP), maps inode → PID via `/proc/*/fd`, and returns the rows defined in SPEC §2. Unreadable per-process data yields `Restricted` rows, never an error.
2. Rust command `stop_process(pid, expected_start_time, force)` re-verifies start time before signalling (SIGTERM, or SIGKILL when `force`), refuses PID 1 and Portside's own PID, and returns a typed result.
3. Frontend implements the list, filter, protocol control, details panel, confirm/escalate dialogs, toasts, status bar and every shortcut exactly as in SPEC §3 and DESIGN §5–7.
4. Auto-refresh every 2 s, non-overlapping, diff-based (selection/sort/scroll preserved), paused when minimized or when the user pauses.
5. Theme follows `prefers-color-scheme` using the exact hex values in DESIGN §4. Bundle Inter and JetBrains Mono.
6. Never request elevated privileges. Never spawn a shell.
7. Handle every edge case in SPEC §5 with the listed wording.

## Completion criteria
- All 12 acceptance criteria in SPEC §6 pass; list which were verified manually and how.
- `cargo test`, `cargo clippy -- -D warnings`, `tsc --noEmit` and `vitest run` pass with zero warnings.
- `npm run tauri build` produces a working `.deb` and AppImage.
- Screenshots of the main window in dark and light themes, the Stop confirm dialog, and the narrow (<700px) layout, saved to `docs/screenshots/`.
- A short `README.md` with build steps and the shortcut table.

Do not add features beyond SPEC §1 "In scope".
