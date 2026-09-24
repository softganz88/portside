# Portside — Specification

Portside is a compact Linux desktop app that answers one question fast: **"What is listening on this port, and can I stop it?"** It lists every listening TCP socket and bound UDP socket on the machine, shows which process owns it, and lets the user stop that process safely.

Target platform: Linux (developed and tested on Linux Mint 22.1, Cinnamon/X11). No macOS/Windows support in v1.

---

## 1. Scope

### In scope (v1)
- Live list of listening sockets: TCP LISTEN and unconnected UDP, IPv4 and IPv6.
- Owning process per socket: name, PID, user, full command line, start time.
- Text filter and protocol filter (All / TCP / UDP).
- Details panel for the selected row.
- Stop a process (SIGTERM), with an escalation to Force stop (SIGKILL) if it does not exit.
- Copy address (`host:port`), copy PID, copy command line.
- Open a TCP port in the default browser.
- Auto-refresh every 2 seconds, with pause and manual refresh.
- Light and dark theme, following the system setting.
- Full keyboard operation.

### Out of scope (v1)
- Established/outgoing connections, traffic stats, bandwidth graphs.
- Firewall rules, port forwarding, remote hosts.
- Privilege escalation (`sudo`, `pkexec`). Portside never runs as root and never asks for a password.
- Settings screen, tray icon, notifications, history/logging.
- Docker/container awareness beyond what `/proc` shows.

---

## 2. Data model

One **row** = one listening socket.

| Field | Source | Notes |
|---|---|---|
| `key` | `proto + local address + port + inode` | Stable identity across refreshes |
| `proto` | file read | `TCP` or `UDP` (v4 and v6 collapse into the same label) |
| `family` | file read | `IPv4` / `IPv6` |
| `address` | `/proc/net/{tcp,tcp6,udp,udp6}` | Displayed as `0.0.0.0`, `127.0.0.1`, `[::]`, `[::1]`, etc. |
| `port` | same | Integer 1–65535 |
| `inode` | same | `0` means kernel-owned, no process |
| `pid` | `/proc/<pid>/fd/*` → `socket:[inode]` | `null` if not resolvable |
| `process` | `/proc/<pid>/comm` | `null` if not resolvable |
| `cmdline` | `/proc/<pid>/cmdline` (NUL → space) | May be empty for kernel threads |
| `user` | socket `uid` column → `/etc/passwd` | Always available, even when `pid` is not |
| `started` | `/proc/<pid>/stat` field 22 + boot time | Local time; `null` if not resolvable |
| `ownership` | derived | `own` (same uid as Portside), `other` (different uid, PID unresolved), `kernel` (inode 0) |

Socket selection rules:
- TCP: state `0A` (LISTEN) only.
- UDP: state `07` with remote address all zeros (bound, unconnected).
- IPv4 and IPv6 sockets on the same port are **separate rows**.
- One process owning several sockets produces several rows.

---

## 3. Core features and expected behavior

### 3.1 Socket list
- Columns: **Port**, **Proto**, **Address**, **Process**, **PID**, **User**.
- Default sort: Port ascending, then Proto (TCP before UDP), then Address.
- Clicking a column header sorts by it; clicking again reverses. Sort indicator shows direction.
- Rows the user cannot resolve show Process as `Restricted` and PID as `—`.
- Kernel-owned rows show Process as `kernel` and PID as `—`.

### 3.2 Refresh
- Auto-refresh every 2000 ms while the window is visible and not paused.
- Refresh is diff-based: selection, scroll position and sort are preserved.
- New rows get a brief highlight (1.5 s). Rows that disappear are removed; if the removed row was selected, the details panel shows "This socket has closed" and selection moves to the nearest remaining row only when the user presses an arrow key.
- Pause toggle stops auto-refresh; status bar shows `Paused`. Manual refresh works while paused.
- A scan that takes longer than the interval never overlaps: the next scan starts only after the previous one finishes.
- When the window is minimized, auto-refresh stops and resumes on restore (with an immediate scan).

### 3.3 Filtering
- Single text field. Matches case-insensitively against port (exact prefix: `30` matches 3000 and 3001), process name, command line, user and address.
- `:8080` matches port 8080 exactly.
- Protocol segmented control: All / TCP / UDP. Combined with the text filter using AND.
- Filter applies instantly (no debounce needed below 2000 rows).
- Status bar shows `Showing N of M`.

