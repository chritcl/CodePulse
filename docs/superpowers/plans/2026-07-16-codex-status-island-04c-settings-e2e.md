# 阶段四 C：Codex 设置、显示偏好与端到端验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04B 命令与生命周期已审核通过后，实现设置卡、手动启用全局 Hooks 的两阶段引导、预览确认、空闲常驻/命令摘要显示偏好，并完成自动化与 Windows 原生 App/CLI 真实验收。

**架构：** `useCodexIntegration` 只编排 04B inspect/preview/apply/self-check 和权威 listening event；设置卡不读写文件；前端偏好只进入 localStorage 与跨窗口事件；Widget 使用阶段三统一投影 `toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)`。自动 E2E 使用 TempDir/loopback/ManualClock，真实验收单独记录。

**技术栈：** Vue 3 Composition API、Pinia/localStorage、Tauri JS API、Vitest、`@vue/test-utils`、Rust TempDir/ManualClock、PowerShell、pnpm 10.33.2。

## 全局约束

- 前置门禁：04B 全部通过并已单独 review。
- 设置页与 Widget 使用同一个 `CodexListeningStatus` 类型、命令和 `codex-listening-status-changed` 权威事件，不复制 phase 派生。
- CodePulse 只能检测和说明 `features.hooks=false`；用户必须在 Codex 配置或官方 UI 手动开启，再返回重新检测。
- “启用全局 Hooks”和“安装 CodePulse Hook”是两个明确确认项，不能合并成一次 apply。
- idlePersistent 只影响 running+无任务的显示，不能 invoke install、repair、ensure_started 或 self-check。
- 真实验收记录只在执行本计划时创建于 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- CLI 环境阻塞必须如实记录并阻止“正式兼容已通过”声明。
- 本计划完成后停止，不自动开始后续功能。

---

## 任务 1：添加 Integration IPC 契约与异步安全 composable

**独立交付物：** 主窗口可以安全 inspect、preview、confirm、cancel 和 self-check；旧请求、取消和卸载后结果不会回写。

**Files:**

- Modify: `src/shared/ipc/contracts.ts`
- Modify: `src/shared/ipc/commands.ts`
- Modify: `src/shared/ipc/commands.test.ts`
- Modify: `src/shared/ipc/index.ts`
- Create: `src/composables/useCodexIntegration.ts`
- Create: `src/composables/useCodexIntegration.test.ts`

**消费接口：** 04B 三个 integration Tauri commands、阶段二 `getCodexListeningStatus()`/`runCodexSelfCheck()` 与 listening event。

**产生接口：**

```ts
export type CodexHookAction = 'install' | 'repair' | 'uninstall'
export type CodexHooksFeature = 'enabled' | 'disabled' | 'managed_disabled'
export type CodePulseMarkerPresence = 'absent' | 'present' | 'ambiguous'

export interface CodexIntegrationInspection {
  codexHome: string
  featureConfigPath: string
  representation: 'hooks_json' | 'config_toml' | 'none' | 'conflict'
  configPath?: string
  configDigest?: string
  hooksFeature: CodexHooksFeature
  managedEntry: 'absent' | 'exact' | 'modified' | 'duplicate'
  markerPresence: CodePulseMarkerPresence
  bridgeState: 'missing' | 'current' | 'outdated' | 'modified'
  hookState: CodexListeningStatus['hookState']
  phase: CodexListeningStatus['phase']
  issues: string[]
}

export interface CodexHookChangePreview {
  action: CodexHookAction
  representation: 'hooks_json' | 'config_toml'
  configPath: string
  expectedDigest: string
  previewDigest: string
  changes: string[]
  warnings: string[]
  bridgeAction: 'install' | 'update' | 'keep' | 'remove'
}

export interface CodexHookChangeResult {
  inspection: CodexIntegrationInspection
  selfCheck: CodexSelfCheckResult
}

export function useCodexIntegration(): {
  inspection: Readonly<Ref<CodexIntegrationInspection | null>>
  listeningStatus: Readonly<Ref<CodexListeningStatus | null>>
  preview: Readonly<Ref<CodexHookChangePreview | null>>
  busy: Readonly<Ref<boolean>>
  errorCode: Readonly<Ref<string | null>>
  inspect: () => Promise<void>
  requestChange: (action: CodexHookAction) => Promise<void>
  confirmChange: () => Promise<void>
  cancelPreview: () => void
  runSelfCheck: () => Promise<CodexSelfCheckResult>
}
```

