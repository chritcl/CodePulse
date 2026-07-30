use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::bridge_install::bridge_target_path;
use super::config::{apply_codepulse_hook_mutation, HookConfigFormat, HookMutation};
use super::integration::{
    bridge_command, BridgeStatus, CodePulseHookStatus, CodexIntegration, GlobalHooksStatus,
    IntegrationAction, IntegrationPaths, SelectedConfigRepresentation,
};

static NEXT_DIRECTORY_ID: AtomicUsize = AtomicUsize::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codepulse-codex-integration-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        Self(directory)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn bridge_命令可跨_shell_执行带空格的路径并标记桌面来源() {
    let path =
        PathBuf::from(r"C:\Users\Test User\AppData\Roaming\CodePulse\codepulse-codex-bridge.exe");

    assert_eq!(
        bridge_command(&path),
        r#"cmd.exe /D /S /C ""C:\Users\Test User\AppData\Roaming\CodePulse\codepulse-codex-bridge.exe" --source app""#
    );
}

#[test]
fn 检查只选择带有_codepulse_标记的用户层_hooks_json() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    let source = directory.join("published-bridge.exe");
    let target = bridge_target_path(&app_data_dir);
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::create_dir_all(&app_data_dir).expect("应创建模拟应用数据目录");
    fs::write(&source, b"bridge-v1").expect("应写入发布 Bridge");
    fs::copy(&source, &target).expect("应写入固定 Bridge");
    fs::write(
        codex_home.join("config.toml"),
        "[features]\nhooks = true\nmodel = \"gpt-5.6\"\n",
    )
    .expect("应写入用户 config.toml");
    let bridge_command = bridge_command(&target);
    let hooks_json = apply_codepulse_hook_mutation(
        HookConfigFormat::HooksJson,
        "{ \"hooks\": {} }",
        &bridge_command,
        HookMutation::InstallOrRepair,
    )
    .expect("应构建有效 Hook 配置");
    fs::write(codex_home.join("hooks.json"), hooks_json).expect("应写入用户 hooks.json");

    let integration = test_integration(IntegrationPaths::new(codex_home, app_data_dir, source));
    let status = integration.check();

    assert_eq!(
        status.selected_config,
        SelectedConfigRepresentation::HooksJson
    );
    assert_eq!(status.global_hooks, GlobalHooksStatus::Enabled);
    assert_eq!(status.hook, CodePulseHookStatus::WaitingTrust);
    assert_eq!(status.bridge, BridgeStatus::Ready);
}

#[test]
fn 重复的_codepulse_标记会被识别为需要修复() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    let source = directory.join("published-bridge.exe");
    let target = bridge_target_path(&app_data_dir);
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::create_dir_all(&app_data_dir).expect("应创建模拟应用数据目录");
    fs::write(&source, b"bridge-v1").expect("应写入发布 Bridge");
    fs::copy(&source, &target).expect("应写入固定 Bridge");
    let bridge_command = bridge_command(&target);
    let configured = apply_codepulse_hook_mutation(
        HookConfigFormat::HooksJson,
        "{ \"hooks\": {} }",
        &bridge_command,
        HookMutation::InstallOrRepair,
    )
    .expect("应构建有效 Hook 配置");
    let mut duplicated: serde_json::Value =
        serde_json::from_str(&configured).expect("应解析构建后的 Hook 配置");
    let handlers = duplicated["hooks"]["SessionStart"][0]["hooks"]
        .as_array_mut()
        .expect("SessionStart 应包含处理器数组");
    handlers.push(handlers[0].clone());
    fs::write(
        codex_home.join("hooks.json"),
        serde_json::to_string_pretty(&duplicated).expect("应序列化重复标记配置"),
    )
    .expect("应写入重复标记配置");

    let integration = test_integration(IntegrationPaths::new(codex_home, app_data_dir, source));
    let status = integration.check();

    assert_eq!(
        status.selected_config,
        SelectedConfigRepresentation::HooksJson
    );
    assert_eq!(status.hook, CodePulseHookStatus::NeedsRepair);
    assert_eq!(status.bridge, BridgeStatus::Ready);
}

#[test]
fn 无法解析的用户层配置只提示人工处理且拒绝生成预览() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    let source = directory.join("published-bridge.exe");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(&source, b"bridge-v1").expect("应写入发布 Bridge");
    let hooks_path = codex_home.join("hooks.json");
    fs::write(&hooks_path, "{ invalid json").expect("应写入损坏的 hooks.json");
    let integration = test_integration(IntegrationPaths::new(codex_home, app_data_dir, source));

    let status = integration.check();

    assert_eq!(
        status.selected_config,
        SelectedConfigRepresentation::Invalid
    );
    assert_eq!(status.hook, CodePulseHookStatus::ManualIntervention);
    assert!(integration.preview(IntegrationAction::InstallOrRepair).is_err());
    assert_eq!(
        fs::read_to_string(hooks_path).expect("应读取原始损坏配置"),
        "{ invalid json"
    );
}

