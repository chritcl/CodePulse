# 阶段四 C：Codex 设置、显示偏好与端到端验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 04B 命令与生命周期已审核通过后，实现设置卡、手动启用全局 Hooks 的两阶段引导、预览确认、空闲常驻/命令摘要显示偏好，并完成自动化与 Windows 原生 App/CLI 真实验收。

**架构：** `useCodexIntegration` 分别维护静态 inspection 与唯一动态 listeningStatus，只编排 04B inspect/preview/apply/retry/self-check 和权威 listening event；设置卡不读写文件，事务 Conflict 时只显示安全恢复重试；前端偏好只进入 localStorage 与跨窗口事件；Widget 使用阶段三统一投影 `toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)`。自动 E2E 使用 TempDir/loopback/ManualClock 覆盖跨 Runtime revision/generation、Prepared 后 CAS与逐 MoveFileExW前后校验、Integration Transaction 四阶段逐文件恢复、孤立 Journal temp、action-specific invariant、标准 Fixture 统一 AST loader/稳定 Bridge路径绑定投影与 Discovery owner，真实验收单独记录 GUI Bridge 无控制台闪烁。

**技术栈：** Vue 3 Composition API、Pinia/localStorage、Tauri JS API、Vitest、`@vue/test-utils`、Rust TempDir/ManualClock、PowerShell、pnpm 10.33.2。

## 全局约束

- 前置门禁：04B 全部通过并已单独 review。
- 设置页与 Widget 使用同一个 `CodexListeningStatus` 类型、命令和 `codex-listening-status-changed` 权威事件，不复制 phase 派生。
- CodePulse 只能检测和说明 `features.hooks=false`；用户必须在 Codex 配置或官方 UI 手动开启，再返回重新检测。
- “启用全局 Hooks”和“安装 CodePulse Hook”是两个明确确认项，不能合并成一次 apply。
- idlePersistent 只影响 running+无任务的显示，不能 invoke install、repair、ensure_started 或 self-check。
- Inspection 只含静态配置/Bridge 事实，不含 hookState/phase；listening event 不能修改 inspection。
- 只有 `codex_hooks` 时显示固定弃用提示并按 effectiveState 呈现 enabled/disabled 行为；两个 Feature 键冲突或非布尔时显示配置冲突且无安装、修复、卸载按钮，CodePulse 不改写两键。
- 本地 hooks=false 且存在安全 CodePulse marker 时，UI 在手动启用说明之外提供“预览卸载 CodePulse Hook”；不得提供安装、修复或自动启用。
- 真实验收记录只在执行本计划时创建于 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- CLI 环境阻塞必须如实记录并阻止“正式兼容已通过”声明。
- 自动 E2E 的路径对象只读取 `integration_transaction_file`；事务 staging 路径由 transactionId+target filename 推导，不扩张 `CodexIntegrationPaths`。范围脚本断言路径对象不存在第二个含 `transaction` 的字段、startup 只调用 `recover_interrupted_codex_integration_transaction()`，并确认只有 `paths.rs` 拼接 `codex-integration-transaction.json`。
- `IntegrationTransactionConflict`/`OrphanTransactionConflict` 时设置页只提供“重新尝试安全恢复”；不得提供强制覆盖、强制删除事务、忽略并继续，也不得展示Token、完整配置正文、用户命令或完整用户目录。
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

**消费接口：** 04B 四个 integration Tauri commands、阶段二 `getCodexListeningStatus()`/`runCodexSelfCheck()` 与 listening event。

**产生接口：**

```ts
export type CodexHookAction = 'install' | 'repair' | 'uninstall'
export type CodexHooksFeature =
  | 'enabled'
  | 'disabled'
  | 'managed_disabled'
  | 'config_conflict'
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
  listeningStatus: CodexListeningStatus
  selfCheck: CodexSelfCheckResult
}

export type CodexIntegrationRecoveryOutcome =
  | 'no_pending_transaction'
  | 'cleaned_orphan_prepared_temps'
  | 'cleaned_prepared_transaction'
  | 'restored_bridge_applied'
  | 'promoted_structure_committed'
  | 'rolled_back_config_applied'
  | 'cleaned_structure_committed'
  | 'warning'

export interface CodexIntegrationRecoveryResult {
  outcome: CodexIntegrationRecoveryOutcome
  inspection: CodexIntegrationInspection
  listeningStatus: CodexListeningStatus
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
  retryRecovery: () => Promise<void>
  runSelfCheck: () => Promise<CodexSelfCheckResult>
}
```