- [ ] **步骤 1：先写 IPC wrapper 与类型失败测试**

  断言 inspect/preview/apply wrapper 的 snake_case 命令与 camelCase 参数；apply 精确发送 action、expectedDigest、previewDigest；完整 fixture 用 `satisfies` 固定 hooksFeature/markerPresence/phase；公开 payload 不含 target bytes、token、完整配置或事务正文。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/shared/ipc/codexContracts.test.ts
  ```

  预期：integration 类型和 wrapper 不存在，测试/类型编译失败。

- [ ] **步骤 2：先写 composable 异步竞态失败测试**

  覆盖先注册 listening listener 再初始 inspect/getStatus；旧 inspect 不覆盖新请求；requestChange 只保存 preview；confirm 使用当前 preview 摘要且防重复；摘要冲突显示稳定 errorCode 并重新 inspect；cancel 零 apply；dispose 后迟到结果不回写；listening event 完整替换并与 inspection.phase 一致；apply 成功只使用返回 inspection/self-check，不手工设置 running。

  运行：

  ```powershell
  pnpm run test -- src/composables/useCodexIntegration.test.ts
  ```

  预期：composable 不存在，测试失败。

- [ ] **步骤 3：实现最小 IPC 与 generation 隔离**

  所有类型从 shared ipc 单一导出；composable 用 generation/disposed 防旧请求，scope dispose 清 listener；HooksDisabled/ManagedDisabled/ConfigConflict 只转换为稳定 errorCode，不触发其他命令。正常运行只来自 listeningStatus.phase=running。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/composables/useCodexIntegration.test.ts
  pnpm run typecheck
  ```

  预期：IPC、竞态、取消、错误和清理测试通过。

- [ ] **步骤 4：提交前端 integration 运行时**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "phase\s*=|phase\.value\s*=" src/composables/useCodexIntegration.ts
  git diff --check
  ```

  预期：composable 不自行派生 phase；质量检查通过。

  建议提交信息：

  ```text
  接入 Codex 集成检查与预览命令
  ```

---

## 任务 2：实现两阶段 Hooks 引导与设置卡

**独立交付物：** 设置页清楚分离“用户手动启用全局 Hooks”和“CodePulse 预览安装 Hook”，并覆盖七种 listening phase。

**Files:**

- Create: `src/components/dashboard/CodexStatusSettingsCard.vue`
- Create: `src/components/dashboard/CodexStatusSettingsCard.test.ts`
- Modify: `src/components/dashboard/IslandSettingsPanel.vue`
- Modify: `src/components/dashboard/IslandSettingsPanel.test.ts`

**消费接口：** 任务 1 `useCodexIntegration()`、`CodexIntegrationInspection.featureConfigPath/hooksFeature`、权威 `CodexListeningStatus`。

**产生接口：** 无新跨层类型；组件只发用户操作到 composable。

- [ ] **步骤 1：先写七 phase 与操作可见性失败测试**

  覆盖 running/awaiting_trust/partial/service_error/config_conflict/not_installed/disabled 中文状态、最近事件、来源、自检。not_installed+enabled 显示“预览安装”；modified/partial 显示“预览修复”；已安装显示“预览卸载”；所有动作先 preview 后 confirm/cancel。awaiting_trust 不误报 running。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts
  ```

  预期：设置卡不存在，测试失败。

