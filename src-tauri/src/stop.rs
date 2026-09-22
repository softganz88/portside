//! Stops a process: re-verify identity, signal, poll for exit.

use crate::model::StopResult;
use crate::procs;
use nix::errno::Errno;
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const POLL_TIMEOUT: Duration = Duration::from_secs(3);

pub async fn stop_process(pid: i32, expected_start_time: u64, force: bool, self_pid: i32) -> StopResult {
    if pid <= 1 {
        return StopResult::Refused { reason: "Portside won't stop the init process.".into() };
    }
    if pid == self_pid {
        return StopResult::Refused { reason: "Portside can't stop itself.".into() };
    }

    let current_ticks = match procs::read_stat_state_ticks(pid) {
        Some((_, ticks)) => ticks,
        None => return StopResult::Exited,
    };
    if current_ticks != expected_start_time {
        return StopResult::ProcessChanged;
    }

    let signal = if force { Signal::SIGKILL } else { Signal::SIGTERM };
    if let Err(errno) = kill(Pid::from_raw(pid), signal) {
        return match errno {
            Errno::ESRCH => StopResult::Exited,
            Errno::EPERM => StopResult::Failed {
                errno: errno as i32,
                message: "You don't have permission to stop this process.".into(),
            },
            other => StopResult::Failed { errno: other as i32, message: format!("Couldn't stop the process ({other}).") },
        };
    }

    poll_for_exit(pid, expected_start_time).await
}

async fn poll_for_exit(pid: i32, expected_start_time: u64) -> StopResult {
    let mut waited = Duration::ZERO;
    loop {
        if has_exited(pid, expected_start_time) {
            return StopResult::Exited;
        }
        if waited >= POLL_TIMEOUT {
            return StopResult::StillRunning;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
        waited += POLL_INTERVAL;
    }
}

/// True when `/proc/<pid>/stat` is gone, its start ticks changed (pid
/// reused), or its state is `Z` (zombie).
fn has_exited(pid: i32, expected_start_time: u64) -> bool {
    match procs::read_stat_state_ticks(pid) {
        None => true,
        Some((state, ticks)) => state == 'Z' || ticks != expected_start_time,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn spawn_sleep() -> std::process::Child {
        Command::new("sleep").arg("30").spawn().expect("spawn sleep")
    }

    fn reap_in_background(mut child: std::process::Child) {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }

    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Runtime::new().expect("build runtime").block_on(fut)
    }

    #[test]
    fn has_exited_true_for_gone_pid() {
        // A pid this unlikely to exist right now.
        assert!(has_exited(i32::MAX - 1, 0));
    }

    #[test]
    fn refuses_pid_one_and_self() {
        let r = block_on(stop_process(1, 0, false, 999));
        assert!(matches!(r, StopResult::Refused { .. }));
        let r = block_on(stop_process(999, 0, false, 999));
        assert!(matches!(r, StopResult::Refused { .. }));
    }

    #[test]
    fn wrong_start_time_is_process_changed() {
        let child = spawn_sleep();
        let pid = child.id() as i32;
        let (_, real_ticks) = procs::read_stat_state_ticks(pid).expect("read stat");
        let result = block_on(stop_process(pid, real_ticks + 1, false, -1));
        assert_eq!(result, StopResult::ProcessChanged);
        let _ = nix::sys::signal::kill(Pid::from_raw(pid), Signal::SIGKILL);
        reap_in_background(child);
    }

    #[test]
    fn correct_ticks_stops_the_process() {
        let child = spawn_sleep();
        let pid = child.id() as i32;
        let (_, real_ticks) = procs::read_stat_state_ticks(pid).expect("read stat");
        reap_in_background(child);
        let result = block_on(stop_process(pid, real_ticks, false, -1));
        assert_eq!(result, StopResult::Exited);
    }
}
