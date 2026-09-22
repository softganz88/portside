//! Pure parser for `/proc/net/{tcp,tcp6,udp,udp6}`.

use crate::model::{Family, Proto};
use std::net::{Ipv4Addr, Ipv6Addr};

/// One socket table entry. Proto/family are known by the caller (which file
/// this came from), so they aren't repeated here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub address: String,
    pub port: u16,
    pub inode: u64,
    pub uid: u32,
}

/// Reads the four socket tables. A missing file (e.g. `tcp6` on a no-IPv6
/// kernel) yields `None` for that slot rather than an error.
pub fn read_all() -> [(Proto, Family, Option<String>); 4] {
    [
        (Proto::Tcp, Family::IPv4, std::fs::read_to_string("/proc/net/tcp").ok()),
        (Proto::Tcp, Family::IPv6, std::fs::read_to_string("/proc/net/tcp6").ok()),
        (Proto::Udp, Family::IPv4, std::fs::read_to_string("/proc/net/udp").ok()),
        (Proto::Udp, Family::IPv6, std::fs::read_to_string("/proc/net/udp6").ok()),
    ]
}

/// Parses one socket table. Skips the header and any malformed line without
/// panicking.
pub fn parse(text: &str, proto: Proto, family: Family) -> Vec<Entry> {
    text.lines().skip(1).filter_map(|line| parse_line(line, proto, family)).collect()
}

fn parse_line(line: &str, proto: Proto, family: Family) -> Option<Entry> {
    let mut fields = line.split_whitespace();
    fields.next()?; // sl
    let local = fields.next()?;
    let remote = fields.next()?;
    let state = fields.next()?;
    fields.next()?; // tx_queue:rx_queue
    fields.next()?; // tr:tm->when
    fields.next()?; // retrnsmt
    let uid_s = fields.next()?;
    fields.next()?; // timeout
    let inode_s = fields.next()?;

    match proto {
        Proto::Tcp => {
            if state != "0A" {
                return None;
            }
        }
        Proto::Udp => {
            if state != "07" {
                return None;
            }
            let (raddr_hex, rport_hex) = remote.split_once(':')?;
            let rport = u16::from_str_radix(rport_hex, 16).ok()?;
            if rport != 0 || !raddr_hex.chars().all(|c| c == '0') {
                return None;
            }
        }
    }

    let (addr_hex, port_hex) = local.split_once(':')?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;
    let address = format_address(addr_hex, family)?;
    let uid: u32 = uid_s.parse().ok()?;
    let inode: u64 = inode_s.parse().ok()?;
    Some(Entry { address, port, inode, uid })
}

/// The kernel prints each 32-bit word of the address in host byte order, so
/// on little-endian hardware each 8-hex-char chunk is the *big-endian text*
/// of a little-endian u32.
fn format_address(hex: &str, family: Family) -> Option<String> {
    match family {
        Family::IPv4 => {
            if hex.len() != 8 {
                return None;
            }
            let v = u32::from_str_radix(hex, 16).ok()?;
            Some(Ipv4Addr::from(v.to_le_bytes()).to_string())
        }
        Family::IPv6 => {
            if hex.len() != 32 {
                return None;
            }
            let mut bytes = [0u8; 16];
            for i in 0..4 {
                let chunk = hex.get(i * 8..i * 8 + 8)?;
                let v = u32::from_str_radix(chunk, 16).ok()?;
                bytes[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
            Some(format!("[{}]", Ipv6Addr::from(bytes)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tcp_fixture() {
        let text = include_str!("../tests/fixtures/tcp");
        let entries = parse(text, Proto::Tcp, Family::IPv4);
        assert_eq!(
            entries,
            vec![
                Entry { address: "127.0.0.1".into(), port: 8080, inode: 12345, uid: 1000 },
                Entry { address: "0.0.0.0".into(), port: 80, inode: 67890, uid: 0 },
            ]
        );
    }

    #[test]
    fn parses_tcp6_fixture() {
        let text = include_str!("../tests/fixtures/tcp6");
        let entries = parse(text, Proto::Tcp, Family::IPv6);
        assert_eq!(
            entries,
            vec![
                Entry { address: "[::]".into(), port: 8080, inode: 22222, uid: 1000 },
                Entry { address: "[::1]".into(), port: 80, inode: 33333, uid: 0 },
            ]
        );
    }

    #[test]
    fn parses_udp_fixture_excludes_connected_and_keeps_zero_inode() {
        let text = include_str!("../tests/fixtures/udp");
        let entries = parse(text, Proto::Udp, Family::IPv4);
        assert_eq!(
            entries,
            vec![
                Entry { address: "0.0.0.0".into(), port: 45553, inode: 44444, uid: 1000 },
                Entry { address: "0.0.0.0".into(), port: 4660, inode: 0, uid: 0 },
            ]
        );
    }

    #[test]
    fn parses_udp6_fixture() {
        let text = include_str!("../tests/fixtures/udp6");
        let entries = parse(text, Proto::Udp, Family::IPv6);
        assert_eq!(entries, vec![Entry { address: "[::]".into(), port: 53, inode: 66666, uid: 1000 }]);
    }

    #[test]
    fn malformed_lines_never_panic() {
        assert_eq!(parse_line("not a valid line at all", Proto::Tcp, Family::IPv4), None);
        assert_eq!(parse_line("", Proto::Tcp, Family::IPv4), None);
    }
}