- [ ] **步骤 2：先写 HooksDisabled 手动引导失败测试**

  hooksFeature=disabled 时固定展示：第一步“在 Codex 配置中手动启用 Hooks”与 featureConfigPath；第二步“返回 CodePulse，重新检测环境”；第三步“预览并安装 CodePulse Hook”。安装按钮不可执行，点击/键盘都不调用 preview/apply，不写 Bridge、不启动 HTTP。重新 inspect 得到 enabled 后才出现安装 preview 按钮。不得提供“由 CodePulse 开启”按钮。

  managed_disabled 时显示“由组织策略管理”，不显示修改企业文件、安装、修复或卸载按钮；config_conflict 只显示检测结果和安全说明。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts
  ```

  预期：若旧交互会在 install 中修改 feature flag，测试失败。

- [ ] **步骤 3：先写预览确认与无障碍失败测试**

  预览区逐项显示 changes/warnings/bridgeAction，确认/取消分别只调用一次；busy 禁重复；error 使用 aria-live；按钮有 type/可访问名称；HooksDisabled 不产生空 preview 弹窗；settings panel 在 grid 末尾渲染全宽卡且现有设置测试不变。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts src/components/dashboard/IslandSettingsPanel.test.ts
  ```

  预期：交互和布局测试失败。

- [ ] **步骤 4：实现设置卡**

  卡片只调用 composable；不读写文件、不调用 runtime manager。`featureConfigPath` 只展示，复制功能若实现也只复制路径。样式保留在 scoped CSS，不重构控制台布局。两个确认项在视觉和交互上分区，用户手动操作后必须点击“重新检测环境”。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts src/components/dashboard/IslandSettingsPanel.test.ts
  pnpm run typecheck
  ```

  预期：七状态、手动引导、预览、无障碍和设置面板回归通过。

- [ ] **步骤 5：提交设置卡**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "update.*hooks|hooks.*true|ensureStarted|ensure_started" src/components/dashboard src/composables
  git diff --check
  ```

  预期：生产前端没有自动开启 Hooks 或启动 runtime 的调用。

  建议提交信息：

  ```text
  添加 Codex Hooks 手动启用引导与设置卡
  ```

---

## 任务 3：接入显示偏好并统一 Widget Listening Status 投影

**独立交付物：** 空闲常驻和命令摘要偏好跨窗口同步；无任务时严格按 listening phase 显示/隐藏；偏好不改变服务生命周期。

**Files:**

- Modify: `src/shared/ipc/contracts.ts`（`CodexDisplayPreferences`）
- Modify: `src/shared/ipc/events.ts`（`codex-display-settings-changed`）
- Modify: `src/stores/settings.ts`
- Create: `src/stores/settings.test.ts`
- Modify: `src/modules/codex/types.ts`
- Modify: `src/modules/codex/status.test.ts`
- Modify: `src/modules/codex/useCodexAgent.test.ts`
- Modify: `src/components/island/codex/CodexCompactContent.vue`
- Modify: `src/components/island/codex/CodexTaskDetail.vue`
- Modify: `src/components/island/codex/CodexCompactContent.test.ts`
- Modify: `src/components/island/codex/CodexTaskDetail.test.ts`
- Modify: `src/components/island/IslandView.vue`
- Modify: `src/components/island/IslandView.codex.test.ts`
- Modify: `src/components/dashboard/CodexStatusSettingsCard.vue`
- Modify: `src/components/dashboard/CodexStatusSettingsCard.test.ts`

**消费接口：** 阶段三 `toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)`、同一份 Rust listening command/event。

**产生接口：**

```ts
export interface CodexDisplayPreferences {
  idlePersistent: boolean
  showCommandSummary: boolean
}
```

- [ ] **步骤 1：先写 store 与跨窗口事件失败测试**

  断言 `nsd_codex_idle_persistent` 默认 false、`nsd_codex_show_command_summary` 默认 true；watch 写 localStorage；主窗口变更 emit 完整 payload；Widget 接收后更新 ref；卸载释放 listener。偏好测试 mock 所有 IPC，断言零 inspect/preview/apply/self-check/runtime 调用。

  运行：

  ```powershell
  pnpm run test -- src/stores/settings.test.ts src/components/island/IslandView.codex.test.ts
  ```

  预期：store 字段与事件不存在，测试失败。

