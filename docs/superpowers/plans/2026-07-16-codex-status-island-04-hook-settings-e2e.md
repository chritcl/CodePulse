# 阶段四：Codex Hook 安全接入总览与审核索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement exactly one reviewed batch at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把阶段四拆为三个可独立拒绝、验收和回滚的审核批次，在不破坏用户 Hook、不自动开启全局 Hooks 的前提下完成只读检查、配置写入、Bridge 安装、设置页和真实端验收。

**架构：** 04A 只读文件并产生纯 inspection/planner 结果；04B 才负责 writer、installer、Tauri commands 和 inspection 驱动的 runtime 生命周期；04C 只消费公开命令与 `CodexListeningStatus` 完成 UI、显示偏好和 E2E。三个批次严格串行，每个批次完成后停止等待 review。

**技术栈：** Rust、serde_json、toml_edit 0.25、sha2、Windows `MoveFileExW`、Tauri 2.11.5、Vue 3、Pinia/localStorage、Vitest、PowerShell；不新增前端生产依赖。

## 全局约束

- 本总览只索引阶段四，不承载可直接实施的混合任务。
- 所有模块消费阶段一唯一的 `CodexIntegrationPaths`；不得自行拼接 CodePulse/runtime/bin。
- 本地数据根目录由 `app.path().local_data_dir()?` 获得，再由路径对象生成 `%LOCALAPPDATA%\CodePulse`。
- 应用启动顺序固定为：构造路径对象 → 恢复配置事务 → 只读 inspection → inspection 决定 runtime 启停 → 发布 listening status。
- `features.hooks=false` 时 CodePulse 只展示手动开启引导；不写该开关、不生成 install plan、不写 Bridge、不启动 HTTP。
- 企业托管禁用时只显示组织策略说明，不修改 `%ProgramData%\OpenAI\Codex\requirements.toml`。
- `idlePersistent` 只影响 running 且无任务的展示，不能调用 runtime start/stop。
- 配置变更必须预览、expectedDigest/previewDigest 双重防并发、备份、同目录临时文件、重新解析和原子替换。
- Bridge 安装前必须校验 DOS Header、`e_lfanew`、`PE\0\0` 和目标 triple 对应的 COFF Machine。
- 第一版排除 WSL；自动事件不能冒充 Codex App/CLI 的真实 Hook 信任验收。

## 固定跨批次接口

04A 产生、04B 与 04C 消费：

```rust
pub enum CodexHookAction { Install, Repair, Uninstall }
pub enum CodexHookRepresentation { HooksJson, ConfigToml, None, Conflict }
pub enum CodexHooksFeature { Enabled, Disabled, ManagedDisabled }
pub enum ManagedEntryState { Absent, Exact, Modified, Duplicate }
pub enum CodePulseMarkerPresence { Absent, Present, Ambiguous }
pub enum BridgeState { Missing, Current, Outdated, Modified }

pub struct CodexIntegrationInspection {
    pub codex_home: String,
    pub feature_config_path: String,
    pub representation: CodexHookRepresentation,
    pub config_path: Option<String>,
    pub config_digest: Option<String>,
    pub hooks_feature: CodexHooksFeature,
    pub managed_entry: ManagedEntryState,
    pub marker_presence: CodePulseMarkerPresence,
    pub bridge_state: BridgeState,
    pub hook_state: CodexHookState,
    pub phase: CodexListeningPhase,
    pub issues: Vec<String>,
}

pub struct CodexHookChangePreview {
    pub action: CodexHookAction,
    pub representation: WritableHookRepresentation,
    pub config_path: String,
    pub expected_digest: String,
    pub preview_digest: String,
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
    pub bridge_action: BridgeAction,
}

pub struct CodexHookChangeResult {
    pub inspection: CodexIntegrationInspection,
    pub self_check: CodexSelfCheckResult,
}
```

04B 公开给 04C 的命令：

```rust
#[tauri::command]
pub async fn inspect_codex_integration(
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexIntegrationInspection, String>;

#[tauri::command]
pub async fn preview_codex_hook_change(
    action: CodexHookAction,
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexHookChangePreview, String>;

#[tauri::command]
pub async fn apply_codex_hook_change(
    action: CodexHookAction,
    expected_digest: String,
    preview_digest: String,
    runtime: tauri::State<'_, CodexRuntimeManager>,
) -> Result<CodexHookChangeResult, String>;
```

