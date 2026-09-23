# Portside — TODO

Open work, highest priority first. Context for each item is in `HANDOFF.md`.

## Acceptance gaps

- [ ] **AppImage cold start is borderline.** After `npm run repack-appimage` it's ~0.9–1.0 s, and about 1 launch in 4 goes over the 1 s AC12 target (the `.deb` meets it at ~0.57 s). Options:
  - repack fully uncompressed: 225 MB, ~0.78 s, 0 of 20 launches over 1 s. It's a one-line change in `scripts/repack-appimage.sh`.
  - an AppImage that uses the system WebKitGTK instead of bundling it
  - keep it as is, with the `.deb` as the primary artifact (already stated in the README)

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
