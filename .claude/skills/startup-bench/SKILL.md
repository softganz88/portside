---
name: startup-bench
description: Measure Portside's startup time (exec → first scan painted) with temporary in-app marks, across git refs and/or prebuilt executables such as repacked AppImage variants. Use for "measure startup", "benchmark launch time", "did this change slow startup", before/after timing of a change, or comparing AppImage packing options.
argument-hint: [refs to compare, e.g. main HEAD~1] [-- extra executables]
---

# Startup bench

Run `bench.sh` from this directory. It does the whole throwaway-marks routine from HANDOFF.md, so nothing gets committed and `target/` doesn't keep a marked build:

```bash
S=<absolute scratch dir>
.claude/skills/startup-bench/bench.sh -n 20 -o "$S" main my-branch
.claude/skills/startup-bench/bench.sh -n 20 -o "$S" -- "$S/z128K.AppImage" "$S/none.AppImage"
```

- **Refs:** each ref is checked out detached. The script patches in a `mark` command, which prints the epoch time and then exits, and calls it after the first scan and a double `requestAnimationFrame`. Then it builds, repacks, and copies out `<ref>-bare` and `<ref>-appimage`.
- **Extra executables after `--`:** they are launched as-is, so they must already contain the marks. Each ref run also saves `<ref>-AppDir` (marked). To compare packing options, run once with a ref, repack its AppDir into variants in the scratch dir, then run again with only `-- <variants> "$S/<ref>-bare"` (the bare binary is the in-run baseline). With no refs, the script builds nothing and skips the restore step.
- **Order:** it launches every variant once per round, shuffled, with a 0.5 s gap between launches. Then it prints n/min/median/p90/max, launches over 1 s, and fails for each variant.
- **Exit:** it always checks out the original ref again and rebuilds and repacks it. The script refuses to run on a dirty tree.

## Rules

- **Don't run anything else during the launches.** Builds, screen polling and `strace` all shift the numbers (see CLAUDE.md Pitfalls).
- **Compare only within one run.** Machine speed has varied ~12% between sessions, so re-measure the baseline in the same run.
- **Every ref needs the anchors the patch looks for:** `async fn scan_sockets`, `generate_handler![scan_sockets, stop_process` and `setRows(m.rows);`. If one moves, the patch stops with "anchor not found". Update the anchors in `bench.sh` then.
- **A variant that's all FAIL** never painted within 15 s or has no marks. Launch it by hand to see its stderr.
- **Recording results:** put the table in HANDOFF.md under the decision it supports, with the date and n.
