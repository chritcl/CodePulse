use serde_json::Value;

use super::config::{
    apply_claude_hook_mutation, inspect_claude_hooks, ClaudeHookMutation, CLAUDE_HOOK_EVENTS,
    CLAUDE_HOOK_MARKER,
};

const BRIDGE: &str = r"C:\Users\Test User\AppData\Roaming\CodePulse\codepulse-claude-bridge.exe";

#[test]
fn 安装保留未知字段和其他_hook_并使用直接命令与所有权参数() {
    let original = r#"{
      "permissions": { "allow": ["Read"] },
      "env": { "EXISTING": "1" },
      "statusLine": { "type": "command", "command": "other.exe" },
      "plugins": { "example": true },
      "hooks": {
        "PreToolUse": [
          { "matcher": "Bash", "hooks": [{ "type": "command", "command": "other.exe", "timeout": 9 }] }
        ]
      }
    }"#;

    let updated =
        apply_claude_hook_mutation(original, BRIDGE, ClaudeHookMutation::InstallOrRepair).unwrap();
    let value: Value = serde_json::from_str(&updated).unwrap();

    assert_eq!(value["permissions"]["allow"][0], "Read");
    assert_eq!(value["env"]["EXISTING"], "1");
    assert_eq!(value["statusLine"]["command"], "other.exe");
    assert_eq!(value["plugins"]["example"], true);
    assert_eq!(
        value["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
        "other.exe"
    );

    let inspection = inspect_claude_hooks(&updated, BRIDGE).unwrap();
    assert_eq!(inspection.marked_handlers, CLAUDE_HOOK_EVENTS.len());
    assert_eq!(inspection.valid_handlers, CLAUDE_HOOK_EVENTS.len());

    for event in CLAUDE_HOOK_EVENTS {
        let groups = value["hooks"][event].as_array().unwrap();
        let handler = groups
            .iter()
            .flat_map(|group| group["hooks"].as_array().unwrap())
            .find(|handler| {
                handler["args"]
                    .as_array()
                    .is_some_and(|args| args.iter().any(|arg| arg == CLAUDE_HOOK_MARKER))
            })
            .unwrap();
        assert_eq!(handler["type"], "command");
        assert_eq!(handler["command"], BRIDGE);
        assert_eq!(handler["timeout"], 2);
    }
}

#[test]
fn 修复重复标记并且卸载只移除_codepulse_处理器() {
    let installed = apply_claude_hook_mutation(
        "{\"hooks\":{}}",
        BRIDGE,
        ClaudeHookMutation::InstallOrRepair,
    )
    .unwrap();
    let mut value: Value = serde_json::from_str(&installed).unwrap();
    let duplicate = value["hooks"]["Stop"][0].clone();
    value["hooks"]["Stop"].as_array_mut().unwrap().push(duplicate);
    value["hooks"]["Stop"].as_array_mut().unwrap().push(serde_json::json!({
        "hooks": [{ "type": "command", "command": "other.exe", "args": ["keep"] }]
    }));

    let repaired = apply_claude_hook_mutation(
        &serde_json::to_string(&value).unwrap(),
        BRIDGE,
        ClaudeHookMutation::InstallOrRepair,
    )
    .unwrap();
    assert!(inspect_claude_hooks(&repaired, BRIDGE).unwrap().is_correct());

    let removed =
        apply_claude_hook_mutation(&repaired, BRIDGE, ClaudeHookMutation::Uninstall).unwrap();
    let removed_value: Value = serde_json::from_str(&removed).unwrap();
    assert_eq!(removed_value["hooks"]["Stop"].as_array().unwrap().len(), 1);
    assert_eq!(
        removed_value["hooks"]["Stop"][0]["hooks"][0]["command"],
        "other.exe"
    );
    assert_eq!(
        inspect_claude_hooks(&removed, BRIDGE).unwrap().marked_handlers,
        0
    );
}

#[test]
fn 有效处理器总数正确但事件覆盖不完整时仍需修复() {
    let installed = apply_claude_hook_mutation("{}", BRIDGE, ClaudeHookMutation::InstallOrRepair)
        .expect("应生成配置");
    let mut value = serde_json::from_str::<serde_json::Value>(&installed).expect("应解析配置");
    let duplicate = value["hooks"]["UserPromptSubmit"][0]["hooks"][0].clone();
    value["hooks"]["SessionStart"][0]["hooks"]
        .as_array_mut()
        .expect("应为处理器数组")
        .push(duplicate);
    value["hooks"]
        .as_object_mut()
        .expect("应为 Hook 对象")
        .remove("UserPromptSubmit");

    let inspection = inspect_claude_hooks(&value.to_string(), BRIDGE).expect("应检查配置");
    assert_eq!(inspection.marked_handlers, CLAUDE_HOOK_EVENTS.len());
    assert_eq!(inspection.valid_handlers, CLAUDE_HOOK_EVENTS.len());
    assert!(!inspection.is_correct());
}

#[test]
fn 无效_json_和结构异常会拒绝修改() {
    assert!(
        apply_claude_hook_mutation("{invalid", BRIDGE, ClaudeHookMutation::InstallOrRepair)
            .is_err()
    );
    assert!(apply_claude_hook_mutation(
        "{\"hooks\":[]}",
        BRIDGE,
        ClaudeHookMutation::InstallOrRepair
    )
    .is_err());
}