- [ ] **步骤 1：先写 IPC wrapper 与类型失败测试**

  断言 inspect/preview/apply/retry wrapper 的 snake_case 命令与 camelCase 参数；apply 精确发送 action、expectedDigest、previewDigest；retry 精确调用 `retry_codex_integration_recovery`且无force/ignore参数。完整 static inspection fixture 用 `satisfies` 固定 hooksFeature/markerPresence，包括 `config_conflict`，并断言 JSON 不存在 hookState/phase/serviceState；issues fixture 覆盖旧别名弃用、重复键与值冲突中文提示；apply result fixture 同时包含独立 listeningStatus 与 selfCheck，recovery result fixture包含outcome/inspection/listeningStatus；公开 payload 不含 target bytes、token、完整配置或 Journal正文。

  运行：

  ```powershell
  pnpm run test -- src/shared/ipc/commands.test.ts src/shared/ipc/codexContracts.test.ts
  ```

  预期：integration 类型和 wrapper 不存在，测试/类型编译失败。

- [ ] **步骤 2：先写 composable 异步竞态失败测试**

  覆盖先注册 listening listener 再初始 inspect/getStatus；旧 inspect 不覆盖新请求；requestChange 只保存 preview；confirm 使用当前 preview 摘要且防重复；摘要冲突显示稳定 errorCode 并重新 inspect；cancel 零 apply；dispose 后迟到结果不回写；listening event 只完整替换 listeningStatus，inspection 对象引用/序列化静态事实保持不变；apply 成功分别使用 result.inspection、result.listeningStatus、result.selfCheck，不手工设置 running。

  Recovery竞态固定覆盖：errorCode为`IntegrationTransactionConflict`或`OrphanTransactionConflict`时`retryRecovery()`只调用安全retry wrapper；并发点击由前端busy防重复且后端mutex仍是权威串行门禁；retry返回成功后分别替换result.inspection/result.listeningStatus并清除errorCode；NoPendingTransaction显示稳定无待恢复结果；retry仍Conflict时保留errorCode、preview和静态对象，不伪造成功、不调用apply/install/self-check；scope dispose后迟到retry结果不回写。前端没有强制覆盖/丢弃/忽略摘要wrapper。

  固定动态切换用例：inspection=exact → listeningStatus=awaiting_trust → 收到真实事件对应的 listening event=running → 设置页立即显示正常运行，且 inspect wrapper 调用次数不增加。composable 不比较两个 phase，因为 inspection 根本没有 phase。

  运行：

  ```powershell
  pnpm run test -- src/composables/useCodexIntegration.test.ts
  ```

  预期：composable 不存在，测试失败。

