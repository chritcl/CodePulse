use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use super::config::{CLAUDE_HOOK_EVENTS, CLAUDE_HOOK_MARKER};
use super::integration::{
    ClaudeBridgeStatus, ClaudeCliStatus, ClaudeHookStatus, ClaudeIntegration,
    ClaudeIntegrationAction, ClaudeIntegrationPaths,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "codepulse-claude-integration-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn paths(&self) -> ClaudeIntegrationPaths {
        let claude_home = self.0.join("user/.claude");
        let app_data_dir = self.0.join("app-data");
        let bridge_source = self.0.join("resources/codepulse-claude-bridge.exe");
        let cli_executable = self.0.join("bin/claude.exe");
        fs::create_dir_all(bridge_source.parent().unwrap()).unwrap();
        fs::write(&bridge_source, b"bridge").unwrap();
        ClaudeIntegrationPaths::new(claude_home, app_data_dir, bridge_source, cli_executable)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn 缺失或低版本_cli_禁止安装而最低版本允许安装() {
    let directory = TestDirectory::new();
    let paths = directory.paths();

    let missing = ClaudeIntegration::new_for_test(paths.clone(), None);
    assert_eq!(missing.check().cli, ClaudeCliStatus::Missing);
    assert!(missing.preview(ClaudeIntegrationAction::InstallOrRepair).is_err());

    let old = ClaudeIntegration::new_for_test(paths.clone(), Some("2.1.220"));
    assert_eq!(old.check().cli, ClaudeCliStatus::Unsupported);
    assert!(old.preview(ClaudeIntegrationAction::InstallOrRepair).is_err());

    let supported = ClaudeIntegration::new_for_test(paths, Some("2.1.221"));
    assert_eq!(supported.check().cli, ClaudeCliStatus::Ready);
    assert!(supported.preview(ClaudeIntegrationAction::InstallOrRepair).unwrap().can_confirm);
}

#[test]
fn 策略只阻止安装且禁用全部_hook_只产生警告() {
    let directory = TestDirectory::new();
    let paths = directory.paths();
    fs::create_dir_all(paths.claude_home()).unwrap();
    fs::write(
        paths.settings_file(),
        r#"{"allowManagedHooksOnly":true,"disableAllHooks":true,"hooks":{}}"#,
    )
    .unwrap();
    let integration = ClaudeIntegration::new_for_test(paths.clone(), Some("2.1.221"));
    let status = integration.check();
    assert!(status.allow_managed_hooks_only);
    assert!(status.disable_all_hooks);
    assert!(integration.preview(ClaudeIntegrationAction::InstallOrRepair).is_err());

    fs::write(
        paths.settings_file(),
        r#"{"disableAllHooks":true,"hooks":{}}"#,
    )
    .unwrap();
    let integration = ClaudeIntegration::new_for_test(paths, Some("2.1.221"));
    let preview = integration.preview(ClaudeIntegrationAction::InstallOrRepair).unwrap();
    assert!(preview.warnings.iter().any(|warning| warning.contains("disableAllHooks")));
}

#[test]
fn 安装确认创建备份并保留未知设置() {
    let directory = TestDirectory::new();
    let paths = directory.paths();
    fs::create_dir_all(paths.claude_home()).unwrap();
    fs::write(
        paths.settings_file(),
        r#"{"permissions":{"allow":["Read"]},"env":{"KEEP":"1"},"hooks":{}}"#,
    )
    .unwrap();
    let integration = ClaudeIntegration::new_for_test(paths.clone(), Some("2.1.221"));
    let preview = integration.preview(ClaudeIntegrationAction::InstallOrRepair).unwrap();
    let result = integration.confirm(&preview.id).unwrap();

    assert!(result.backup_file.is_some());
    assert!(paths.app_data_dir().join("codepulse-claude-bridge.exe").is_file());
    let value: Value = serde_json::from_slice(&fs::read(paths.settings_file()).unwrap()).unwrap();
    assert_eq!(value["permissions"]["allow"][0], "Read");
    assert_eq!(value["env"]["KEEP"], "1");
    assert_eq!(integration.check().hook, ClaudeHookStatus::Installed);
    assert_eq!(integration.check().bridge, ClaudeBridgeStatus::Ready);
}

#[test]
fn 预览后配置变化会拒绝确认且不写入_bridge() {
    let directory = TestDirectory::new();
    let paths = directory.paths();
    let integration = ClaudeIntegration::new_for_test(paths.clone(), Some("2.1.221"));
    let preview = integration.preview(ClaudeIntegrationAction::InstallOrRepair).unwrap();
    fs::create_dir_all(paths.claude_home()).unwrap();
    fs::write(paths.settings_file(), "{\"changed\":true}").unwrap();

    assert!(integration.confirm(&preview.id).is_err());
    assert!(!paths.app_data_dir().join("codepulse-claude-bridge.exe").exists());
}

#[test]
fn 卸载只删除带标记项并在_cli_缺失时仍可执行() {
    let directory = TestDirectory::new();
    let paths = directory.paths();
    fs::create_dir_all(paths.claude_home()).unwrap();
    let mut hooks = serde_json::Map::new();
    for event in CLAUDE_HOOK_EVENTS {
        hooks.insert(
            event.to_string(),
            serde_json::json!([{
                "hooks": [{
                    "type": "command",
                    "command": paths.app_data_dir().join("codepulse-claude-bridge.exe"),
                    "args": [CLAUDE_HOOK_MARKER],
                    "timeout": 2
                }]
            }]),
        );
    }
    hooks.get_mut("Stop").unwrap().as_array_mut().unwrap().push(serde_json::json!({
        "hooks": [{ "type": "command", "command": "other.exe", "args": ["keep"] }]
    }));
    fs::write(
        paths.settings_file(),
        serde_json::to_vec(&serde_json::json!({
            "allowManagedHooksOnly": true,
            "hooks": hooks,
            "statusLine": { "type": "command", "command": "status.exe" }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::create_dir_all(paths.app_data_dir()).unwrap();
    fs::write(
        paths.app_data_dir().join("codepulse-claude-bridge.exe"),
        b"bridge",
    )
    .unwrap();
    let integration = ClaudeIntegration::new_for_test(paths.clone(), None);

    let preview = integration.preview(ClaudeIntegrationAction::Uninstall).unwrap();
    integration.confirm(&preview.id).unwrap();
    let value: Value = serde_json::from_slice(&fs::read(paths.settings_file()).unwrap()).unwrap();
    assert_eq!(value["hooks"]["Stop"].as_array().unwrap().len(), 1);
    assert_eq!(value["statusLine"]["command"], "status.exe");
    assert_eq!(integration.check().hook, ClaudeHookStatus::NotInstalled);
}

#[test]
fn 无效_json_进入人工处理且不能生成预览() {
    let directory = TestDirectory::new();
    let paths = directory.paths();
    fs::create_dir_all(paths.claude_home()).unwrap();
    fs::write(paths.settings_file(), "{invalid").unwrap();
    let integration = ClaudeIntegration::new_for_test(paths, Some("2.1.221"));

    assert_eq!(
        integration.check().hook,
        ClaudeHookStatus::ManualIntervention
    );
    assert!(integration.preview(ClaudeIntegrationAction::InstallOrRepair).is_err());
    assert!(integration.preview(ClaudeIntegrationAction::Uninstall).is_err());
}