#[test]
fn 确认前发现配置摘要变化时拒绝写入_bridge_和_hook() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    let source = directory.join("published-bridge.exe");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(&source, b"bridge-v1").expect("应写入发布 Bridge");
    fs::write(codex_home.join("hooks.json"), "{ \"hooks\": {} }\n").expect("应写入初始 hooks.json");
    let integration = test_integration(IntegrationPaths::new(
        codex_home.clone(),
        app_data_dir.clone(),
        source,
    ));

    let preview = integration
        .preview(IntegrationAction::InstallOrRepair)
        .expect("应生成不写盘的安装预览");
    fs::write(
        codex_home.join("hooks.json"),
        "{ \"hooks\": { \"SessionStart\": [] } }\n",
    )
    .expect("应模拟外部修改");

    let result = integration.confirm(&preview.id);

    assert!(result.is_err(), "配置变化后必须要求重新预览");
    assert!(
        !bridge_target_path(&app_data_dir).exists(),
        "摘要不一致时不能先写入 Bridge"
    );
}

#[test]
fn 确认安装后保留其他_hook_并创建_bridge_和配置备份() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(
        codex_home.join("hooks.json"),
        r#"
        {
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
        "#,
    )
    .expect("应写入初始 hooks.json");
    let source = test_bridge_source(&directory);
    let integration = test_integration(IntegrationPaths::new(
        codex_home.clone(),
        app_data_dir.clone(),
        source.clone(),
    ));

    let preview = integration.preview(IntegrationAction::InstallOrRepair).expect("应生成安装预览");
    assert_eq!(
        preview.target_file,
        codex_home.join("hooks.json").display().to_string(),
        "预览应明确显示将写入的完整配置路径"
    );
    integration.confirm(&preview.id).expect("确认后应完成安装");

    let updated: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_home.join("hooks.json")).expect("应读取更新后的 hooks.json"),
    )
    .expect("更新后的 hooks.json 应有效");
    assert_eq!(
        updated["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        "C:\\tools\\other-hook.exe"
    );
    assert_eq!(count_codepulse_handlers(&updated), 7);
    assert_eq!(
        fs::read(bridge_target_path(&app_data_dir)).expect("应读取固定 Bridge"),
        fs::read(source).expect("应读取发布 Bridge")
    );
    assert!(
        fs::read_dir(&codex_home)
            .expect("应读取用户配置目录")
            .filter_map(Result::ok)
            .any(|entry| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                file_name.starts_with("hooks.json.codepulse-") && file_name.ends_with(".bak")
            }),
        "替换前必须保留时间戳备份"
    );
}

#[test]
fn 确认卸载后只移除_codepulse_hook_并删除未引用_bridge() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(
        codex_home.join("hooks.json"),
        r#"
        {
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
        "#,
    )
    .expect("应写入初始 hooks.json");
    let source = test_bridge_source(&directory);
    let integration = test_integration(IntegrationPaths::new(
        codex_home.clone(),
        app_data_dir.clone(),
        source,
    ));

    let install_preview =
        integration.preview(IntegrationAction::InstallOrRepair).expect("应生成安装预览");
    integration.confirm(&install_preview.id).expect("应先完成安装");
    let uninstall_preview =
        integration.preview(IntegrationAction::Uninstall).expect("应生成卸载预览");
    let result = integration.confirm(&uninstall_preview.id).expect("应完成精确卸载");

    let updated: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_home.join("hooks.json")).expect("应读取更新后的 hooks.json"),
    )
    .expect("更新后的 hooks.json 应有效");
    assert_eq!(
        updated["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        "C:\\tools\\other-hook.exe"
    );
    assert_eq!(count_codepulse_handlers(&updated), 0);
    assert!(!bridge_target_path(&app_data_dir).exists());
    assert!(!result.bridge_cleanup_pending);
}

#[test]
fn 卸载后_bridge_删除失败时保留已成功更新的_hook_配置() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(codex_home.join("hooks.json"), "{ \"hooks\": {} }\n").expect("应写入初始 hooks.json");
    let integration = test_integration(IntegrationPaths::new(
        codex_home.clone(),
        app_data_dir.clone(),
        test_bridge_source(&directory),
    ));

    let install_preview =
        integration.preview(IntegrationAction::InstallOrRepair).expect("应生成安装预览");
    integration.confirm(&install_preview.id).expect("应先完成安装");
    let bridge_path = bridge_target_path(&app_data_dir);
    fs::remove_file(&bridge_path).expect("应移除测试 Bridge 文件");
    fs::create_dir(&bridge_path).expect("应创建不可作为文件删除的测试目录");

    let uninstall_preview =
        integration.preview(IntegrationAction::Uninstall).expect("应生成卸载预览");
    let result = integration.confirm(&uninstall_preview.id).expect("配置卸载仍应完成");

    let updated: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(codex_home.join("hooks.json")).expect("应读取更新后的 hooks.json"),
    )
    .expect("更新后的 hooks.json 应有效");
    assert_eq!(count_codepulse_handlers(&updated), 0);
    assert!(result.bridge_cleanup_pending);
}

