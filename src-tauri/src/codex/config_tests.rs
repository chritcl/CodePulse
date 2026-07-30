use serde_json::Value;
use toml_edit::DocumentMut;

use super::config::{
    apply_codepulse_hook_mutation, HookConfigFormat, HookMutation, CODEPULSE_HOOK_EVENTS,
    CODEPULSE_HOOK_MARKER,
};

#[test]
fn 安装_json_hook_时保留其他用户处理器并补齐_codepulse_事件() {
    let original = r#"
    {
      "description": "已有用户 Hook",
      "hooks": {
        "SessionStart": [
          {
            "hooks": [
              {
                "type": "command",
                "command": "C:\\tools\\other-hook.exe",
                "statusMessage": "其他 Hook"
              }
            ]
          }
        ]
      }
    }
    "#;

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::HooksJson,
        original,
        "\"C:\\AppData\\CodePulse\\codepulse-codex-bridge.exe\"",
        HookMutation::InstallOrRepair,
    )
    .expect("应能修改有效的 hooks.json");
    let parsed: Value = serde_json::from_str(&updated).expect("输出应保持为有效 JSON");

    assert_eq!(
        parsed["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        "C:\\tools\\other-hook.exe"
    );
    assert_eq!(
        count_codepulse_handlers(&parsed),
        9,
        "每个需要的生命周期事件都应拥有一个 CodePulse 处理器"
    );
    for event in CODEPULSE_HOOK_EVENTS {
        let handler = parsed["hooks"][event]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
            .find(|handler| handler["statusMessage"] == CODEPULSE_HOOK_MARKER)
            .expect("事件应包含 CodePulse 处理器");
        assert_eq!(
            handler["timeout"], 3,
            "{event} 应为 Bridge 启动保留足够时间"
        );
    }
}

#[test]
fn 安装_toml_hook_时保留其他用户处理器并补齐_codepulse_事件() {
    let original = r#"
model = "gpt-5.6"

[[hooks.SessionStart]]
hooks = [{ type = "command", command = "C:\\tools\\other-hook.exe", statusMessage = "其他 Hook" }]
"#;

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::ConfigToml,
        original,
        "\"C:\\AppData\\CodePulse\\codepulse-codex-bridge.exe\"",
        HookMutation::InstallOrRepair,
    )
    .expect("应能修改有效的 config.toml");
    let parsed = updated.parse::<DocumentMut>().expect("输出应保持为有效 TOML");
    let session_start = parsed["hooks"]["SessionStart"]
        .as_array_of_tables()
        .expect("SessionStart 应保持为 Hook 分组数组");
    let foreign_handlers = session_start.get(0).expect("其他用户 Hook 分组应仍存在")["hooks"]
        .as_array()
        .expect("其他用户处理器应仍存在");

    assert_eq!(
        foreign_handlers
            .get(0)
            .and_then(|handler| handler.as_inline_table())
            .and_then(|handler| handler.get("command"))
            .and_then(|command| command.as_str()),
        Some("C:\\tools\\other-hook.exe")
    );
    assert_eq!(count_codepulse_toml_handlers(&parsed), 9);
}

#[test]
fn 修复时保留七项现有处理器并只追加上下文整理_hook() {
    let bridge_command =
        r#"cmd.exe /D /S /C ""C:\AppData\CodePulse\codepulse-codex-bridge.exe" --source app""#;
    let existing_events = &CODEPULSE_HOOK_EVENTS[..7];
    let mut hooks = serde_json::Map::new();
    for event in existing_events {
        hooks.insert(
            (*event).to_string(),
            serde_json::json!([{
                "matcher": "保持原分组",
                "hooks": [{
                    "type": "command",
                    "command": bridge_command,
                    "timeout": 3,
                    "statusMessage": CODEPULSE_HOOK_MARKER,
                    "custom": "保持原值"
                }]
            }]),
        );
    }
    let original_value = serde_json::json!({ "hooks": hooks });
    let original = serde_json::to_string(&original_value).unwrap();

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::HooksJson,
        &original,
        bridge_command,
        HookMutation::InstallOrRepair,
    )
    .expect("应只补齐缺失 Hook");
    let updated_value: Value = serde_json::from_str(&updated).unwrap();

    for event in existing_events {
        assert_eq!(
            updated_value["hooks"][event], original_value["hooks"][event],
            "{event} 的已信任处理器应保持完全不变"
        );
    }
    assert_eq!(count_codepulse_handlers(&updated_value), 9);
    assert!(updated_value["hooks"]["PreCompact"].is_array());
    assert!(updated_value["hooks"]["PostCompact"].is_array());
}

