#!/usr/bin/env bash
# Repack the AppImage built by `npm run tauri build` so WebKit's largest libraries are stored
# uncompressed. The AppImage mounts its squashfs through FUSE on every launch, and decompressing
# ~160 MB of WebKit/JSC/ICU pages was most of its cold start (1.3 s → ~0.87 s, 76 → 178 MB).
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
  --mksquashfs-opt -action \
  --mksquashfs-opt 'uncompressed@name(libwebkit2gtk-4.1.so*) || name(libjavascriptcoregtk-4.1.so*) || name(libicudata.so*)' \
  squashfs-root repacked.AppImage > log 2>&1 || { cat log >&2; exit 1; }
chmod +x repacked.AppImage
mv repacked.AppImage "$appimage"
echo "Repacked $appimage ($(du -m "$appimage" | cut -f1) MB)"
