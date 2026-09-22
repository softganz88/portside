mod model;

use model::{ScanError, ScanResult, StopResult};

#[tauri::command]
fn scan_sockets() -> Result<ScanResult, ScanError> {
    Ok(ScanResult { rows: Vec::new(), self_pid: std::process::id() as i32 })
}

#[tauri::command]
async fn stop_process(pid: i32, expected_start_time: u64, force: bool) -> StopResult {
    let _ = (pid, expected_start_time, force);
    StopResult::Refused { reason: "Not implemented.".into() }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_sockets, stop_process])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
