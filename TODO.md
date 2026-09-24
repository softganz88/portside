# Portside — TODO

Open work, highest priority first. Context for each item is in `HANDOFF.md`.

## Distribution

- [ ] **AppImage size.** Storing the squashfs uncompressed for startup speed makes the AppImage 225 MB (76 MB compressed). An AppImage that uses the system WebKitGTK would be small and fast but lose portability; otherwise keep pointing size-sensitive users at the `.deb` (3.5 MB).

## Robustness

- [ ] **Load that fails twice.** The 2 s safety net retries the load once. If that retry also fails, the window still shows blank. A native fallback message would cover it. Also, only the crashed-web-process case was reproduced; a hanging load wasn't.
- [ ] **Web process crash after startup** isn't handled (e.g. a GPU-driver crash mid-session leaves a dead view). Consider listening for WebKit's `web-process-terminated` and reloading.
- [ ] **Live theme switching.** Theme-name changes are followed via `connect_gtk_theme_name_notify`, but switching Cinnamon from dark to light while running wasn't tested. The code only ever *sets* prefer-dark, never clears it.

## Polish

- [ ] **Narrow layout (< 700 px).** A thin horizontal scrollbar can appear under the action row when the five buttons don't quite fit. Consider shorter labels at narrow widths, or wrapping the row.
- [ ] **Details panel at default height.** The fields scroll under the pinned actions; a long command pushes USER/STARTED out of view. Consider tighter field spacing (DESIGN §3 allows reading "section gap 16px" as between groups, not every field).
- [ ] **Grid focus with no rows.** Focusing the empty list draws the focus ring as a thin line under the header. Give the empty-state container the focus ring instead.
- [ ] **Review wording the build invented** (listed in `HANDOFF.md`): the confirm dialog title, the copy toasts, and the `Delete`-on-blocked-row toast.

## Housekeeping

- [ ] Add a CI job running the four gates plus `npm run tauri build && npm run repack-appimage`.
- [ ] Automate the manual acceptance checks: an xdotool script for AC1–8 would make regressions visible. Mind the xdotool gotchas in `HANDOFF.md`.