- [ ] **步骤 3：实现最小 IPC 与 generation 隔离**

  所有类型从 shared ipc 单一导出；composable 用前端 requestGeneration/disposed 防旧请求，scope dispose 清 listener；requestGeneration 不得和后端 runtimeGeneration 混用。inspection/listeningStatus 使用两个独立 Ref；listening event 不写 inspection。HooksDisabled/ManagedDisabled/ConfigConflict（包括 Feature alias conflict）只转换为稳定 errorCode，不触发其他命令。`IntegrationTransactionConflict`/`OrphanTransactionConflict`只开放`retryRecovery()`；该方法调用后端安全恢复命令，不转成新apply、不带force参数。正常运行只来自 listeningStatus.phase=running。

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

  覆盖 running/awaiting_trust/partial/service_error/config_conflict/not_installed/disabled 中文状态、最近事件、来源、自检。动态文案只读 listeningStatus；按钮只读静态 inspection。managedEntry=absent+enabled 显示“预览安装”；managedEntry=modified/duplicate 或 bridgeState 非 current 显示“预览修复”；安全 marker 已安装显示“预览卸载”；所有动作先 preview 后 confirm/cancel。awaiting_trust 不误报 running。listening event 从 awaiting_trust 变 running 时不重新 inspect，inspection 对象保持不变。

  当`listeningStatus.errorCode`为`IntegrationTransactionConflict`或`OrphanTransactionConflict`时，固定显示：“检测到上次 Codex 集成修改未能安全完成。CodePulse 已停止监听，未覆盖当前文件。请检查提示的配置或备份后重新尝试恢复。”并提供唯一事务操作“重新尝试安全恢复”；可同时显示“重启 CodePulse 也会执行相同的安全恢复检查。”测试断言不存在“强制覆盖”“强制删除事务”“忽略并继续”按钮或可触发入口，且页面不展示Token、完整配置正文、用户命令或完整用户目录。点击安全重试只调用`retryRecovery()`。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts
  ```

  预期：设置卡不存在，测试失败。

- [ ] **步骤 2：先写 HooksDisabled 手动引导失败测试**

  hooksFeature=disabled 且 marker absent 时固定展示：第一步“在 Codex 配置中手动启用 Hooks”与 featureConfigPath；第二步“返回 CodePulse，重新检测环境”；第三步“预览并安装 CodePulse Hook”。安装按钮不可执行，点击/键盘都不调用 preview/apply，不写 Bridge、不启动 HTTP。重新 inspect 得到 enabled 后才出现安装 preview 按钮。不得提供“由 CodePulse 开启”按钮。

  hooksFeature=disabled 且 markerPresence=present、representation 可安全解析、managedEntry=exact/modified/duplicate 时，同时显示“全局 Hooks 当前已关闭”“CodePulse Hook 仍存在”和“预览卸载 CodePulse Hook”。不得显示安装/修复/自动启用；点击卸载只调用 requestChange('uninstall')，确认后不启动 Runtime、不安装 Bridge。marker absent 时不显示卸载；ambiguous/conflict 时只显示冲突说明。

  managed_disabled 时显示“由组织策略管理”，不显示修改企业文件、安装、修复或卸载按钮；config_conflict 只显示检测结果和安全说明。

  增加 Feature alias UI 矩阵：只有 `codex_hooks=true` 时显示“检测到旧版 codex_hooks 配置，请在 Codex 中改用 hooks。”并继续显示 enabled 对应安装/修复/卸载行为；只有 `codex_hooks=false` 时显示同一弃用提示并走 disabled 手动引导/安全卸载行为；两个键同值时除弃用提示外显示 Duplicate warning但按共同值工作；两个键冲突或任一非布尔时显示“Codex 配置冲突”，明确要求用户手动删除旧别名或统一两个值，安装/修复/卸载按钮全部不存在，点击与键盘均不能触发 preview/apply。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts
  ```

  预期：若旧交互会在 install 中修改 feature flag，测试失败。

- [ ] **步骤 3：先写预览确认与无障碍失败测试**

  预览区逐项显示 changes/warnings/bridgeAction，确认/取消分别只调用一次；busy 禁重复；error 使用 aria-live；按钮有 type/可访问名称；HooksDisabled 不产生空 preview 弹窗；Conflict安全重试busy时禁重复、retry仍Conflict时文案/按钮保持、成功后按新inspection/listeningStatus重新渲染；settings panel 在 grid 末尾渲染全宽卡且现有设置测试不变。

  运行：

  ```powershell
  pnpm run test -- src/components/dashboard/CodexStatusSettingsCard.test.ts src/components/dashboard/IslandSettingsPanel.test.ts
  ```

  预期：交互和布局测试失败。

- [ ] **步骤 4：实现设置卡**

  卡片只调用 composable；不读写文件、不调用 runtime manager。动态状态文案只看 listeningStatus，action 可见性只看 inspection 静态事实；不得比较两个 phase。`featureConfigPath` 只展示，复制功能若实现也只复制路径。alias 提示只消费 inspection.issues，不从配置正文重新解析；普通config_conflict时统一隐藏三种action。事务/孤立Journal Conflict额外只显示固定安全说明与`retryRecovery()`按钮，不新增force/discard/ignore命令。local disabled+safe marker 的卸载仍走 preview/confirm；样式保留在 scoped CSS，不重构控制台布局。两个确认项在视觉和交互上分区，用户手动操作后必须点击“重新检测环境”。

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

**独立交付物：** TempDir/loopback/ManualClock 全链路可重复验证设计十四项场景、Feature alias/disabled action matrix、跨 Runtime revision/generation、Integration Transaction ID-first/四阶段逐文件恢复、action-specific invariant、标准 Fixture AST 语义、Discovery owner 竞态、墙钟回拨与完整 PE metadata，不触碰真实用户配置。

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

