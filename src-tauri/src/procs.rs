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

/// Reads (state, start-ticks) from `/proc/<pid>/stat`, parsing after the
/// last `)` so a `comm` containing spaces or parens is safe.
pub fn read_stat_state_ticks(pid: i32) -> Option<(char, u64)> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let comm_end = stat.rfind(')')?;
    let rest = stat.get(comm_end + 1..)?.trim_start();
    let mut fields = rest.split_whitespace();
    let state = fields.next()?.chars().next()?;
    // `fields` now starts at field 4 (ppid); field 22 (starttime) is 18 more along.
    let ticks: u64 = fields.nth(18)?.parse().ok()?;
    Some((state, ticks))
}

fn read_comm(pid: i32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim_end_matches('\n').to_string())
}

fn read_cmdline(pid: i32) -> String {
    let mut bytes = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    for b in bytes.iter_mut() {
        if *b == 0 {
            *b = b' ';
        }
    }
    String::from_utf8_lossy(&bytes).trim_end().to_string()
}

/// `btime` (boot time, epoch seconds) from `/proc/stat`.
pub fn boot_time_secs() -> Option<i64> {
    let stat = fs::read_to_string("/proc/stat").ok()?;
    stat.lines().find_map(|l| l.strip_prefix("btime ")).and_then(|v| v.trim().parse().ok())
}

pub fn clk_tck() -> i64 {
    sysconf(SysconfVar::CLK_TCK).ok().flatten().unwrap_or(100)
}

/// Looks up comm/cmdline/start time for one pid. `btime_secs`/`clk_tck` are
/// scanned once per scan and passed in rather than re-read per pid.
pub fn proc_info(pid: i32, btime_secs: i64, clk_tck: i64) -> ProcInfo {
    let (start_ticks, started_ms) = match read_stat_state_ticks(pid) {
        Some((_, ticks)) => (Some(ticks), Some(btime_secs * 1000 + (ticks as i64 * 1000 / clk_tck.max(1)))),
        None => (None, None),
    };
    ProcInfo { comm: read_comm(pid), cmdline: read_cmdline(pid), started_ms, start_ticks }
}

/// Parses `/etc/passwd` once per scan into a uid -> user name map.
pub fn load_users() -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let Ok(text) = fs::read_to_string("/etc/passwd") else { return map };
    for line in text.lines() {
        let mut parts = line.split(':');
        let Some(name) = parts.next() else { continue };
        parts.next(); // password placeholder
        let Some(Ok(uid)) = parts.next().map(|s| s.parse::<u32>()) else { continue };
        map.entry(uid).or_insert_with(|| name.to_string());
    }
    map
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
        let comm_end = stat.rfind(')').unwrap();
        let rest = stat[comm_end + 1..].trim_start();
        let mut fields = rest.split_whitespace();
        let state = fields.next().unwrap();
        assert_eq!(state, "S");
        let ticks: u64 = fields.nth(18).unwrap().parse().unwrap();
        assert_eq!(ticks, 424242);
    }

    #[test]
    fn cmdline_replaces_nul_and_trims() {
        let mut bytes = b"node\0server.js\0--port\x00 3000\0".to_vec();
        for b in bytes.iter_mut() {
            if *b == 0 {
                *b = b' ';
            }
        }
        let s = String::from_utf8_lossy(&bytes).trim_end().to_string();
        assert_eq!(s, "node server.js --port  3000");
    }

    #[test]
    fn cmdline_lossy_decodes_non_utf8() {
        let mut bytes = vec![b'x', 0xFF, 0x00, b'y'];
        for b in bytes.iter_mut() {
            if *b == 0 {
                *b = b' ';
            }
        }
        let s = String::from_utf8_lossy(&bytes).trim_end().to_string();
        assert!(s.starts_with('x'));
        assert!(s.ends_with('y'));
    }

    #[test]
    fn parses_passwd_line() {
        let text = "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000:Alice:/home/alice:/bin/bash\nmalformed\n";
        let mut map = HashMap::new();
        for line in text.lines() {
            let mut parts = line.split(':');
            let Some(name) = parts.next() else { continue };
            parts.next();
            let Some(Ok(uid)) = parts.next().map(|s| s.parse::<u32>()) else { continue };
            map.insert(uid, name.to_string());
        }
        assert_eq!(map.get(&0), Some(&"root".to_string()));
        assert_eq!(map.get(&1000), Some(&"alice".to_string()));
        assert_eq!(username(9999, &map), "9999");
    }
}
