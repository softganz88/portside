mod model;
mod proc_net;
mod procs;
mod stop;

use model::{Ownership, Proto, Row, ScanError, ScanResult, StopResult};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::PageLoadEvent;
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// SPEC §2: `own` means same uid as Portside, not merely "PID resolvable". A
/// same-uid process whose fd directory couldn't be walked (e.g. non-dumpable)
/// is still `own`, just with an unresolved pid.
fn derive_ownership(inode: u64, uid: u32, self_uid: u32) -> Ownership {
    if inode == 0 {
        Ownership::Kernel
    } else if uid == self_uid {
        Ownership::Own
    } else {
        Ownership::Other
    }
}

fn scan_sockets_inner() -> Result<ScanResult, ScanError> {
    let files = proc_net::read_all();
    if files.iter().all(|(_, _, text)| text.is_none()) {
        return Err(ScanError::ProcNetUnreadable);
    }

    let inode_pid = procs::inode_to_pid_map();
    let users = procs::load_users();
    let btime = procs::boot_time_secs();
    let clk_tck = procs::clk_tck();
    let self_uid = nix::unistd::getuid().as_raw();
    let mut proc_cache: HashMap<i32, procs::ProcInfo> = HashMap::new();

    let mut rows = Vec::new();
    for (proto, family, text) in &files {
        let Some(text) = text else { continue };
        for entry in proc_net::parse(text, *proto, *family) {
            let pid = if entry.inode == 0 { None } else { inode_pid.get(&entry.inode).copied() };
            let ownership = derive_ownership(entry.inode, entry.uid, self_uid);
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
    // scan_sockets_inner does blocking /proc IO; run it off the tokio worker
    // threads so it doesn't stall other async tasks (the command is `async`
    // precisely so it doesn't block the GTK main thread, but a sync body
    // inside an async fn still blocks whichever tokio thread runs it).
    tauri::async_runtime::spawn_blocking(scan_sockets_inner)
        .await
        .expect("scan_sockets_inner panicked")
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
        // GTK_THEME overrides the XSettings theme name for rendering, so it wins here too.
        let name = std::env::var("GTK_THEME").ok().or_else(|| s.gtk_theme_name().map(Into::into));
        let dark = name.is_some_and(|n| n.to_lowercase().contains("dark"));
        if dark {
            s.set_gtk_application_prefer_dark_theme(true);
        }
    };
    apply(&settings);
    settings.connect_gtk_theme_name_notify(apply);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    static LOADED: AtomicBool = AtomicBool::new(false);
    tauri::Builder::default()
        // Restore size/position but not visibility: the window stays hidden until the page loads.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // Showing the window before WebKit's web process is up makes the UI process wait out a
        // 500 ms sync-IPC timeout on ~half of launches; showing it once the page has loaded avoids it.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                LOADED.store(true, Ordering::Relaxed);
                let _ = webview.window().show();
            }
        })
        .setup(|app| {
            #[cfg(target_os = "linux")]
            follow_gtk_dark_theme();
            // Safety net: a load that hangs or a crashed web process never reaches Finished,
            // which would leave the app running with no window, or a blank one. Load the app
            // once more (a fresh web process) and show; showing twice is a no-op. Navigate
            // rather than reload: a web process killed before the first commit leaves no URL.
            let app_url = match app.config().build.dev_url.clone() {
                Some(dev) if tauri::is_dev() => dev,
                _ => "tauri://localhost".parse().expect("static URL"),
            };
            if let Some(window) = app.get_webview_window("main") {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    if !LOADED.load(Ordering::Relaxed) {
                        let _ = window.navigate(app_url);
                    }
                    let _ = window.show();
                });
            }
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
    fn ownership_is_by_uid_not_by_pid_resolvability() {
        // Same uid as Portside is `own` even though no pid was resolved for
        // this socket (e.g. a non-dumpable same-user process).
        assert_eq!(derive_ownership(1, 1000, 1000), Ownership::Own);
        // A different uid is `other`, regardless of whether a pid happened to resolve.
        assert_eq!(derive_ownership(1, 0, 1000), Ownership::Other);
        // inode 0 is always kernel-owned, whatever the reported uid.
        assert_eq!(derive_ownership(0, 1000, 1000), Ownership::Kernel);
    }

    #[test]
    fn real_scan_returns_rows() {
        // Bind a real listening socket so the scan has a guaranteed row to find,
        // rather than relying on the host already having one (fails in bare CI).
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().expect("local_addr").port();

        let start = std::time::Instant::now();
        let result = scan_sockets_inner();
        let elapsed = start.elapsed();
        println!("scan_sockets: {} rows in {:?}", result.as_ref().map(|r| r.rows.len()).unwrap_or(0), elapsed);
        let result = result.expect("scan should succeed on this machine");

        let self_pid = std::process::id() as i32;
        let row = result
            .rows
            .iter()
            .find(|r| r.proto == Proto::Tcp && r.address == "127.0.0.1" && r.port == port)
            .unwrap_or_else(|| panic!("expected a TCP row for 127.0.0.1:{port}"));
        assert_eq!(row.pid, Some(self_pid));

        drop(listener);
    }
}