### 3.4 Details panel
Shows for the selected row: process name (large), full address, protocol + family, PID, user, started time (absolute and relative, e.g. `14:02 · 3 h ago`), full command line (wrapping, selectable), and actions:
- **Copy address** — copies `host:port` (IPv6 wrapped in brackets). For `0.0.0.0` / `[::]`, copies `localhost:port`.
- **Copy PID** — disabled when PID is unknown.
- **Open in browser** — TCP only; opens `http://localhost:<port>` for wildcard/loopback addresses, otherwise `http://<address>:<port>`.
- **Stop process** — see 3.5.

### 3.5 Stopping a process
1. User triggers Stop (button or `Delete`).
2. Confirmation dialog: "Stop **node** (PID 48213)? It is listening on :3000 and 2 other ports." Buttons: **Cancel** (default focus) / **Stop**.
3. On Stop: send SIGTERM. The row shows a `Stopping…` state.
4. Poll every 250 ms for up to 3 s for the PID to exit.
5. Exited → toast "Stopped node (48213)"; rows removed on the next scan.
6. Still alive after 3 s → dialog "node did not exit." Buttons: **Keep running** (default focus) / **Force stop**. Force stop sends SIGKILL, then same 3 s poll.
7. Failure (EPERM, ESRCH, etc.) → inline error in the details panel with the reason in plain words.

Stop is **disabled** (with tooltip explaining why) when:
- PID is unknown (`other` or `kernel` ownership) — tooltip: "Owned by another user. Portside does not run with elevated rights."
- The PID is Portside itself.
- The PID is 1.

---

## 4. User workflows

**W1 — "Something is already using port 3000."**
Launch → type `3000` → one row appears, selected automatically when it is the only match → details show `node … vite` → `Delete` → `Enter` on Stop → toast → row disappears.

**W2 — "What is my machine exposing?"**
Launch → sort by Address → wildcard rows (`0.0.0.0`, `[::]`) group together → select each to read its command line.

**W3 — "Which port did my dev server pick?"**
Launch while the server starts → new row flashes → `O` opens it in the browser.

**W4 — "Grab the address for a config file."**
Filter `postgres` → select row → `Ctrl+C` copies `localhost:5432`.

---

## 5. Edge cases

| Case | Behavior |
|---|---|
| `/proc/net/*` unreadable | Full-width error banner: "Can't read socket tables from /proc." List empty; Retry button. |
| Some `/proc/<pid>/fd` unreadable (other users) | Rows still shown with `Restricted`; no error. |
| Process exits between scan and render | Row removed on next scan; if a Stop was in progress it counts as success. |
| PID reused by a new process during Stop | Before sending any signal, re-verify the PID's start time matches the row; if not, abort with "Process changed — refresh and try again." |
| Same port on IPv4 and IPv6 | Two rows; Stop confirmation counts all ports the PID owns. |
| Zero listening sockets | Empty state: "Nothing is listening." |
| Filter matches nothing | Empty state: "No sockets match "…"" with a Clear filter button. |
| Very long command lines | Truncated with ellipsis in the table; full text wraps in details. |
| 1000+ sockets | List stays responsive (scan + render under 150 ms on a typical machine). |
| Non-UTF-8 bytes in cmdline | Lossy decode (U+FFFD), never crash. |
| Clipboard unavailable | Toast "Couldn't copy to clipboard." |
| Opening the browser fails | Toast "Couldn't open <url>: <error>", with the error text from the opener. |

---

## 6. Acceptance criteria

1. Starting `python3 -m http.server 8765` shows a TCP row for port 8765 with process `python3` within 2 s.
2. Filter `:8765` shows exactly that server's rows; `Showing N of M` is correct.
3. Stopping that server via keyboard only (`Delete`, `Tab` to Stop, `Enter`) ends the process and the row disappears within the next scan.
4. A process that ignores SIGTERM (`trap '' TERM; sleep 999` bound via `nc -l`) triggers the Force stop dialog after ~3 s; Force stop ends it.
5. Sockets owned by root (e.g. `systemd-resolved` on :53) appear with `Restricted` or resolved name, and Stop is disabled with an explanatory tooltip.
6. `Copy address` on a `0.0.0.0:5432` row puts `localhost:5432` on the clipboard.
7. Selection, sort and scroll are unchanged across 10 consecutive auto-refreshes with no socket changes.
8. Pause stops scans (verified by a new server not appearing) and manual refresh still works.
9. Both themes meet WCAG 2.1 AA contrast for all text and focus indicators (values in DESIGN.md).
10. Every action is reachable by keyboard; focus is always visible; `prefers-reduced-motion` disables the row highlight animation.
11. Rust parser unit tests pass against fixture copies of `/proc/net/tcp`, `tcp6`, `udp`, `udp6`.
12. Release binary + AppImage/.deb build successfully; app cold-starts to a populated list in under 1 s.
