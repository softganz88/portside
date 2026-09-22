//! IPC contract shared with `src/types.ts`. Change both together.
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Proto {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Family {
    IPv4,
    IPv6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ownership {
    Own,
    Other,
    Kernel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    /// `proto + address + port + inode`, stable across refreshes.
    pub key: String,
    pub proto: Proto,
    pub family: Family,
    /// Display form: `0.0.0.0`, `127.0.0.1`, `[::]`, `[::1]`.
    pub address: String,
    pub port: u16,
    pub inode: u64,
    pub pid: Option<i32>,
    pub process: Option<String>,
    pub cmdline: String,
    pub user: String,
    /// Unix epoch milliseconds.
    pub started_ms: Option<i64>,
    /// `/proc/<pid>/stat` field 22 (clock ticks since boot); pass back to `stop_process`.
    pub start_ticks: Option<u64>,
    pub ownership: Ownership,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub rows: Vec<Row>,
    pub self_pid: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("Can't read socket tables from /proc.")]
    ProcNetUnreadable,
}

impl Serialize for ScanError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StopResult {
    Exited,
    StillRunning,
    ProcessChanged,
    Refused { reason: String },
    Failed { errno: i32, message: String },
}