#[test]
fn 卸载时保留仍被其他_json_hook_引用的_bridge() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    fs::write(codex_home.join("hooks.json"), "{ \"hooks\": {} }\n").expect("应写入初始 hooks.json");
    let source = test_bridge_source(&directory);
    let integration = test_integration(IntegrationPaths::new(
        codex_home.clone(),
        app_data_dir.clone(),
        source,
    ));

    let install_preview =
        integration.preview(IntegrationAction::InstallOrRepair).expect("应生成安装预览");
    integration.confirm(&install_preview.id).expect("应先完成安装");

    let hooks_path = codex_home.join("hooks.json");
    let mut hooks: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&hooks_path).expect("应读取安装后的 hooks.json"))
            .expect("安装后的 hooks.json 应有效");
    hooks["hooks"]["Stop"] = serde_json::json!([
        {
            "hooks": [
                {
                    "type": "command",
                    "command": format!("\"{}\"", bridge_target_path(&app_data_dir).display()),
                    "statusMessage": "其他工具仍在使用 CodePulse Bridge"
                }
            ]
        }
    ]);
    fs::write(
        &hooks_path,
        serde_json::to_string_pretty(&hooks).expect("应序列化模拟用户 Hook"),
    )
    .expect("应写入模拟用户 Hook");

    let uninstall_preview =
        integration.preview(IntegrationAction::Uninstall).expect("应生成卸载预览");
    let result = integration.confirm(&uninstall_preview.id).expect("应完成精确卸载");

    assert!(
        bridge_target_path(&app_data_dir).exists(),
        "其他 JSON Hook 仍引用 Bridge 时不得删除"
    );
    assert!(!result.bridge_cleanup_pending);
}

#[test]
fn 卸载时保留仍被其他_toml_hook_引用的_bridge() {
    let directory = TestDirectory::new();
    let codex_home = directory.join("user/.codex");
    let app_data_dir = directory.join("app-data");
    fs::create_dir_all(&codex_home).expect("应创建模拟用户配置目录");
    let config_path = codex_home.join("config.toml");
    fs::write(&config_path, "[features]\nhooks = true\n").expect("应写入初始 config.toml");
    let integration = test_integration(IntegrationPaths::new(
        codex_home,
        app_data_dir.clone(),
        test_bridge_source(&directory),
    ));

    let install_preview =
        integration.preview(IntegrationAction::InstallOrRepair).expect("应生成安装预览");
    integration.confirm(&install_preview.id).expect("应先完成安装");

    let installed = fs::read_to_string(&config_path).expect("应读取安装后的 config.toml");
    let foreign_command = format!("\"{}\"", bridge_target_path(&app_data_dir).display());
    fs::write(
        &config_path,
        format!(
            "{installed}\n[[hooks.Stop]]\nhooks = [{{ type = \"command\", command = {foreign_command:?}, statusMessage = \"其他 Hook\" }}]\n"
        ),
    )
    .expect("应写入仍引用 Bridge 的其他 TOML Hook");

    let uninstall_preview =
        integration.preview(IntegrationAction::Uninstall).expect("应生成卸载预览");
    let result = integration.confirm(&uninstall_preview.id).expect("应完成精确卸载");

    assert!(
        bridge_target_path(&app_data_dir).exists(),
        "其他 TOML Hook 仍引用 Bridge 时不得删除"
    );
    assert!(!result.bridge_cleanup_pending);
}

fn test_integration(paths: IntegrationPaths) -> CodexIntegration {
    CodexIntegration::new_for_test(paths)
}

fn test_bridge_source(directory: &TestDirectory) -> PathBuf {
    let source = directory.join("published-bridge.exe");
    fs::write(&source, b"bridge-v1").expect("应写入测试发布 Bridge");
    source
}

fn count_codepulse_handlers(value: &serde_json::Value) -> usize {
    value["hooks"]
        .as_object()
        .into_iter()
        .flat_map(|events| events.values())
        .flat_map(|groups| groups.as_array().into_iter().flatten())
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .filter(|handler| handler["statusMessage"] == "CodePulse Codex 状态岛")
        .count()
}