- [ ] **步骤 2：先写生命周期、事务与 Owner 审查回归失败测试**

  覆盖：editing 事件后墙钟/occurredAt 回拨两小时再收到 running_tests，必须进入 running_tests；较小 occurredAt 的 PermissionRequested 立即 waiting_approval；未安装 Hook/Runtime dormant 时 get snapshot 成功且 tasks=[]、不产生 service_error；HooksDisabled install/repair 无 prepared/Bridge/runtime，safe marker uninstall 允许且不启动 Runtime；只有旧 alias 按有效值工作并带弃用 Issue；双键同值带 Duplicate warning；双键冲突/非布尔使三动作 ConfigConflict、Runtime RemainStopped且无 Prepared/Journal；手动消除冲突重新 inspect 后才恢复动作；exact/modified/safe marker 启动；idlePersistent 不启动。

  固定 Runtime 重启序列共用同一个进程级 `CodexSnapshotStore`：安装并运行任务至 revision=20、后端 `runtime_generation=1`/`authenticated_generation=1`/running → 卸载 → stop 发布 revision=21 空快照、UI 清旧任务、not_installed → 重新安装 `runtime_generation=2`/`authenticated_generation=None`/awaiting_trust → generation=1 晚到事件忽略 → 第一条 generation=2 真实事件后 running且任务 revision>21。断言新事件不被旧 revision 拒绝，第一条真实新 Hook 前不直接 running。

  Integration Transaction E2E 至少逐项覆盖：

  - 调用顺序：transactionId 在 `prepare_config_apply`/`prepare_bridge_install` 前分配；两个 prepare 收到同一 ID，且 Prepared Journal 原子持久化前稳定配置/Bridge/记录无变化、无 staging；
  - Prepared后pre-apply CAS：Prepared已持久化 → 用户修改Config → staging创建前由`verify_artifact_matches_expected_original()`发现变化 → Config/Bridge/Record都不写、不创建新staging；另一个进程在expectedDigest检查后、Prepared写入后修改任一目标也不能被覆盖；
  - backup与all-staging-ready：每个existedBefore目标的当前摘要先等于originalDigest，再create_new/write/flush/close/重读backup并再次等于originalDigest；existedBefore=false要求backup=None且目标仍缺失；backup摘要错误、任一temp targetDigest错误或当前Prepared Journal transactionId不符时零目标替换；
  - 每次MoveFileExW前后：所有backup后用户改Bridge → Bridge替换前拒绝覆盖；Bridge已替换后用户改Record → 不覆盖Record且Repair恢复旧Bridge；Bridge/Record已替换后用户改Config → 不覆盖Config且回滚两者；MoveFileExW返回成功但写后targetDigest不符 → 不继续下一文件并进入安全恢复；
  - Prepared Journal 写入前崩溃：目标不变且无不可追踪 staging；Prepared 写入后只创建一部分 backup/temp时崩溃：只清理 Journal 列出的本 transactionId 文件，另一个 ID 的 temp/backup 同时存在也不得删除；
  - 孤立Journal temp：无稳定Journal+一个或两个合法Prepared-only temp → 全部删除；文件名/内容ID不符、stage=BridgeApplied、目标已改变或存在同ID Bridge staging/backup → 保留并`OrphanTransactionConflict`、Runtime不启动；稳定Journal ID=A+ID=B Journal temp或普通目标staging → 只处理A，B只诊断不删除；测试显式保持单实例前提；
  - BridgeApplied 混合恢复：Bridge=Target/Record=Original 只恢复 Bridge；Bridge=Original/Record=Target 只恢复 Record；首次 Install Bridge=Target/Record=ExpectedAbsent 删除新 Bridge，最终两者均不存在；
  - ConfigApplied 混合恢复：Config=Target、Bridge=Target、Record=Original 时先回滚 Config，再逐文件恢复 Bridge/记录；反向混合同理；不得把部分结构提升为 StructureCommitted；
  - ConfigApplied 完整目标：Install/Repair 只有 Marker=Exact、Bridge/记录=Target且 PE/hash/piped valid 才返回 InstalledOrRepaired 并提升 StructureCommitted；invariant失败且三者未外改则先配置后逐文件回滚；
  - action-aware rollback：Repair 前 Hook 一直引用稳定路径时仍恢复旧 EXE/旧记录且不返回引用冲突；Install 前 Bridge 不存在但配置仍引用稳定路径时禁止删除新 EXE；
  - Uninstall 部分删除：Marker=Absent且无引用时，Bridge absent+Record present继续删除记录，Bridge present+Record absent继续删除 Bridge；只有两者 absent才返回 Uninstalled/StructureCommitted，Marker absent但 Bridge仍存在不得提交；
  - StructureCommitted 清理恢复：只清理 backup/temp/Journal，不回滚正确结构；
  - ConfigApplied 后用户并发修改配置或 Bridge：Bridge=ExternalModification+Record=Target 返回 Conflict，不覆盖用户字节、不删除仍被引用 Bridge并保留诊断；
  - 每个故障注入点后读取 Hook 与稳定 Bridge，断言永远不出现 Hook 指向缺失 Bridge；
  - StructureCommitted 后 self-check 超时/失败：Hook/Bridge 保留、phase partial/service_error；cleanup 失败仅 warning；首次 install验证失败停止临时 Runtime/发布空快照/删 own discovery；Repair失败保持原合法 Runtime/任务。

  Conflict安全重试E2E固定覆盖：文件未处理时retry仍Conflict且字节不变；用户手工恢复Config为Original后retry完成回滚并清理Journal；三者恢复为Target且invariant通过时retry提升StructureCommitted；并发点击由operation mutex只执行一次状态机；无Journal/孤立temp返回NoPendingTransaction；成功后重新Inspection并发布ListeningStatus。UI只显示“重新尝试安全恢复”，不显示强制覆盖/丢弃/忽略入口。

  标准 Fixture E2E：分别用 `C:\Users\Test User\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe`、`C:\Users\测试用户\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe` 和含单引号的 `C:\Users\O'Connor\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe` 稳定 Bridge 路径，从空 JSON/TOML 配置执行实际 Install，再读取实际安装结果。JSON 解析为 `serde_json::Value`，TOML 解析为 `toml_edit::DocumentMut`；调用 04A 同一 `normalize_codepulse_hook_commands_for_exact(..., paths.installed_bridge.as_path())`，只提取CodePulse-owned groups并在AST command value中反向规范化具体路径，再与`codepulse-hooks-exact.json`/`.toml`母版AST比较。分别断言JSON/TOML可解析、command语义正确、JSON serializer正确处理反斜杠、TOML单引号不破坏文档、无placeholder残留。Repair modified后重复相同比较；用户已有独立matcher group不进入projection且CodePulse仍Exact；用户handler与CodePulse handler混合同group时为Modified，Repair后用户Handler规范AST深度相等且CodePulse group独立。wrong-path EXE+marker、旧Bridge路径、基础/Windows command任一个错误或缺失、附加`--extra`均不得变成Exact。禁止`actual_text.replace(actual_path, ...)`，测试不得内嵌第二套八事件期望或第二个loader。

  `DiscoveryOwner` 竞态：Runtime A 写 owner A，Runtime B 原子替换 owner B，A 的 stop/drop/RunEvent::Exit 调用 `remove_discovery_if_owned()` 返回 `ReplacedByNewRuntime` 且不删除 B；相同 PID不同 token、损坏文件均不盲删。PE 覆盖无签名、x64/ARM64 反配、Optional Header 太短、非法 Magic、Console/未知 Subsystem、不支持 triple 和旧 target误复制；x64/ARM64+WindowsGui 通过。正常/超时退出仍只启动一次 shutdown。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests::review_regressions -- --nocapture
  Pop-Location
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  ```

  预期：审查回归尚未进入 E2E，测试失败。

- [ ] **步骤 3：实现临时目录/内存 harness**

  Bridge 使用库入口和真实 `std::process::Command` piped 进程，HTTP 用真实 loopback，Actor 用 ManualClock，SnapshotStore 由 Manager fixture 只构造一次并跨两个 fake Runtime 共用，配置用 TempDir，publisher/installer/runtime generation/owner/Integration Journal/operation mutex调用序列可断言。文件系统harness必须能在Prepared后staging前、每个backup后、每个MoveFileExW前后注入外改，并验证originalDigest/targetDigest。Fixture注入、目标序列化与Exact反向规范化全部调用04A同一AST loader并传入`paths.installed_bridge`，不复制内容、不做原始文本replace。除loopback不使用真实网络/Home；每例结束TempDir删除，仓库无discovery/Integration Journal/事件文件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：核心十四项与审查回归全部通过。

- [ ] **步骤 4：实现并运行范围脚本**

  `verify-codex-status-scope.ps1` 必须在以下条件失败：package-lock/yarn.lock；生产 WSL/wsl.exe；授权 allow/deny/open-session/pause/terminate API；Bridge 缺少 `windows_subsystem = "windows"`、历史写入/重试/stdout 非 `{}`；PE 校验缺 Machine 或 WindowsGui Subsystem；IslandView 出现聚合生命周期/Stop classifier；Inspection DTO 出现动态 hookState/phase；CodePulse 前端或 planner 自动写 Hooks feature/删除 `codex_hooks`；显示偏好调用 runtime；Codex 模块在 paths.rs 外拼接 CodePulse/runtime/bin或 `codex-integration-transaction.json`；`CodexIntegrationPaths` 出现第二个含 `transaction` 的字段，或 startup 调用的恢复接口不是 `recover_interrupted_codex_integration_transaction()`；transactionId 在 transaction prepare 后分配、Prepared 前创建目标 staging、Prepared后staging前缺`verify_artifact_matches_expected_original`三文件CAS、backup未按originalDigest重读验证、缺all-staging-ready、每个MoveFileExW前缺CAS或写后缺targetDigest验证、temp/backup不能由Journal/transactionId归属；稳定Journal不存在时扫描范围宽于精确`.<journal-filename>.codepulse-<32hex>.tmp`，或异常孤立temp被删除；Manager 构造不显式接收 Store或 setup 另 manage第二份 Store；标准 Fixture 缺任一事件/command Windows override/timeout=2，或出现 matcher/statusMessage/async；`normalize_codepulse_hook_commands_for_exact`未显式接收expected_bridge_path/expected command，CodePulse projection包含用户独立Hook，Fixture loader/Exact/E2E对raw JSON/TOML调用path/placeholder replace，JSON未经serde_json AST、TOML未经toml_edit AST，Inspection/Planner/Repair/E2E存在第二套loader或手写八事件模板；StructureCommitted仍一律要求Marker Exact，或Uninstall未要求Marker Absent+无引用+Bridge/记录 absent；Conflict UI缺安全retry或存在force overwrite/discard/ignore入口；Discovery存在无owner删除；验收路径不唯一。

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

  在测试账户临时把本地配置设置为 Hooks disabled 前先备份；marker absent 时打开 CodePulse，确认只显示三步手动引导、安装不可执行、runtime/discovery 未启动。再准备一个含安全 CodePulse marker 的 disabled 状态，确认同时显示“全局 Hooks 当前已关闭”“CodePulse Hook 仍存在”和“预览卸载 CodePulse Hook”，且没有安装/修复按钮；确认卸载后不启动 Runtime、不安装 Bridge、其他 Hook 不变。由用户在 Codex 配置或官方 UI 手动启用，再返回点击重新检测；只有此时才能看到安装/修复 preview。验收结束按原字节恢复测试账户配置。

  运行：

  ```powershell
  Test-Path -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json"
  ```

  预期：手动启用前返回 False；CodePulse 没有自动改 feature。

- [ ] **步骤 3：用设置页安装并验证真实 Hook 信任**

  在 preview 确认八事件、稳定 Bridge 和警告后 apply；立即读取实际安装结果，按表示方式解析成 JSON/TOML AST，调用 04A 同一 `normalize_codepulse_hook_commands_for_exact(..., paths.installed_bridge.as_path())`只提取并规范化CodePulse-owned projection，再确认matcher组与对应标准Fixture AST语义相等且用户其他独立Handler深度相等。禁止在真实配置原始文本上替换Bridge路径，也不能把wrong-path/extra-arg handler规范化成Exact。状态先为awaiting_trust。启动新Codex App任务，在官方UI信任CodePulse command Hook并提交只读请求；第一条属于当前Runtime generation的真实事件后才变running，来源包含App。不得把token或generation诊断细节写入验收文档。

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

- [ ] **步骤 5：验证 GUI 无闪烁、端口、重装 revision/generation 与精确卸载**

  先让 Codex App 连续触发多个 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse Hook，观察全程无可见黑色控制台窗口或任务栏闪烁；同时确认每个 Hook 行为正常、Bridge stdout 管道仍精确 `{}`、stderr 空、exit 0。把“GUI Subsystem 无控制台闪烁”作为独立验收项记录，不能只用 PE 自动测试代替人工观察。

  占用 47653 后启动 CodePulse，确认 fallback；托盘退出应经过统一 ExitRequested，两秒内 owner-aware 删除自己的 discovery，旧 Runtime 清理不能删除重启后新 discovery；重启只接新事件。Repair 恢复缺失/旧 Bridge。用测试账户制造可逆的事务Conflict，确认设置页只显示固定安全说明与“重新尝试安全恢复”，无强制覆盖/丢弃/忽略；未处理时重试仍Conflict且字节不变，手工恢复到Journal已知Original/Target后重试可完成并清Journal。执行“安装并运行任务 → 记录当前 revision → Uninstall → 观察更高 revision 空快照清旧任务/not_installed → 重新 Install → 第一条真实新 Hook 前 awaiting_trust → 新 Hook 后任务正常显示且 revision 继续递增”，确认旧 generation 认证未沿用。用户其他 Hook 语义不变，删除失败只警告不恢复 Hook。

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
  @(Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime" -Filter '*transaction*.json' -File).Count
  ```

  预期：前三项均为 False、事务文件计数为 0；退出/卸载后 discovery、Bridge、安装记录和 Integration Journal 均不存在，非 CodePulse Hook 不变。脚本不拼接 Journal 文件名。

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
- UI/composable 把静态 inspection 与动态 listeningStatus 分开维护；listening event 可立即 awaiting_trust→running且不重新 inspect。
- 只有 `codex_hooks` 时显示固定弃用提示并按有效值工作；双键同值显示重复 warning；双键冲突或非布尔时显示配置冲突且不渲染 install/repair/uninstall 按钮。
- local disabled+marker present 同时显示手动启用说明与安全卸载入口；install/repair/自动启用不可用，managed disabled 全只读。
- idlePersistent 与 showCommandSummary 只控制展示；Widget/设置页使用同一权威 CodexListeningStatus。
- 自动 E2E 覆盖十四项设计场景、occurredAt/墙钟回拨、dormant 空快照、跨 Runtime revision/generation、disabled uninstall、transactionId 先分配/Prepared 前零 staging、Prepared 部分 staging ownership、Bridge/记录混合状态逐文件恢复、Install/Repair/Uninstall action-specific invariant、Discovery owner 竞态、退出和 PE Machine+WindowsGui。
- 自动E2E还覆盖Prepared后pre-apply CAS、backup originalDigest完整性、all-staging-ready、每个MoveFileExW前后校验、写后targetDigest失败停止、精确孤立Journal temp清理/Conflict、operation mutex安全retry与NoPendingTransaction；expectedDigest检查后的外改不能被覆盖。
- JSON/TOML 实际 Install 与 Repair 结果用04A同一AST loader并显式传入`paths.installed_bridge`，提取CodePulse-owned projection后分别语义等于唯一标准Fixture；空格、中文、单引号路径可解析且命令语义正确，JSON反斜杠/TOML单引号由serializer安全处理。wrong-path/旧路径/双command不一致/extra参数不可能Exact；用户独立Handler不进入projection且前后深度相等，混合group Repair后用户Handler保留、CodePulse group独立；E2E不做原始文本replace，不内嵌第二套loader或八事件模板。
- UI/composable对`IntegrationTransactionConflict`/`OrphanTransactionConflict`只提供安全重试；重试不改Feature键、不采用外部字节为Original、不忽略摘要。没有强制覆盖、强制删除事务或忽略并继续功能。
- 范围脚本阻止 WSL、控制 Codex、历史补偿、自动改 Hooks feature、路径分叉和错误验收路径。
- Codex App 真实 Hook 信任与卸载重装通过；多 Hook 全程无可见控制台闪烁且管道协议正常；独立 CLI 通过或明确记录环境阻塞，不冒充正式兼容通过。
- 全部完成后停止，不自动开展下一版功能。
