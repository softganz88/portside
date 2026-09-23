# Portside

What is listening on this port, and can I stop it? Portside lists every listening TCP socket and bound UDP socket on a Linux machine, shows the owning process, and stops it safely (SIGTERM, with an explicit Force stop if it doesn't exit). It reads `/proc` directly, never spawns a shell, and never asks for elevated rights.

![Portside, dark theme](docs/screenshots/main-dark.png)

## Build

Requires Rust (stable), Node 20+, and the Tauri Linux prerequisites:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential file libssl-dev
npm install
npm run tauri dev       # run in development
npm run tauri build     # release binary + .deb + AppImage under src-tauri/target/release/bundle/
```

Checks:

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd ..
npx tsc --noEmit && npx vitest run
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` or `Ctrl+F` | Focus filter |
| `Esc` | In filter: clear it, then return focus to list · In dialog: cancel |
| `↑` / `↓` | Move selection |
| `Home` / `End` | First / last row |
| `PgUp` / `PgDn` | Move by a page |
| `Enter` | From filter: focus list and select first row |
| `Alt+1` / `Alt+2` / `Alt+3` | Protocol All / TCP / UDP |
| `Ctrl+C` | Copy address of selected row |
| `Ctrl+Shift+C` | Copy PID |
| `O` | Open in browser (TCP rows) |
| `Delete` | Stop selected process |
| `P` | Pause / resume auto-refresh |
| `F5` or `Ctrl+R` | Refresh now |
| `?` | Show shortcuts overlay |

Filter tips: `30` matches ports starting with 30; `:8080` matches port 8080 exactly; any other text matches process, command line, user and address.

## Limits

Startup: the `.deb` (or the release binary) shows a populated list in about 0.6 s. The AppImage takes about 1.5 s, because it mounts and decompresses its bundled WebKit on every launch; install the `.deb` if startup time matters.

Sockets owned by other users show as **Restricted**: without root, `/proc/<pid>/fd` of other users can't be read, so their process can't be identified or stopped. This is by design.
