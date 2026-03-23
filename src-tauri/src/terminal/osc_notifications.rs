use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

const BEL: u8 = 0x07;
const ESC: u8 = 0x1b;
const OSC_C1: u8 = 0x9d;
const OSC_SOURCE: &str = "terminal-osc";
const OSC_TITLE: &str = "Terminal";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalOscNotification {
    pub title: String,
    pub body: String,
    pub source: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct TerminalOscParseResult {
    pub passthrough: Vec<u8>,
    pub notifications: Vec<TerminalOscNotification>,
}

#[derive(Debug, Default)]
pub struct TerminalOscNotificationParser {
    pending_escape: bool,
    in_osc: bool,
    osc_raw: Vec<u8>,
    osc_content: Vec<u8>,
    osc_pending_escape: bool,
    kitty_fragments: HashMap<String, KittyNotificationFragments>,
}

#[derive(Debug, Default)]
struct KittyNotificationFragments {
    title: String,
    body: String,
}

enum OscParseAction {
    Ignore,
    Strip,
    Notify(TerminalOscNotification),
}

impl TerminalOscNotificationParser {
    pub fn consume(&mut self, bytes: &[u8]) -> TerminalOscParseResult {
        let mut result = TerminalOscParseResult {
            passthrough: Vec::with_capacity(bytes.len()),
            notifications: Vec::new(),
        };
        for &byte in bytes {
            self.consume_byte(byte, &mut result);
        }
        result
    }

    pub fn finish(&mut self) -> TerminalOscParseResult {
        let mut result = TerminalOscParseResult::default();
        if self.pending_escape {
            result.passthrough.push(ESC);
            self.pending_escape = false;
        }
        if self.in_osc {
            result.passthrough.append(&mut self.osc_raw);
            self.osc_content.clear();
            self.in_osc = false;
            self.osc_pending_escape = false;
        }
        result
    }

    fn consume_byte(&mut self, byte: u8, result: &mut TerminalOscParseResult) {
        if self.in_osc {
            self.consume_osc_byte(byte, result);
            return;
        }

        if self.pending_escape {
            self.pending_escape = false;
            if byte == b']' {
                self.start_osc(&[ESC, b']']);
                return;
            }

            result.passthrough.push(ESC);
            if byte == ESC {
                self.pending_escape = true;
            } else if byte == OSC_C1 {
                self.start_osc(&[OSC_C1]);
            } else {
                result.passthrough.push(byte);
            }
            return;
        }

        match byte {
            ESC => self.pending_escape = true,
            OSC_C1 => self.start_osc(&[OSC_C1]),
            _ => result.passthrough.push(byte),
        }
    }

    fn consume_osc_byte(&mut self, byte: u8, result: &mut TerminalOscParseResult) {
        self.osc_raw.push(byte);

        if self.osc_pending_escape {
            self.osc_pending_escape = false;
            if byte == b'\\' {
                self.finish_osc_sequence(result);
                return;
            }
            self.osc_content.push(ESC);
            if byte == ESC {
                self.osc_pending_escape = true;
            } else {
                self.osc_content.push(byte);
            }
            return;
        }

        match byte {
            BEL => self.finish_osc_sequence(result),
            ESC => self.osc_pending_escape = true,
            _ => self.osc_content.push(byte),
        }
    }

    fn start_osc(&mut self, prefix: &[u8]) {
        self.in_osc = true;
        self.osc_raw.clear();
        self.osc_raw.extend_from_slice(prefix);
        self.osc_content.clear();
        self.osc_pending_escape = false;
    }

    fn finish_osc_sequence(&mut self, result: &mut TerminalOscParseResult) {
        let raw = std::mem::take(&mut self.osc_raw);
        let content = std::mem::take(&mut self.osc_content);
        self.in_osc = false;
        self.osc_pending_escape = false;

        match self.parse_osc_content(&content) {
            OscParseAction::Notify(notification) => result.notifications.push(notification),
            OscParseAction::Strip => {}
            OscParseAction::Ignore => result.passthrough.extend(raw),
        }
    }

    fn parse_osc_content(&mut self, content: &[u8]) -> OscParseAction {
        let rendered = String::from_utf8_lossy(content);
        let mut parts = rendered.splitn(2, ';');
        let Some(code) = parts.next() else {
            return OscParseAction::Ignore;
        };
        let code = code.trim();
        let rest = parts.next().unwrap_or_default();

        match code {
            "9" => parse_osc_9(rest)
                .map(OscParseAction::Notify)
                .unwrap_or(OscParseAction::Ignore),
            "99" => self.parse_osc_99(rest),
            "777" => parse_osc_777(rest)
                .map(OscParseAction::Notify)
                .unwrap_or(OscParseAction::Ignore),
            _ => OscParseAction::Ignore,
        }
    }

    fn parse_osc_99(&mut self, rest: &str) -> OscParseAction {
        let mut parts = rest.splitn(2, ';');
        let metadata = parts.next().unwrap_or_default();
        let payload = parts.next().unwrap_or_default();
        let metadata = parse_kitty_metadata(metadata);
        let Some(payload) = decode_kitty_payload(payload, metadata.get("e").map(String::as_str))
        else {
            return OscParseAction::Ignore;
        };
        let fragment_key = metadata.get("i").cloned().unwrap_or_default();
        let payload_type = metadata
            .get("p")
            .map(String::as_str)
            .unwrap_or("title")
            .trim();
        let done = metadata
            .get("d")
            .map(|value| value.trim() != "0")
            .unwrap_or(true);

        match payload_type {
            "title" => self
                .kitty_fragments
                .entry(fragment_key.clone())
                .or_default()
                .title
                .push_str(&payload),
            "body" => self
                .kitty_fragments
                .entry(fragment_key.clone())
                .or_default()
                .body
                .push_str(&payload),
            _ => return OscParseAction::Ignore,
        }

        if !done {
            return OscParseAction::Strip;
        }

        let completed = self
            .kitty_fragments
            .remove(&fragment_key)
            .unwrap_or_default();
        notification_from_parts(completed.title, completed.body)
            .map(OscParseAction::Notify)
            .unwrap_or(OscParseAction::Ignore)
    }
}

fn parse_osc_9(rest: &str) -> Option<TerminalOscNotification> {
    if rest.starts_with("4;") {
        return None;
    }
    notification_from_parts(String::new(), rest.to_string())
}

fn parse_osc_777(rest: &str) -> Option<TerminalOscNotification> {
    let mut parts = rest.splitn(3, ';');
    let command = parts.next()?.trim();
    if command != "notify" {
        return None;
    }
    let title = parts.next().unwrap_or_default().to_string();
    let body = parts.next().unwrap_or_default().to_string();
    notification_from_parts(title, body)
}

fn parse_kitty_metadata(raw: &str) -> HashMap<String, String> {
    raw.split(':')
        .filter_map(|entry| {
            let mut parts = entry.splitn(2, '=');
            let key = parts.next()?.trim();
            if key.is_empty() {
                return None;
            }
            let value = parts.next().unwrap_or_default().trim();
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn decode_kitty_payload(payload: &str, encoding: Option<&str>) -> Option<String> {
    if matches!(encoding, Some("1")) {
        let decoded = BASE64.decode(payload).ok()?;
        return String::from_utf8(decoded).ok();
    }
    Some(payload.to_string())
}

fn notification_from_parts(title: String, body: String) -> Option<TerminalOscNotification> {
    let trimmed_title = title.trim();
    let trimmed_body = body.trim();
    if trimmed_title.is_empty() && trimmed_body.is_empty() {
        return None;
    }

    let (title, body) = if trimmed_title.is_empty() {
        (OSC_TITLE.to_string(), trimmed_body.to_string())
    } else if trimmed_body.is_empty() {
        (OSC_TITLE.to_string(), trimmed_title.to_string())
    } else {
        (trimmed_title.to_string(), trimmed_body.to_string())
    };

    Some(TerminalOscNotification {
        title,
        body,
        source: OSC_SOURCE.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(input: &[u8]) -> TerminalOscParseResult {
        let mut parser = TerminalOscNotificationParser::default();
        let mut result = parser.consume(input);
        let tail = parser.finish();
        result.passthrough.extend(tail.passthrough);
        result.notifications.extend(tail.notifications);
        result
    }

    #[test]
    fn parses_osc_9_notifications() {
        let result = parse_all(b"hello\x1b]9;Ping\x07world");

        assert_eq!(result.passthrough, b"helloworld");
        assert_eq!(
            result.notifications,
            vec![TerminalOscNotification {
                title: "Terminal".to_string(),
                body: "Ping".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn leaves_osc_9_progress_reports_alone() {
        let input = b"\x1b]9;4;30;build\x07";
        let result = parse_all(input);

        assert_eq!(result.passthrough, input);
        assert!(result.notifications.is_empty());
    }

    #[test]
    fn parses_osc_777_notifications() {
        let result = parse_all(b"\x1b]777;notify;Build finished;All green\x07");

        assert_eq!(result.passthrough, b"");
        assert_eq!(
            result.notifications,
            vec![TerminalOscNotification {
                title: "Build finished".to_string(),
                body: "All green".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn parses_simple_osc_99_notifications() {
        let result = parse_all(b"\x1b]99;;Hello world\x1b\\");

        assert_eq!(result.passthrough, b"");
        assert_eq!(
            result.notifications,
            vec![TerminalOscNotification {
                title: "Terminal".to_string(),
                body: "Hello world".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn parses_split_osc_99_notifications() {
        let mut parser = TerminalOscNotificationParser::default();
        let first = parser.consume(b"\x1b]99;i=1:d=0;Hello world\x1b\\");
        let second = parser.consume(b"\x1b]99;i=1:p=body;This is cool\x1b\\");

        assert_eq!(first.passthrough, b"");
        assert!(first.notifications.is_empty());
        assert_eq!(second.passthrough, b"");
        assert_eq!(
            second.notifications,
            vec![TerminalOscNotification {
                title: "Hello world".to_string(),
                body: "This is cool".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn parses_base64_osc_99_notifications() {
        let result = parse_all(b"\x1b]99;e=1;SGVsbG8gd29ybGQ=\x1b\\");

        assert_eq!(
            result.notifications,
            vec![TerminalOscNotification {
                title: "Terminal".to_string(),
                body: "Hello world".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn supports_sequences_split_across_reads() {
        let mut parser = TerminalOscNotificationParser::default();
        let first = parser.consume(b"prefix\x1b]777;notify;Ti");
        let second = parser.consume(b"tle;Body\x07suffix");

        assert_eq!(first.passthrough, b"prefix");
        assert!(first.notifications.is_empty());
        assert_eq!(second.passthrough, b"suffix");
        assert_eq!(
            second.notifications,
            vec![TerminalOscNotification {
                title: "Title".to_string(),
                body: "Body".to_string(),
                source: "terminal-osc".to_string(),
            }]
        );
    }

    #[test]
    fn finish_flushes_incomplete_sequences() {
        let mut parser = TerminalOscNotificationParser::default();
        let first = parser.consume(b"hello\x1b]777;notify;Title");
        let tail = parser.finish();

        assert_eq!(first.passthrough, b"hello");
        assert!(first.notifications.is_empty());
        assert_eq!(tail.passthrough, b"\x1b]777;notify;Title");
        assert!(tail.notifications.is_empty());
    }
}
