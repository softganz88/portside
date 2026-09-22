# Portside — Design

Compact, calm, information-dense. One window, one list, one details panel. It should feel like a well-made system utility, not a dashboard.

---

## 1. Window layout

- Default size **780 × 520**, minimum **560 × 380**. Size and position are restored on launch.
- Native window decorations (Cinnamon title bar). Title: `Portside`.

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar  [🔍 Filter by port, process, user…   ] [All|TCP|UDP] [⏸][⟳] │ 48px
├───────────────────────────────────────────┬──────────────────┤
│ Port ▲  Proto  Address     Process   PID  User │ Details panel    │
│ 22      TCP    0.0.0.0     sshd       —   root │ node             │
│ 3000    TCP    [::1]       node     48213 ht   │ [::1]:3000       │
│ 5432    TCP    127.0.0.1   postgres  912  postg│ TCP · IPv6       │
│ …                                              │ PID 48213 · ht   │
│                                                │ Started 14:02 …  │
│                                                │ Command ▸ …      │
│                                                │ [Copy] [Open]    │
│                                                │ [Stop process]   │
├───────────────────────────────────────────┴──────────────────┤
│ Showing 12 of 12 · Updated 1s ago · Auto-refresh 2s          │ 28px
└──────────────────────────────────────────────────────────────┘
```

- **Toolbar** (48px): filter field grows to fill; protocol segmented control; Pause and Refresh icon buttons.
- **List** fills remaining space; sticky header row.
- **Details panel**: fixed **280px** on the right. Below **700px** window width it moves to a bottom panel **180px** tall with actions in a single row.
- **Status bar** (28px): left = counts; right = refresh state.
- With no selection, the details panel shows a quiet hint: "Select a socket to see details."

---

## 2. Typography

| Role | Font | Size / line height | Weight |
|---|---|---|---|
| UI text | `Inter`, fallback `Noto Sans`, `system-ui` | 13 / 18px | 400 |
| Table header | UI font | 12 / 16px, letter-spacing 0.02em | 600 |
| Numbers (Port, PID, address) | `JetBrains Mono`, fallback `DejaVu Sans Mono`, `monospace` | 13 / 18px, `tabular-nums` | 400 |
| Details title (process name) | UI font | 17 / 24px | 600 |
| Details labels | UI font | 11 / 16px, uppercase, letter-spacing 0.04em | 600 |
| Command line | Mono | 12 / 18px, wraps | 400 |
| Status bar | UI font | 12 / 16px | 400 |

Fonts are bundled (woff2) so the app looks identical on every machine. Text never goes below 11px.

---

## 3. Spacing and shape

- 4px base grid. Tokens: `--s1 4px`, `--s2 8px`, `--s3 12px`, `--s4 16px`, `--s5 24px`.
- Toolbar padding: `8px 12px`; gap between controls `8px`.
- Table row height **32px**; cell padding `0 12px`. Port and PID right-aligned.
- Details panel padding `16px`; section gap `16px`; label-to-value gap `4px`.
- Radius: controls `6px`, dialogs `10px`, toasts `8px`. Rows are square.
- Borders: 1px `--border`. No shadows except dialogs and toasts (`0 8px 24px rgba(0,0,0,.28)` dark / `.12` light).

---

## 4. Color palette

Theme follows `prefers-color-scheme`. All text pairs below are verified WCAG 2.1 AA (≥ 4.5:1); ratios measured against the surface they sit on.

### Dark (default on Mint-Y-Dark)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | `#111418` | Window, list background | — |
| `--surface` | `#181C22` | Toolbar, details panel, status bar | — |
| `--surface-raised` | `#20252D` | Dialogs, toasts, hovered row | — |
| `--border` | `#2A313B` | Dividers, control outlines | — |
| `--text` | `#E6E9EE` | Primary text | 15.2 : 1 on `--bg` |
| `--text-muted` | `#9AA3AF` | Secondary text, labels, `—` | 6.7 : 1 on `--surface` |
| `--accent` | `#5EA8FF` | Focus ring, links, sort arrow, selection bar | 6.9 : 1 on `--surface` |
| `--on-accent` | `#0B1220` | Text on filled accent buttons | 7.6 : 1 on `--accent` |
| `--selected` | `#1E2A3D` | Selected row background | `--text` 11.9 : 1 |
| `--new` | `#5EA8FF` @ 14% | New-row highlight (fades out) | — |
| `--success` | `#4ADE80` | Stopped toast icon, TCP badge text | 9.8 : 1 |
| `--warning` | `#FBBF24` | "Paused" label, Restricted icon | 10.2 : 1 |
| `--danger` | `#F87171` | Stop button, error text | 6.2 : 1 |
| `--on-danger` | `#1A0B0B` | Text on filled danger button | 6.9 : 1 |

### Light

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | `#FFFFFF` | Window, list background | — |
| `--surface` | `#F4F6F9` | Toolbar, details panel, status bar | — |
| `--surface-raised` | `#FFFFFF` | Dialogs, toasts | — |
| `--border` | `#D9DEE5` | Dividers, control outlines | — |
| `--text` | `#15191F` | Primary text | 17.6 : 1 on `--bg` |
| `--text-muted` | `#5A6472` | Secondary text, labels | 5.5 : 1 on `--surface` |
| `--accent` | `#1D5FD1` | Focus ring, links, selection bar | 5.4 : 1 on `--surface` |
| `--on-accent` | `#FFFFFF` | Text on filled accent buttons | 5.8 : 1 |
| `--selected` | `#E8F0FE` | Selected row background | `--text` 15.4 : 1, muted 5.2 : 1 |
| `--new` | `#1D5FD1` @ 10% | New-row highlight | — |
| `--success` | `#15803D` | Success text/icons | 5.0 : 1 |
| `--warning` | `#A16207` | Paused, Restricted | 4.9 : 1 |
| `--danger` | `#C62828` | Stop button, errors | 5.6 : 1 |
| `--on-danger` | `#FFFFFF` | Text on filled danger button | 5.6 : 1 |

