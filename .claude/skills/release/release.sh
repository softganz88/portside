#!/usr/bin/env bash
# Portside release in two steps (see SKILL.md):
#   release.sh X.Y.Z                      bump versions, run every gate, build, repack, smoke-launch,
#                                         print checksums. Leaves the bump uncommitted.
#   release.sh --publish X.Y.Z NOTES.md   commit "Release X.Y.Z", tag, push, create the GitHub
#                                         release, verify its assets through the releases API.
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"
die() { echo "release: $*" >&2; exit 1; }
publish=0; [ "${1:-}" = --publish ] && { publish=1; shift; }
new="${1:-}"; [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: release.sh [--publish] X.Y.Z [NOTES.md]"
[ "$(git symbolic-ref -q --short HEAD)" = main ] || die "not on main"
git rev-parse -q --verify "refs/tags/v$new" >/dev/null && die "tag v$new already exists"
bundle=src-tauri/target/release/bundle
appimage="$bundle/appimage/Portside_${new}_amd64.AppImage"
deb="$bundle/deb/Portside_${new}_amd64.deb"
cur() { node -p "require('./$1').version"; }
release_files=(package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md HANDOFF.md)

check_repacked() {
  unsquashfs -s -o "$("$appimage" --appimage-offset)" "$appimage" | grep -q '^Data is uncompressed' \
    || die "$appimage is not repacked (run npm run repack-appimage)"
}

if [ $publish = 0 ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree not clean"
  old="$(cur package.json)"
  [ "$old" != "$new" ] || die "already at $new"
  [ "$(cur src-tauri/tauri.conf.json)" = "$old" ] || die "tauri.conf.json is at $(cur src-tauri/tauri.conf.json), package.json at $old"
  grep -q "^version = \"$old\"" src-tauri/Cargo.toml || die "src-tauri/Cargo.toml is not at $old"

  sed -i "0,/\"version\": \"$old\"/s//\"version\": \"$new\"/" package.json src-tauri/tauri.conf.json
  sed -i "0,/^version = \"$old\"/s//version = \"$new\"/" src-tauri/Cargo.toml
  sed -i "s/Portside_${old}_amd64/Portside_${new}_amd64/g" README.md
  npm install --package-lock-only --ignore-scripts --silent

  (cd src-tauri && cargo test --quiet && cargo clippy --all-targets --quiet -- -D warnings) || die "cargo gate failed"
  npm test --silent || die "npm test failed"
  log="$(mktemp)"
  npm run tauri build >"$log" 2>&1 || { tail -30 "$log" >&2; die "tauri build failed ($log)"; }
  if grep -i 'warn' "$log" >&2; then die "tauri build printed warnings ($log)"; fi
  npm run repack-appimage --silent
  check_repacked

  # Smoke launch: the AppImage runtime execs the app, so the launched PID owns the window.
  "$appimage" >/dev/null 2>&1 & pid=$!
  ok=0
  for _ in $(seq 30); do
    for w in $(xdotool search --onlyvisible --pid "$pid" 2>/dev/null); do
      [ "$(xdotool getwindowpid "$w" 2>/dev/null)" = "$pid" ] && ok=1
    done
    [ $ok = 1 ] && break; sleep 0.5
  done
  kill "$pid" 2>/dev/null || true
  [ $ok = 1 ] || die "AppImage showed no window within 15 s"
  listing="$(dpkg-deb -c "$deb")"   # not piped into grep -q: SIGPIPE + pipefail would fail the check
  grep -q 'usr/bin/portside$' <<<"$listing" || die "$deb has no usr/bin/portside"

  echo; echo "Built $new. Uncommitted changes:"; git status --short
  echo; echo "Checksums (SHA-256):"; (cd "$bundle" && sha256sum "deb/$(basename "$deb")" "appimage/$(basename "$appimage")" | sed 's|  [a-z]*/|  |')
  echo; echo "Next: update the Releases line in HANDOFF.md, write the notes, then: $0 --publish $new NOTES.md"
  exit 0
fi

notes="${2:-}"; [ -f "$notes" ] || die "notes file required: release.sh --publish $new NOTES.md"
for f in package.json src-tauri/tauri.conf.json; do [ "$(cur $f)" = "$new" ] || die "$f is at $(cur $f), not $new"; done
[ -f "$appimage" ] && [ -f "$deb" ] || die "bundles for $new missing; run $0 $new first"
check_repacked
extra="$(git status --porcelain --untracked-files=no -- . "${release_files[@]/#/:!}")"
[ -z "$extra" ] || die "unexpected changes outside the release files: $extra"

git add "${release_files[@]}"
git commit -q -m "Release $new

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git tag "v$new"
git push -q origin main "v$new"
gh release create "v$new" "$deb" "$appimage" --verify-tag --title "Portside $new" --notes-file "$notes"

# The by-tag view can list no assets for a while after creation; the releases list is current.
assets="$(gh api 'repos/{owner}/{repo}/releases' --jq ".[] | select(.tag_name==\"v$new\") | .assets[] | \"\(.name) \(.size) \(.state)\"")"
echo "$assets"
for f in "$deb" "$appimage"; do
  grep -qx "$(basename "$f") $(stat -c %s "$f") uploaded" <<<"$assets" || die "asset $(basename "$f") missing or size mismatch; check before re-uploading"
done
echo "Published v$new."