#[test]
fn 修复_toml_时保留已有处理器的自定义字段() {
    let bridge_command =
        r#"cmd.exe /D /S /C ""C:\AppData\CodePulse\codepulse-codex-bridge.exe" --source app""#;
    let existing = CODEPULSE_HOOK_EVENTS[..7]
        .iter()
        .map(|event| {
            format!(
                r#"[[hooks.{event}]]
matcher = "保持原分组"
hooks = [{{ type = "command", command = '{bridge_command}', timeout = 3, statusMessage = "{CODEPULSE_HOOK_MARKER}", custom = "保持原值" }}]
"#
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::ConfigToml,
        &existing,
        bridge_command,
        HookMutation::InstallOrRepair,
    )
    .expect("应只补齐缺失 Hook");
    let parsed = updated.parse::<DocumentMut>().expect("输出应保持为有效 TOML");

    for event in &CODEPULSE_HOOK_EVENTS[..7] {
        let group = parsed["hooks"][event]
            .as_array_of_tables()
            .and_then(|groups| groups.get(0))
            .expect("原处理器分组应保留");
        assert_eq!(group["matcher"].as_str(), Some("保持原分组"));
        assert_eq!(
            group["hooks"]
                .as_array()
                .and_then(|handlers| handlers.get(0))
                .and_then(|handler| handler.as_inline_table())
                .and_then(|handler| handler.get("custom"))
                .and_then(|value| value.as_str()),
            Some("保持原值")
        );
    }
    assert_eq!(count_codepulse_toml_handlers(&parsed), 9);
}

#[test]
fn 卸载_json_hook_时只移除带有_codepulse_标记的处理器() {
    let original = format!(
        r#"
        {{
          "hooks": {{
            "SessionStart": [
              {{
                "hooks": [
                  {{ "type": "command", "command": "C:\\tools\\other-hook.exe", "statusMessage": "其他 Hook" }},
                  {{ "type": "command", "command": "C:\\AppData\\CodePulse\\codepulse-codex-bridge.exe", "statusMessage": "{}" }}
                ]
              }}
            ],
            "Stop": [
              {{
                "hooks": [
                  {{ "type": "command", "command": "C:\\AppData\\CodePulse\\codepulse-codex-bridge.exe", "statusMessage": "{}" }}
                ]
              }}
            ]
          }}
        }}
        "#,
        CODEPULSE_HOOK_MARKER, CODEPULSE_HOOK_MARKER
    );

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::HooksJson,
        &original,
        "\"C:\\AppData\\CodePulse\\codepulse-codex-bridge.exe\"",
        HookMutation::Uninstall,
    )
    .expect("应能从有效 hooks.json 中移除 CodePulse 处理器");
    let parsed: Value = serde_json::from_str(&updated).expect("输出应保持为有效 JSON");

    assert_eq!(
        parsed["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        "C:\\tools\\other-hook.exe"
    );
    assert_eq!(count_codepulse_handlers(&parsed), 0);
}

#[test]
fn 卸载_toml_hook_时保留状态字段与其他处理器() {
    let original = format!(
        r#"
[hooks]
state = "用户设置"

[[hooks.PreCompact]]
hooks = [
  {{ type = "command", command = 'C:\tools\other-hook.exe', statusMessage = "其他 Hook" }},
  {{ type = "command", command = "bridge.exe", timeout = 3, statusMessage = "{CODEPULSE_HOOK_MARKER}" }}
]
"#
    );

    let updated = apply_codepulse_hook_mutation(
        HookConfigFormat::ConfigToml,
        &original,
        "bridge.exe",
        HookMutation::Uninstall,
    )
    .expect("应能安全卸载 TOML Hook");
    let parsed = updated.parse::<DocumentMut>().expect("输出应保持为有效 TOML");

    assert_eq!(parsed["hooks"]["state"].as_str(), Some("用户设置"));
    let handlers = parsed["hooks"]["PreCompact"]
        .as_array_of_tables()
        .and_then(|groups| groups.get(0))
        .and_then(|group| group["hooks"].as_array())
        .expect("其他处理器应保留");
    assert_eq!(handlers.len(), 1);
    assert_eq!(
        handlers
            .get(0)
            .expect("其他处理器应存在")
            .as_inline_table()
            .and_then(|handler| handler.get("statusMessage"))
            .and_then(|value| value.as_str()),
        Some("其他 Hook")
    );
}

fn count_codepulse_handlers(value: &Value) -> usize {
    value["hooks"]
        .as_object()
        .into_iter()
        .flat_map(|events| events.values())
        .flat_map(|groups| groups.as_array().into_iter().flatten())
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .filter(|handler| handler["statusMessage"] == CODEPULSE_HOOK_MARKER)
        .count()
}

fn count_codepulse_toml_handlers(document: &DocumentMut) -> usize {
    CODEPULSE_HOOK_EVENTS
        .iter()
        .flat_map(|event| document["hooks"][event].as_array_of_tables().into_iter().flatten())
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .filter(|handler| {
            handler
                .as_inline_table()
                .and_then(|handler| handler.get("statusMessage"))
                .and_then(|status_message| status_message.as_str())
                == Some(CODEPULSE_HOOK_MARKER)
        })
        .count()
}
