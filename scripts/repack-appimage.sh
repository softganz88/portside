#!/usr/bin/env bash
# Repack the AppImage built by `npm run tauri build` with its squashfs stored uncompressed.
# The AppImage mounts the squashfs through FUSE on every launch, and decompressing ~160 MB of
# WebKit/JSC/ICU pages was most of its cold start: ~1.3 s → ~0.78 s, at 76 → 225 MB. Leaving only
# those three libraries uncompressed (178 MB) measured ~0.95 s and missed 1 s on ~1 launch in 4.
# Tauri can't pass mksquashfs options, so this runs after the build, using the appimagetool
# inside the linuxdeploy plugin Tauri already downloaded.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$root/src-tauri/tauri.conf.json').version")"
appimage="$root/src-tauri/target/release/bundle/appimage/Portside_${version}_amd64.AppImage"
plugin="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-appimage.AppImage"
[ -f "$appimage" ] || { echo "Not found: $appimage (run npm run tauri build first)" >&2; exit 1; }
[ -x "$plugin" ] || { echo "Not found: $plugin (downloaded by npm run tauri build)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
"$plugin" --appimage-extract >/dev/null && mv squashfs-root tool
"$appimage" --appimage-extract >/dev/null
head -c "$("$appimage" --appimage-offset)" "$appimage" > runtime   # keep Tauri's runtime as-is

ARCH=x86_64 tool/usr/bin/appimagetool --no-appstream --runtime-file runtime --comp zstd \
  --mksquashfs-opt -noD --mksquashfs-opt -noF --mksquashfs-opt -noI --mksquashfs-opt -noX \
  squashfs-root repacked.AppImage > log 2>&1 || { cat log >&2; exit 1; }
chmod +x repacked.AppImage
mv repacked.AppImage "$appimage"
echo "Repacked $appimage ($(du -m "$appimage" | cut -f1) MB)"
