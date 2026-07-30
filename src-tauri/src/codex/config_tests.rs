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
        7,
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
    assert_eq!(count_codepulse_toml_handlers(&parsed), 7);
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
