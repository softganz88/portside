mod model;
mod proc_net;
mod procs;
mod stop;

use model::{Ownership, Proto, Row, ScanError, ScanResult, StopResult};
use std::collections::HashMap;

fn scan_sockets_inner() -> Result<ScanResult, ScanError> {
    let files = proc_net::read_all();
    if files.iter().all(|(_, _, text)| text.is_none()) {
        return Err(ScanError::ProcNetUnreadable);
    }

    let inode_pid = procs::inode_to_pid_map();
    let users = procs::load_users();
    let btime = procs::boot_time_secs().unwrap_or(0);
    let clk_tck = procs::clk_tck();
    let mut proc_cache: HashMap<i32, procs::ProcInfo> = HashMap::new();

    let mut rows = Vec::new();
    for (proto, family, text) in &files {
        let Some(text) = text else { continue };
        for entry in proc_net::parse(text, *proto, *family) {
            let pid = if entry.inode == 0 { None } else { inode_pid.get(&entry.inode).copied() };
            let ownership = if entry.inode == 0 {
                Ownership::Kernel
            } else if pid.is_some() {
                Ownership::Own
            } else {
                Ownership::Other
            };
            let (process, cmdline, started_ms, start_ticks) = match pid {
                Some(p) => {
                    let info = proc_cache.entry(p).or_insert_with(|| procs::proc_info(p, btime, clk_tck));
                    (info.comm.clone(), info.cmdline.clone(), info.started_ms, info.start_ticks)
                }
                None => (None, String::new(), None, None),
            };
            let user = procs::username(entry.uid, &users);
            let proto_label = match proto {
                Proto::Tcp => "TCP",
                Proto::Udp => "UDP",
            };
            let key = format!("{proto_label}|{}|{}|{}", entry.address, entry.port, entry.inode);
            rows.push(Row {
                key,
                proto: *proto,
                family: *family,
                address: entry.address,
                port: entry.port,
                inode: entry.inode,
                pid,
                process,
                cmdline,
                user,
                started_ms,
                start_ticks,
                ownership,
            });
        }
    }

    Ok(ScanResult { rows, self_pid: std::process::id() as i32 })
}

#[tauri::command]
async fn scan_sockets() -> Result<ScanResult, ScanError> {
    scan_sockets_inner()
}

#[tauri::command]
async fn stop_process(pid: i32, expected_start_time: u64, force: bool) -> StopResult {
    stop::stop_process(pid, expected_start_time, force, std::process::id() as i32).await
}

/// Cinnamon signals dark mode through the GTK theme name (e.g. `Mint-Y-Dark-Aqua`) while the
/// portal reports "no preference", so WebKit would otherwise render `prefers-color-scheme: light`.
#[cfg(target_os = "linux")]
fn follow_gtk_dark_theme() {
    use gtk::prelude::*;
    let Some(settings) = gtk::Settings::default() else { return };
    let apply = |s: &gtk::Settings| {
        let dark = s.gtk_theme_name().is_some_and(|n| n.to_lowercase().contains("dark"));
        if dark {
            s.set_gtk_application_prefer_dark_theme(true);
        }
    };
    apply(&settings);
    settings.connect_gtk_theme_name_notify(apply);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_| {
            #[cfg(target_os = "linux")]
            follow_gtk_dark_theme();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_sockets, stop_process])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_scan_returns_rows() {
        let start = std::time::Instant::now();
        let result = scan_sockets_inner();
        let elapsed = start.elapsed();
        println!("scan_sockets: {} rows in {:?}", result.as_ref().map(|r| r.rows.len()).unwrap_or(0), elapsed);
        let result = result.expect("scan should succeed on this machine");
        assert!(!result.rows.is_empty(), "expected at least one listening socket");
    }
}