Widget 投影固定使用：

```ts
toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)
```

## 批次依赖

```text
04A Inspection + Planner
 ↓ review 并明确批准
04B Writer + Installer + Tauri Commands
 ↓ review 并明确批准
04C Settings + E2E
 ↓ 最终 review
```

| 批次 | 详细计划 | 独立交付物 | 禁止范围 |
|---|---|---|---|
| 04A | `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md` | TempDir 只读 inspection、phase/runtime 决策、install/repair/uninstall 纯计划与预览摘要 | 不写盘、不安装 Bridge、不注册 apply 命令、不修改 Vue |
| 04B | `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md` | writer、事务恢复、Bridge installer、PE 校验、三命令、按 inspection 启停 | 不实现设置页、不把 HooksDisabled 绕过去 |
| 04C | `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md` | 设置卡、两阶段手动启用引导、显示偏好、自动/真实 E2E 与验收记录 | 不新增配置写入逻辑、不宣称环境阻塞的 CLI 已通过 |

## 审核批次 04A

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04a-inspection-planner.md`
- Review diff: `src-tauri/src/codex/integration/inspection.rs`
- Review diff: `src-tauri/src/codex/integration/plan.rs`

- [ ] **步骤 1：执行 04A 计划的全部任务**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::inspection_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::plan_tests -- --nocapture
  Pop-Location
  ```

  预期：TempDir inspection/planner 测试全部通过；没有 writer、installer、Tauri apply 或 Vue 文件。

- [ ] **步骤 2：停下来审核 04A**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：只出现 04A 文件清单；审核者明确批准前不得执行 04B。

## 审核批次 04B

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04b-writer-installer.md`
- Consume from 04A: `CodexIntegrationInspection`、`PreparedCodexHookChange`、`derive_startup_runtime_decision()`
- Produce for 04C: inspect/preview/apply Tauri commands 与权威 listening status

- [ ] **步骤 1：在 04A 已批准后执行 04B 计划**

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::integration::writer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::installer_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::integration::commands_tests -- --nocapture
  cargo test -p netspeed-dynamic codex::service_tests -- --nocapture
  Pop-Location
  ```

  预期：故障注入、篡改保护、精确卸载、PE 架构和 runtime 生命周期通过；HooksDisabled 用例没有文件写入或 HTTP 启动。

- [ ] **步骤 2：停下来审核 04B**

  运行：

  ```powershell
  git diff --name-only
  git diff --check
  ```

  预期：没有 dashboard/settings Vue 文件；审核者明确批准前不得执行 04C。

## 审核批次 04C

**Files:**

- Execute plan: `docs/superpowers/plans/2026-07-16-codex-status-island-04c-settings-e2e.md`
- Create verification at execution time only: `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`

- [ ] **步骤 1：在 04B 已批准后执行 04C 计划**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  Push-Location src-tauri
  cargo test --workspace
  Pop-Location
  ```

  预期：设置/UI/自动 E2E 通过；真实验收记录只在 04C 实施时创建。

- [ ] **步骤 2：停下来完成最终审核**

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git status --short
  ```

  预期：App 真实 Hook 信任结果如实记录；独立 CLI 不可用时写“环境阻塞”并阻止完整兼容声明。

## 阶段四总门禁

- 04A、04B、04C 依序完成且每批次后都有独立 review 结论。
- HooksDisabled 不产出 PreparedCodexHookChange，不写 Bridge，不启动 HTTP；用户手动启用后重新 inspection 才允许 preview。
- exact/modified/带 marker 的 partial 按 inspection 启动；not_installed/disabled/managed disabled/不安全 conflict 不常驻；卸载确认后停止并删发现文件。
- 用户其他 Hook 在 install/repair/uninstall 后语义保持；卸载不恢复整份旧备份。
- idlePersistent 不启动服务，也不把未安装、禁用、冲突或服务错误伪装为已就绪。
- Bridge 打包与安装同时验证目标 PE Machine；旧 target 目录或错架构资源不能通过门禁。
- 验收记录路径唯一为 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- 全部完成后停止，不自动开展下一版功能。
