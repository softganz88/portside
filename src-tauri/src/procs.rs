//! Process-side lookups: inode -> pid, per-pid comm/cmdline/start time, uid -> user name.

use nix::unistd::{sysconf, SysconfVar};
use std::collections::HashMap;
use std::fs;

/// Per-process data needed for a `Row`, resolved lazily (only for pids that
/// own a listening socket).
#[derive(Debug, Clone, Default)]
pub struct ProcInfo {
    pub comm: Option<String>,
    pub cmdline: String,
    pub started_ms: Option<i64>,
    pub start_ticks: Option<u64>,
}

/// One walk of `/proc/[0-9]*/fd/*`, resolving `socket:[N]` symlinks.
/// Unreadable directories/entries (other users' processes, races) are
/// silently skipped.
pub fn inode_to_pid_map() -> HashMap<u64, i32> {
    let mut map = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else { return map };
    for entry in entries.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<i32>() else { continue };
        let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else { continue };
        for fd in fds.flatten() {
            let Ok(link) = fs::read_link(fd.path()) else { continue };
            let Some(inode) = link
                .to_str()
                .and_then(|s| s.strip_prefix("socket:["))
                .and_then(|s| s.strip_suffix(']'))
                .and_then(|s| s.parse::<u64>().ok())
            else {
                continue;
            };
            map.entry(inode).or_insert(pid);
        }
    }
    map
}

/// Parses (state, start-ticks) from the contents of `/proc/<pid>/stat`,
/// parsing after the last `)` so a `comm` containing spaces or parens is safe.
pub fn parse_stat(stat: &str) -> Option<(char, u64)> {
    let comm_end = stat.rfind(')')?;
    let rest = stat.get(comm_end + 1..)?.trim_start();
    let mut fields = rest.split_whitespace();
    let state = fields.next()?.chars().next()?;
    // `fields` now starts at field 4 (ppid); field 22 (starttime) is 18 more along.
    let ticks: u64 = fields.nth(18)?.parse().ok()?;
    Some((state, ticks))
}

/// Reads (state, start-ticks) from `/proc/<pid>/stat`.
pub fn read_stat_state_ticks(pid: i32) -> Option<(char, u64)> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_stat(&stat)
}

/// Replaces NUL separators with spaces and lossily decodes non-UTF-8 bytes.
pub fn cmdline_from_bytes(bytes: &[u8]) -> String {
    let mut bytes = bytes.to_vec();
    for b in bytes.iter_mut() {
        if *b == 0 {
            *b = b' ';
        }
    }
    String::from_utf8_lossy(&bytes).trim_end().to_string()
}

/// Lossily decodes `/proc/<pid>/comm` contents (SPEC §5: never crash on
/// non-UTF-8 bytes) and trims the trailing newline.
fn comm_from_bytes(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end_matches('\n').to_string()
}

fn read_comm(pid: i32) -> Option<String> {
    fs::read(format!("/proc/{pid}/comm")).ok().map(|b| comm_from_bytes(&b))
}

fn read_cmdline(pid: i32) -> String {
    let bytes = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    cmdline_from_bytes(&bytes)
}

/// Parses `btime` (boot time, epoch seconds) out of the contents of `/proc/stat`.
pub fn parse_boot_time(stat: &str) -> Option<i64> {
    stat.lines().find_map(|l| l.strip_prefix("btime ")).and_then(|v| v.trim().parse().ok())
}

/// `btime` (boot time, epoch seconds) from `/proc/stat`.
pub fn boot_time_secs() -> Option<i64> {
    let stat = fs::read_to_string("/proc/stat").ok()?;
    parse_boot_time(&stat)
}

pub fn clk_tck() -> i64 {
    sysconf(SysconfVar::CLK_TCK).ok().flatten().unwrap_or(100)
}

