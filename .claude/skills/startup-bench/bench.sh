#!/usr/bin/env bash
# Startup benchmark with temporary in-app marks. For each git ref: detach to it, patch in a `mark`
# command (prints epoch ms, then exits) called after the first scan paints, build, repack, copy out.
# Then launch every variant N times in shuffled rounds and print exec→ready stats.
# Always restores the original checkout and rebuilds + repacks it, so target/ never keeps a marked
# build (it would quit right after starting).
# usage: bench.sh [-n ROUNDS] [-o OUTDIR] REF... [-- EXTRA_EXECUTABLE...]
set -euo pipefail

rounds=20 out=""
while getopts n:o: f; do case $f in n) rounds=$OPTARG ;; o) out=$OPTARG ;; *) exit 2 ;; esac; done
shift $((OPTIND - 1))
refs=() extras=()
while [ $# -gt 0 ] && [ "$1" != -- ]; do refs+=("$1"); shift; done
[ "${1:-}" = -- ] && { shift; extras=("$@"); }
[ ${#refs[@]} -gt 0 ] || [ ${#extras[@]} -gt 0 ] || { echo "usage: bench.sh [-n N] [-o DIR] REF... [-- EXE...]" >&2; exit 2; }

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Working tree not clean; commit or stash first." >&2; exit 1; }
out="${out:-$(mktemp -d)}"; mkdir -p "$out"
orig="$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)"
rel=src-tauri/target/release
version() { node -p "require('./src-tauri/tauri.conf.json').version"; }

restore() {
  git checkout -q -- src/App.tsx src-tauri/src/lib.rs
  git checkout -q "$orig"
  if [ ${#refs[@]} -gt 0 ]; then
    echo "Rebuilding $orig so target/ holds an unmarked build..." >&2
    npm run tauri build >"$out/restore-build.log" 2>&1 && npm run repack-appimage >>"$out/restore-build.log" 2>&1 \
      || echo "RESTORE BUILD FAILED, see $out/restore-build.log" >&2
  fi
}
trap restore EXIT

variants=()
for ref in "${refs[@]}"; do
  name="${ref//\//_}"
  git checkout -q --detach "$ref"
  python3 - <<'PY'
import sys
def patch(p, a, b):
    s = open(p).read()
    if a not in s: sys.exit(f"mark patch: anchor not found in {p}: {a[:50]!r}")
    open(p, "w").write(s.replace(a, b, 1))
patch("src-tauri/src/lib.rs", "#[tauri::command]\nasync fn scan_sockets",
      "#[tauri::command]\nasync fn mark() {\n    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();\n    eprintln!(\"MARK {ms} ready\");\n    std::process::exit(0);\n}\n\n#[tauri::command]\nasync fn scan_sockets")
patch("src-tauri/src/lib.rs", "generate_handler![scan_sockets, stop_process",
      "generate_handler![mark, scan_sockets, stop_process")
patch("src/App.tsx", "        setRows(m.rows);\n",
      "        setRows(m.rows);\n        requestAnimationFrame(() => requestAnimationFrame(() => { invoke(\"mark\"); }));\n")
PY
  echo "Building $ref..." >&2
  npm run tauri build >"$out/build-$name.log" 2>&1 || { echo "Build of $ref failed, see $out/build-$name.log" >&2; exit 1; }
  npm run repack-appimage >>"$out/build-$name.log" 2>&1
  cp "$rel/portside" "$out/$name-bare"
  cp "$rel/bundle/appimage/Portside_$(version)_amd64.AppImage" "$out/$name-appimage"
  rm -rf "$out/$name-AppDir"; cp -a "$rel/bundle/appimage/Portside.AppDir" "$out/$name-AppDir"  # for repack experiments
  variants+=("$out/$name-bare" "$out/$name-appimage")
  git checkout -q -- src/App.tsx src-tauri/src/lib.rs
done
for e in "${extras[@]}"; do variants+=("$(realpath "$e")"); done

results="$out/results.txt"; : >"$results"
echo "Launching ${#variants[@]} variants x $rounds rounds..." >&2
for _ in $(seq "$rounds"); do
  for v in $(printf '%s\n' "${variants[@]}" | shuf); do
    t0=$(date +%s%3N)
    m=$(timeout 15 "$v" 2>&1 | grep -m1 -o 'MARK [0-9]*' | cut -d' ' -f2 || true)
    [ -n "$m" ] && r=$((m - t0)) || r=FAIL
    echo "$(basename "$v") $r" >>"$results"
    sleep 0.5
  done
done

printf '%-28s %4s %6s %6s %6s %6s %6s %s\n' variant n min median p90 max '>1s' fails
for v in "${variants[@]}"; do
  b=$(basename "$v")
  fails=$(awk -v v="$b" '$1==v && $2=="FAIL"' "$results" | wc -l)
  awk -v v="$b" '$1==v && $2!="FAIL" {print $2}' "$results" | sort -n | awk -v v="$b" -v f="$fails" '
    {a[++n]=$1; if ($1>1000) o++}
    END { if (!n) { printf "%-28s all %d launches failed\n", v, f; exit }
          p = int(n*0.9); if (p < 1) p = 1
          printf "%-28s %4d %6d %6d %6d %6d %6d %d\n", v, n, a[1], (a[int((n+1)/2)]+a[int(n/2)+1])/2, a[p], a[n], o, f }'
done
echo "Raw results: $results" >&2
