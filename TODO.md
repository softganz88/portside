# Portside — TODO

Open work, highest priority first. Context for each item is in `HANDOFF.md`.

## Acceptance gaps

- [ ] **AppImage cold start is ~1.5 s** (AC12 wants < 1 s; the `.deb` meets it at ~0.57 s). Every phase is slower than the plain binary: +440 ms before `setup`, +260 ms to show, +220 ms to paint. That points at mounting and decompressing the bundled WebKit on each launch. Options to try:
  - an AppImage that uses the system WebKitGTK instead of bundling it
  - a less CPU-heavy squashfs compression
  - accept it and ship the `.deb` as the primary artifact (already stated in the README)
- [ ] **Test `prefers-reduced-motion`** (AC10). The CSS rule exists but hasn't been checked with the system setting on. Enable reduced animations in Cinnamon, confirm new rows get no fade-out highlight, then confirm the refresh icon doesn't spin and dialogs don't animate.
- [ ] **Measure 1000+ sockets** (SPEC §5: scan + render < 150 ms). Only ~60 sockets have been tested. Open ~1000 listeners (e.g. a Python script binding 1000 ports), time scan + first render with in-app marks, and add list windowing only if it misses (see the `ponytail:` note in `Table.tsx`).

## Robustness

- [ ] **Blank window after a failed load.** With a hanging load or a crashed web process, the 2 s safety net shows the window but it stays blank; the user can only close it. Consider a native fallback message, or reloading the webview once when `Finished` hasn't fired by the timeout.
- [ ] **Web process crash after startup** isn't handled (e.g. a GPU-driver crash mid-session leaves a dead view). Consider listening for WebKit's `web-process-terminated` and reloading.
- [ ] **Live theme switching.** Theme-name changes are followed via `connect_gtk_theme_name_notify`, but switching Cinnamon from dark to light while running wasn't tested. The code only ever *sets* prefer-dark, never clears it.

## Polish

- [ ] **Narrow layout (< 700 px).** A thin horizontal scrollbar can appear under the action row when the five buttons don't quite fit. Consider shorter labels at narrow widths, or wrapping the row.
- [ ] **Details panel at default height.** The fields scroll under the pinned actions; a long command pushes USER/STARTED out of view. Consider tighter field spacing (DESIGN §3 allows reading "section gap 16px" as between groups, not every field).
- [ ] **Grid focus with no rows.** Focusing the empty list draws the focus ring as a thin line under the header. Give the empty-state container the focus ring instead.
- [ ] **Review wording the build invented** (listed in `HANDOFF.md`): the kernel Stop tooltip, the confirm dialog title, the copy toasts, and the `Delete`-on-blocked-row toast.

## Housekeeping

- [ ] Add a CI job running the four gates plus `npm run tauri build`.
- [ ] Automate the manual acceptance checks: an xdotool script for AC1–8 would make regressions visible. Mind the xdotool gotchas in `HANDOFF.md`.
- [ ] `SPEC.md` §2 defines `own` as "same uid as Portside", but the backend marks `own` when the PID is resolvable. That's equivalent while Portside runs unprivileged; make it literal if that ever changes.