- [ ] **步骤 2：先写无任务 phase 联合投影失败测试**

  `status.test.ts` 与 `IslandView.codex.test.ts` 同时覆盖：running+idle false 隐藏；running+true “Codex 已就绪”；awaiting_trust “等待 Codex 信任” warning/no interrupt；partial “Codex 部分可用”；service_error “Codex 服务异常” error；config_conflict “Codex 配置冲突”；not_installed/disabled 始终隐藏。所有 phase 在 idle true/false 下重复测试；有真实任务时任务状态优先。

  运行：

  ```powershell
  pnpm run test -- src/modules/codex/status.test.ts src/modules/codex/useCodexAgent.test.ts src/components/island/IslandView.codex.test.ts
  ```

  预期：任何只看 idlePersistent 的旧投影都会失败。

- [ ] **步骤 3：先写命令摘要偏好失败测试**

  showCommandSummary=false 时 compact/detail 隐藏 operationSummary 但保留阶段与通用“正在执行命令”；true 时显示后端脱敏摘要。切换不修改 snapshot/revision，不 invoke Rust 命令。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex/CodexCompactContent.test.ts src/components/island/codex/CodexTaskDetail.test.ts
  ```

  预期：显示偏好尚未接线，测试失败。

- [ ] **步骤 4：实施最小偏好接线**

  settings store 添加两个 ref/watch/setter；主窗口更新后 emit；Widget 启动读 localStorage 并监听事件。`IslandView` 把 `codexIdlePersistent` ref 传给 useCodexAgent，把 composable 原样提供的 listeningStatus 放入 CodexAgentDisplayState；不得另建 listening phase ref。showCommandSummary 只影响组件文本。

  运行：

  ```powershell
  pnpm run test -- src/stores/settings.test.ts src/modules/codex src/components/island/codex src/components/island/IslandView.codex.test.ts
  pnpm run typecheck
  ```

  预期：偏好、联合投影、跨窗口同步和组件测试通过。

- [ ] **步骤 5：提交显示偏好**

  运行：

  ```powershell
  pnpm run lint
  pnpm run format:check
  rg -n "ensureStarted|ensure_started|startCodex|runCodexSelfCheck" src/stores/settings.ts src/modules/codex src/components/island/IslandView.vue
  git diff --check
  ```

  预期：显示链路没有服务启动或自检调用。

  建议提交信息：

  ```text
  联动 Codex 显示偏好与监听状态
  ```

---

## 任务 4：建立自动化 E2E、PE 与范围门禁

**独立交付物：** TempDir/loopback/ManualClock 全链路可重复验证设计十四项场景、Hooks 禁用、runtime 生命周期、墙钟回拨与 PE 架构，不触碰真实用户配置。

**Files:**

- Modify: `src-tauri/Cargo.toml`（仅 dev-dependency 引用 workspace Bridge）
- Create: `src-tauri/src/codex/e2e_tests.rs`
- Modify: `src-tauri/src/codex/mod.rs`（`#[cfg(test)] mod e2e_tests;`）
- Create: `scripts/verify-codex-status-scope.ps1`

**消费接口：** 四阶段 Rust 接口、ManualClock、fake publisher/process runner、TempDir、loopback；不使用真实 Codex Home。

**产生接口：** 无生产接口；范围脚本作为发布门禁。

- [ ] **步骤 1：先写十四项核心 E2E 失败测试**

  明确测试名覆盖 CLI/App 普通任务、两端并行、读取/编辑/命令/测试、PermissionRequest、测试先失败后成功 Stop、最终失败、完成 5 分钟删除、失败 clear、server 退出无历史补偿、47653 冲突 fallback、用户 Hook 保留、exact 无真实事件 awaiting_trust、新资源修复旧 Bridge。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：全链路 harness 尚未接线，测试失败。

