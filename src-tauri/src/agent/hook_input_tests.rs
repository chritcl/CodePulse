use std::io::Cursor;

use super::hook_input::{parse_agent_hook_input, MAX_AGENT_HOOK_INPUT_BYTES};

#[test]
fn 大体积敏感字段被跳过且只保留有界命令前缀() {
    let private_body = format!("敏感正文-{}", "x".repeat(2 * 1024 * 1024));
    let command = format!("cargo test {}", "y".repeat(1_024));
    let input = serde_json::to_vec(&serde_json::json!({
        "session_id": "session-1",
        "hook_event_name": "PreToolUse",
        "prompt": "验证共享解析器",
        "tool_input": {
            "command": command,
            "file_content": private_body
        },
        "tool_response": private_body
    }))
    .unwrap();

    let parsed = parse_agent_hook_input(&mut Cursor::new(input), true).expect("应解析 Hook");

    assert_eq!(parsed.session_id.as_deref(), Some("session-1"));
    assert_eq!(parsed.prompt.as_deref(), Some("验证共享解析器"));
    assert_eq!(
        parsed.command_prefix.as_ref().map(|value| value.chars().count()),
        Some(256)
    );
    assert!(!format!("{parsed:?}").contains("敏感正文"));
}

#[test]
fn 超过八兆的共享_hook_输入被拒绝() {
    let oversized = format!(
        "{{\"session_id\":\"session-1\",\"ignored\":\"{}\"}}",
        "x".repeat(MAX_AGENT_HOOK_INPUT_BYTES)
    );

    assert!(parse_agent_hook_input(&mut Cursor::new(oversized), false).is_none());
}
