---
name: release
description: Cut a Portside release — bump the version everywhere, run every gate, build and repack the AppImage, smoke-launch it, write release notes, then publish to GitHub and verify the assets. Use for "release", "cut a release", "ship X.Y.Z", "publish a new version".
argument-hint: X.Y.Z
disable-model-invocation: true
---

# Release

The release runs in two steps with a user checkpoint between them. A GitHub release is public, so never run `--publish` without the user's explicit go-ahead on the notes.

## 1. Build (local, reversible)

```bash
.claude/skills/release/release.sh X.Y.Z
```

- Refuses to run on a dirty tree, off `main`, or if tag `vX.Y.Z` already exists.
- Bumps the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package-lock.json`. `Cargo.lock` updates during the build, and it rewrites the bundle filenames in `README.md`.
- Gates: `cargo test`, `clippy -D warnings` and `npm test`, then `tauri build`, which fails on any line containing "warn". It then runs `repack-appimage` and checks that the squashfs is uncompressed.
- Smoke test: it launches the AppImage and waits up to 15 s for a window owned by that PID, then checks that the `.deb` contains `usr/bin/portside`.
- It prints the SHA-256 checksums and leaves the bump uncommitted. To undo it: `git checkout -- .`

Then, before publishing:
1. Update the "Releases:" line at the end of `HANDOFF.md`.
2. If the release changes behaviour or startup, measure it with the `startup-bench` skill and put the numbers in the notes.
3. Write the notes to a scratch file, matching v0.1.3 (`gh release view v0.1.3`):
   - **What's new:** user-facing changes with measured numbers, plus "No app changes since X" when that's true.
   - **Install:** `.deb` first (`sudo apt install ./Portside_X.Y.Z_amd64.deb`), then the AppImage `chmod +x` line.
   - **Checksums (SHA-256):** the printed checksums in a code block.
4. Show the notes to the user and wait for approval.

## 2. Publish (public, after approval)

```bash
.claude/skills/release/release.sh --publish X.Y.Z /abs/path/NOTES.md
```

- It re-checks the versions, that both bundles exist and that the AppImage is repacked. It refuses if anything outside the release files changed.
- It commits "Release X.Y.Z", then tags `vX.Y.Z`, pushes `main` and the tag, and runs `gh release create` with the `.deb` and AppImage.
- It checks the assets (name, size, `uploaded`) through `gh api repos/{owner}/{repo}/releases`, not `gh release view`, which can list no assets for a while after creation. If that check fails, look at the API again before re-uploading anything.