Color is never the only signal: protocol badges carry text (`TCP`/`UDP`), Restricted rows carry a lock icon and the word, Paused carries an icon and the word.

---

## 5. Components

**Filter field** — 32px tall, full-width, leading search icon, placeholder "Filter by port, process, user…", trailing `×` clear button when non-empty, trailing hint `/` when empty and unfocused.

**Protocol segmented control** — three 32px segments (All, TCP, UDP). Selected segment: `--surface-raised` fill + `--text`; others `--text-muted`. Behaves as a radio group.

**Icon buttons** (Pause/Resume, Refresh) — 32×32, 16px icon, `aria-label` and tooltip with shortcut ("Pause auto-refresh (P)"). Refresh icon spins once (400 ms) per manual refresh.

**Table**
- Header: `--surface`, sticky, bottom border. Sortable headers are buttons; active one shows ▲/▼ in `--accent`.
- Row: 32px. Hover `--surface-raised`. Selected `--selected` + 3px left bar in `--accent`.
- Proto badge: 11px mono text in a 1px `--border` pill, `TCP` / `UDP`.
- Restricted process: lock icon + "Restricted" in `--text-muted`, italic off.
- `Stopping…` row state: process cell replaced by a small spinner + "Stopping…" in `--text-muted`.

**Details panel** — process name title, then label/value pairs (ADDRESS, PROTOCOL, PID, USER, STARTED, COMMAND). Command in a mono block with `--bg` fill, 8px padding, 6px radius, max 6 lines then scroll. Actions: `Copy address`, `Copy PID`, `Open in browser` as secondary buttons; `Stop process` as danger-outline button at the bottom, separated by a divider.

**Buttons**
- Primary: `--accent` fill, `--on-accent` text.
- Secondary: transparent, 1px `--border`, `--text`.
- Danger outline: transparent, 1px `--danger`, `--danger` text; in the confirm dialog the Stop button is danger filled (`--danger` + `--on-danger`).
- Height 32px, padding `0 12px`, 13px/600 label.

**Confirm dialog** — 380px wide, centered, modal with `rgba(0,0,0,.5)` scrim. Title, one-sentence body, right-aligned buttons (Cancel left of Stop). Focus trapped; Cancel focused on open.

**Toast** — bottom-center above status bar, 8px radius, auto-dismiss 3 s, `role="status"`. Max one visible; new replaces old.

**Error banner** — full width under toolbar, `--danger` left border 3px, `--surface` fill, message + Retry button.

**Empty states** — centered in the list: 15px `--text` headline, 13px `--text-muted` sub-line, optional secondary button.

---

## 6. Interaction states

| State | Treatment |
|---|---|
| Hover (row/button) | `--surface-raised` background; cursor pointer on clickable elements only |
| Focus-visible | 2px `--accent` outline, 2px offset (controls); rows use inset 2px outline so it isn't clipped |
| Active/pressed | Background one step darker (dark: `#262C35`, light: `#E9EDF2`) |
| Disabled | 40% opacity on the control, tooltip explains why, not focusable via Tab (still discoverable via tooltip on hover) — except Stop, which stays focusable with `aria-disabled="true"` so keyboard users hear the reason |
| Selected row | `--selected` + accent bar |
| New row | `--new` background fading to transparent over 1.5 s; none with reduced motion |
| Loading (first scan) | 6 skeleton rows in `--surface-raised`, no shimmer |
| Paused | Pause button shows Play icon; status bar "⏸ Paused" in `--warning` |

Motion: 120 ms ease-out for hover/selection, 160 ms for dialogs. All animation disabled under `prefers-reduced-motion: reduce`.

---

## 7. Keyboard and accessibility

| Key | Action |
|---|---|
| `/` or `Ctrl+F` | Focus filter |
| `Esc` | In filter: clear it, then return focus to list · In dialog: cancel |
| `↑` / `↓` | Move selection |
| `Home` / `End` | First / last row |
| `PgUp` / `PgDn` | Move by a page |
| `Enter` | From filter: focus list and select first row |
| `Alt+1` / `Alt+2` / `Alt+3` | Protocol All / TCP / UDP |
| `Ctrl+C` | Copy address of selected row (when focus is not in a text field) |
| `Ctrl+Shift+C` | Copy PID |
| `O` | Open in browser (TCP rows) |
| `Delete` | Stop selected process (opens confirm) |
| `P` | Pause / resume auto-refresh |
| `F5` or `Ctrl+R` | Refresh now |
| `?` | Show shortcuts overlay |

- Tab order: Filter → Protocol → Pause → Refresh → List → Details actions.
- List uses `role="grid"` with `aria-rowcount`, `aria-selected`, roving tabindex (one tab stop).
- Column headers expose `aria-sort`.
- Status bar count and toasts are `aria-live="polite"`; errors `aria-live="assertive"`.
- Auto-refresh never moves focus and never announces unchanged data.
- All targets ≥ 32×32px. Layout works at 200% zoom down to the minimum window size.