/// Looks up comm/cmdline/start time for one pid. `btime_secs`/`clk_tck` are
/// scanned once per scan and passed in rather than re-read per pid.
/// `btime_secs` is `None` when `/proc/stat` couldn't be read; `started_ms`
/// is then `None` too, rather than misreporting the Unix epoch.
pub fn proc_info(pid: i32, btime_secs: Option<i64>, clk_tck: i64) -> ProcInfo {
    let (start_ticks, started_ms) = match (read_stat_state_ticks(pid), btime_secs) {
        (Some((_, ticks)), Some(btime_secs)) => {
            (Some(ticks), Some(btime_secs * 1000 + (ticks as i64 * 1000 / clk_tck.max(1))))
        }
        (Some((_, ticks)), None) => (Some(ticks), None),
        (None, _) => (None, None),
    };
    ProcInfo { comm: read_comm(pid), cmdline: read_cmdline(pid), started_ms, start_ticks }
}

/// Parses `/etc/passwd` text into a uid -> user name map. First entry for a
/// uid wins, matching `getpwuid`'s first-match-in-file lookup order.
pub fn parse_passwd(text: &str) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split(':');
        let Some(name) = parts.next() else { continue };
        parts.next(); // password placeholder
        let Some(Ok(uid)) = parts.next().map(|s| s.parse::<u32>()) else { continue };
        map.entry(uid).or_insert_with(|| name.to_string());
    }
    map
}

/// Parses `/etc/passwd` once per scan into a uid -> user name map.
pub fn load_users() -> HashMap<u32, String> {
    let Ok(text) = fs::read_to_string("/etc/passwd") else { return HashMap::new() };
    parse_passwd(&text)
}

pub fn username(uid: u32, users: &HashMap<u32, String>) -> String {
    users.get(&uid).cloned().unwrap_or_else(|| uid.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_field_22_survives_comm_with_spaces_and_parens() {
        // fields 4..21 (ppid..itrealvalue), 18 of them, then field 22 (starttime) = 424242.
        let stat = "1 (a) b) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0 424242 0 0 0 0 0 0 0 0 0";
        assert_eq!(parse_stat(stat), Some(('S', 424242)));
    }

    #[test]
    fn stat_malformed_returns_none() {
        assert_eq!(parse_stat("no closing paren here"), None);
    }

    #[test]
    fn cmdline_replaces_nul_and_trims() {
        let bytes = b"node\0server.js\0--port\x00 3000\0";
        assert_eq!(cmdline_from_bytes(bytes), "node server.js --port  3000");
    }

    #[test]
    fn comm_lossy_decodes_non_utf8_and_trims_newline() {
        let bytes = [b'x', 0xFF, b'y', b'\n'];
        assert_eq!(comm_from_bytes(&bytes), "x\u{FFFD}y");
    }

    #[test]
    fn cmdline_lossy_decodes_non_utf8() {
        let bytes = [b'x', 0xFF, 0x00, b'y'];
        let s = cmdline_from_bytes(&bytes);
        assert!(s.starts_with('x'));
        assert!(s.ends_with('y'));
    }

    #[test]
    fn parses_passwd_line_first_wins() {
        // Matches load_users()/getpwuid's first-match-in-file order: a duplicate
        // uid later in the file must not override the first entry.
        let text = "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000:Alice:/home/alice:/bin/bash\nmalformed\nbob:x:1000:1000:Bob:/home/bob:/bin/bash\n";
        let map = parse_passwd(text);
        assert_eq!(map.get(&0), Some(&"root".to_string()));
        assert_eq!(map.get(&1000), Some(&"alice".to_string()));
        assert_eq!(username(9999, &map), "9999");
    }

    #[test]
    fn proc_info_leaves_started_ms_none_when_boot_time_unreadable() {
        let pid = std::process::id() as i32;
        let info = proc_info(pid, None, clk_tck());
        assert!(info.start_ticks.is_some(), "expected our own pid's stat to be readable");
        assert_eq!(info.started_ms, None);
    }

    #[test]
    fn parses_boot_time_line() {
        let text = "cpu  1 2 3\nbtime 1700000000\nprocesses 42\n";
        assert_eq!(parse_boot_time(text), Some(1_700_000_000));
        assert_eq!(parse_boot_time("no btime here"), None);
    }
}