- [ ] **步骤 2：先写新增审查回归失败测试**

  覆盖：editing 事件后墙钟/occurredAt 回拨两小时再收到 running_tests，必须进入 running_tests；较小 occurredAt 的 PermissionRequested 立即 waiting_approval；HooksDisabled preview 无 prepared/Bridge/runtime；手动改 true 重新 inspect 后允许 preview；exact/modified/partial marker 启动，uninstall 停止并删 discovery；idlePersistent 不启动；正常/超时退出；PE 无签名、x64/ARM64 反配、不支持 triple 和旧 target 误复制。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests::review_regressions -- --nocapture
  Pop-Location
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  ```

  预期：审查回归尚未进入 E2E，测试失败。

- [ ] **步骤 3：实现临时目录/内存 harness**

  Bridge 使用库入口，HTTP 用真实 loopback，Actor 用 ManualClock，配置用 TempDir，publisher/installer/runtime 计数可断言。除 loopback 不使用真实网络/进程/Home；每例结束 TempDir 删除，仓库无 discovery/transaction/事件文件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：核心十四项与审查回归全部通过。

- [ ] **步骤 4：实现并运行范围脚本**

  `verify-codex-status-scope.ps1` 必须在以下条件失败：package-lock/yarn.lock；生产 WSL/wsl.exe；授权 allow/deny/open-session/pause/terminate API；Bridge 历史写入/重试/stdout 非 `{}`；IslandView 出现聚合生命周期/Stop classifier；CodePulse 前端或 planner 自动写 Hooks feature；显示偏好调用 runtime；Codex 模块在 paths.rs 外拼接 CodePulse/runtime/bin；验收路径不唯一。

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  ```

  预期：脚本逐项输出通过。

- [ ] **步骤 5：全量自动验收并提交**

  运行：

  ```powershell
  pnpm run test
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  pnpm run build
  pnpm run build:codex-bridge
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  Push-Location src-tauri
  cargo test --workspace
  cargo fmt --all --check
  cargo clippy --workspace --all-targets --all-features -- -D warnings
  Pop-Location
  git diff --check
  git diff --name-only
  ```

  预期：所有自动测试/构建/质量/范围门禁通过；无真实配置、日志正文、事件历史或锁文件污染。

  建议提交信息：

  ```text
  覆盖 Codex 状态岛端到端回归矩阵
  ```

---

## 任务 5：完成 Windows 原生 App 与独立 CLI 真实验收

**独立交付物：** 有日期、版本、来源、客观结果与发布影响的验收记录；状态只允许“通过”“失败”“环境阻塞”。

**Files:**

- Create directory if absent: `docs/superpowers/verifications/`
- Create: `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`

**消费接口：** 发布候选安装包、设置页、真实 Codex App、可在 PowerShell 独立运行的官方 Codex CLI。

**产生接口：** 唯一验收记录，不含 token、完整路径正文、提示词、用户配置或完整命令输出。

- [ ] **步骤 1：记录环境而不修改配置**

  运行：

  ```powershell
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'Codex|ChatGPT' } |
    Select-Object DisplayName,DisplayVersion,InstallLocation
  Get-Command codex -All -ErrorAction SilentlyContinue | Select-Object Source,Version
  codex --version
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:USERPROFILE\.codex\config.toml" -ErrorAction SilentlyContinue
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:USERPROFILE\.codex\hooks.json" -ErrorAction SilentlyContinue
  ```

  预期：记录 App/CLI/配置客观状态；CLI 不可独立调用时标记环境阻塞，不安装替代 CLI。

- [ ] **步骤 2：验证 HooksDisabled 手动启用边界**

  在测试账户临时把本地配置设置为 Hooks disabled 前先备份；打开 CodePulse，确认只显示三步手动引导、安装不可执行、runtime/discovery 未启动。由用户在 Codex 配置或官方 UI 手动启用，再返回点击重新检测；只有此时才能看到安装 preview。验收结束按原字节恢复测试账户配置。

  运行：

  ```powershell
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json"
  ```

  预期：手动启用前返回 False；CodePulse 没有自动改 feature。

