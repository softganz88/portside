# Portside

Linux desktop app (Tauri 2 + React 18/TS + Rust) that lists listening TCP/UDP sockets, maps each to its owning process via `/proc`, and stops that process safely. `SPEC.md` (behaviour) and `DESIGN.md` (visuals) are the source of truth and win over any other doc. `prompt.md` is the original brief. `HANDOFF.md` has current state and the reasoning behind decisions; `TODO.md` has open work.

## Commands

From the repo root:

| Task | Command |
|---|---|
| Run in development (Vite on :1420 + debug app) | `npm run tauri dev` |
| Release binary + `.deb` + AppImage (`src-tauri/target/release/bundle/`) | `npm run tauri build` |
| Repack that AppImage for faster startup (run after every `tauri build`) | `npm run repack-appimage` |
| Frontend type-check + bundle only | `npm run build` (`tsc && vite build`) |
| Frontend tests (Vitest) | `npm test` |
| Type-check only | `npx tsc --noEmit` |

In `src-tauri/`: `cargo test`, `cargo clippy --all-targets -- -D warnings`.

No ESLint, Prettier or rustfmt config exists; `tsc` (strict, `noUnusedLocals/Parameters`) and clippy are the linters. Every gate must pass with zero warnings, including `tauri build` warnings.

## Architecture boundaries

- **Backend reads `/proc` directly.** Never shell out to `ss`/`lsof`/`netstat`, never spawn a shell, never request elevated rights (SPEC §1).
  - `proc_net.rs` is a pure parser, tested against `src-tauri/tests/fixtures/{tcp,tcp6,udp,udp6}`.
  - `procs.rs`: inode→PID, comm/cmdline/start time, passwd.
  - `stop.rs`: start-time re-check → signal → 250 ms polling.
  - `lib.rs`: commands and window/theme setup.
- **Per-process failures degrade, never error.** An unreadable PID becomes a `Restricted` row (`ownership: "other"`). `scan_sockets` errors only when all four `/proc/net` tables are unreadable.
- **IPC contract:** `src-tauri/src/model.rs` ↔ `src/types.ts` are hand-mirrored. Change both in the same commit.
- **Keep Tauri commands `async`.** A sync command runs on the GTK main thread and stalls the UI.
- **Frontend:** `src/logic.ts` is pure and unit-tested; put new filter/sort/format rules there with tests. `App.tsx` owns state and the refresh loop. `Table.tsx` renders a windowed list.
- **Capabilities:** a new plugin API needs its permission added to `src-tauri/capabilities/default.json`, which grants only what's used today.
- **Dependencies:** crates stay limited to the brief's set (`serde`, `thiserror`, `nix`) plus what's already in `Cargo.toml` (`tokio` time, `gtk` for theme detection). Plain CSS with DESIGN §4 tokens as custom properties; no UI kit, no Tailwind.

## Conventions

- **Wording:** user-facing strings from SPEC §3/§5 are used verbatim (e.g. "Can't read socket tables from /proc.", "Process changed — refresh and try again.").
- **Colours:** use DESIGN §4 hex values exactly. If a pair fails AA contrast, fix it with fill or layering, not by changing a token (see the badge fill in `styles.css`).
- **Fixed row height:** every row is `ROW_HEIGHT` (32 px, exported from `Table.tsx`). Windowing and `focusRow` scroll math depend on it, so don't make rows variable-height.
- **Scope:** don't add features beyond SPEC §1 "In scope".

## Pitfalls

- **Only `npm run tauri build` embeds the frontend.** The debug binary and a bare `cargo build --release` load `devUrl` (`http://localhost:1420`) and show "Could not connect" without Vite running.
- **Startup window visibility:**
  - The window starts hidden (`visible: false`) and is shown on `PageLoadEvent::Finished`, with an unconditional show after 2 s. That show first navigates to the app URL once if `Finished` never fired.
  - Keep `StateFlags::VISIBLE` excluded from the window-state plugin. Showing earlier brings back WebKit's 500 ms startup IPC stall.
  - Removing the 2 s fallback leaves a hung load or crashed web process running with no window. Its re-navigate must stay a `navigate`, not `reload()`. An early web-process crash leaves no URL to reload, and the window stays blank. To test it, `kill -9` the `WebKitWebProcess` child right after launch.
- **Dark mode on Cinnamon** comes from the GTK theme name (`follow_gtk_dark_theme` in `lib.rs`), because the portal reports "no preference". Test light with `GTK_THEME=Mint-Y ./src-tauri/target/release/portside` rather than changing system settings.
- **Scrollbars:** keep the CSS `::-webkit-scrollbar` rules. WebKitGTK's native overlay scrollbars paint above modal `<dialog>`s.
- **Timing:** measure with temporary in-app marks (`eprintln!` from Rust and a JS `mark` command after a double `requestAnimationFrame`) on a throwaway branch. Screen polling and `strace` both change the startup timing.
- **Driving the app with xdotool:**
  - `search --pid` also matches windows without `_NET_WM_PID` (e.g. Nemo showing this folder), so verify with `getwindowpid` and skip the 10×10 leader window.
  - `key --window` sends synthetic events WebKit ignores; activate the window and use plain `xdotool key`.
- **Releases:** use `/release X.Y.Z` (`.claude/skills/release/`). It's manual-only, so suggest it when a release is asked for. It automates the steps below. The version lives in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, so bump all three together; bundle filenames come from `tauri.conf.json`. Ship the AppImage only after `npm run repack-appimage`, because Tauri's own AppImage is ~0.5 s slower to start and Tauri can't pass the packing options itself. Right after `gh release create`, the by-tag view (`gh release view`/`download`) can list no assets for a while. Check `gh api repos/<owner>/portside/releases/<id>/assets` before re-uploading.
- **AppImage flags:** `--appimage-offset` and `--appimage-extract` return without launching. `--appimage-extract-and-run` and any non-runtime flag (even `--help`) launch Portside, which doesn't exit on its own.
- **Bundle identifier** stays `dev.portside.Portside`. A `.app` suffix triggers a Tauri warning, which breaks the zero-warning gate.