- [ ] **步骤 3：用设置页安装并验证真实 Hook 信任**

  在 preview 确认八事件、稳定 Bridge 和警告后 apply；状态先为 awaiting_trust。启动新 Codex App 任务，在官方 UI 信任 CodePulse command Hook 并提交只读请求；第一条真实事件后才变 running，来源包含 App。不得把 token 写入验收文档。

  运行：

  ```powershell
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.exe"
  Get-Content -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json" -Encoding utf8
  ```

  预期：稳定 EXE 存在，发现文件 PID/port/version 有效；文档不记录 token。

- [ ] **步骤 4：验证 App 状态、并行与生命周期**

  两个 App 任务覆盖读取、编辑临时测试仓库、命令、测试、授权、先失败后修复、明确无法完成；记录主/卫星、列表/详情、子任务计数、中间失败、完成 5 分钟、失败 clear、鼠标离开一秒、无授权按钮。10/30 分钟只用 ManualClock 自动证据，不在发布构建暴露调试接口。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex src/components/island/IslandView.codex.test.ts src/modules/island/display.test.ts
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests -- --nocapture
  Pop-Location
  ```

  预期：自动证据通过，人工 App 场景逐项记录。

- [ ] **步骤 5：验证端口、退出、修复和精确卸载**

  占用 47653 后启动 CodePulse，确认 fallback；托盘退出应经过统一 ExitRequested，两秒内 discovery 删除；重启只接新事件。Repair 恢复缺失/旧 Bridge；Uninstall 移除 marker、停止服务/Actor、删除 discovery，再删稳定 EXE/记录；用户其他 Hook 语义不变，删除失败只警告不恢复 Hook。

  运行：

  ```powershell
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 47653)
  $listener.Start()
  try {
    $null = Read-Host '完成动态端口、托盘退出、修复和卸载检查后按 Enter'
  }
  finally {
    $listener.Stop()
  }
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json"
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.exe"
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.install.json"
  ```

  预期：退出/卸载后三项均 False；非 CodePulse Hook 不变。

- [ ] **步骤 6：在独立 CLI 环境重复来源与并行门禁**

  运行：

  ```powershell
  $codex = Get-Command codex -ErrorAction Stop
  & $codex.Source --version
  ```

  预期：只有独立 CLI 命令以 0 退出才继续真实任务/授权/App 并行；不可用则记录环境阻塞并明确完整兼容尚未通过。

- [ ] **步骤 7：写验收结论并完成 04C 门禁**

  运行：

  ```powershell
  pnpm run tauri build
  pnpm run test
  Push-Location src-tauri
  cargo test --workspace
  Pop-Location
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  git diff --check
  git status --short
  ```

  预期：最终构建/自动门禁通过；记录如实区分 App 通过与 CLI 通过/阻塞；验收文件位于唯一新路径。随后停止等待最终 review。

  建议提交信息：

  ```text
  记录 Codex 状态岛 Windows 端到端验收
  ```

## 04C 完成门禁

- UI 测试覆盖七 phase、HooksDisabled 手动三步引导、managed disabled、preview/confirm/cancel。
- idlePersistent 与 showCommandSummary 只控制展示；Widget/设置页使用同一权威 CodexListeningStatus。
- 自动 E2E 覆盖十四项设计场景、occurredAt/墙钟回拨、runtime 启停、HooksDisabled、退出和 PE 架构。
- 范围脚本阻止 WSL、控制 Codex、历史补偿、自动改 Hooks feature、路径分叉和错误验收路径。
- Codex App 真实 Hook 信任通过；独立 CLI 通过或明确记录环境阻塞，不冒充正式兼容通过。
- 全部完成后停止，不自动开展下一版功能。
