# 阶段四 C：Codex 设置、显示偏好与端到端验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在04B-3命令与生命周期已审核通过后，实现设置卡、外部全局Hooks前置条件说明、独立安装/卸载预览确认、空闲常驻/命令摘要显示偏好，并分别完成A自动行为矩阵、B Codex App真实验收和C独立CLI真实验收。

**架构：** `useCodexIntegration` 分别维护静态 inspection 与唯一动态 listeningStatus，只编排04B-3 inspect/preview/apply/retry/self-check和权威listening event；设置卡不读写文件，事务Conflict时只显示安全恢复重试；前端偏好只进入localStorage与跨窗口事件；Widget使用阶段三统一投影`toAgentModuleSnapshot(snapshot, listeningStatus, idlePersistent)`。A自动行为矩阵使用TempDir/loopback/ManualClock覆盖跨Runtime revision/generation、eventId第一层、稳定事件第二层逻辑键、Session/Permission幂等公开行为、事务/恢复/Lease/cleanup等内部不变量，但不证明真实Codex兼容。B App真实验收单独验证官方信任、真实Hook、App来源、GUI无闪烁、多会话和安装/修复/卸载；C独立CLI真实验收必须在PowerShell可独立调用的官方CLI环境完成版本、真实任务、真实Hook、来源、App并行、授权及完成/失败场景。

**技术栈：** Vue 3 Composition API、Pinia/localStorage、Tauri JS API、Vitest、`@vue/test-utils`、Rust TempDir/ManualClock、PowerShell、pnpm 10.33.2。

## 全局约束

- 前置门禁：04B-1、04B-2、04B-3均已分别审核通过，尤其04B-3已经完成公开commands与Runtime编排；不得把04B内部任一未审部分带入04C。
- 本计划服从设计→Roadmap→详细计划的规范层级，不改变公共接口、四正式事务阶段、SnapshotStore或Integration Journal。
- CodePulse只安装、修复和卸载用户层`%USERPROFILE%\.codex`中的CodePulse Hook；不修改仓库层`.codex`、插件Hook或企业托管配置，不扫描全部仓库。UI只显示用户层管理事实，不显示无法证明的“全局唯一Hook”或`DuplicateCodePulseHookAcrossLayers`状态。
- 设置页与 Widget 使用同一个 `CodexListeningStatus` 类型、命令和 `codex-listening-status-changed` 权威事件，不复制 phase 派生。
- CodePulse 只能检测和说明 `features.hooks=false`；用户必须在 Codex 配置或官方 UI 手动开启，再返回重新检测。
- “全局Hooks是否启用”是Codex外部配置前置条件，只能由用户在Codex配置或官方UI中手动修改；它不是CodePulse布尔开关，也不进入apply。“安装CodePulse Hook”和卸载分别是独立的preview/confirm动作。
- idlePersistent 只影响 running+无任务的显示，不能 invoke install、repair、ensure_started 或 self-check。
- Inspection 只含静态配置/Bridge 事实，不含 hookState/phase；listening event 不能修改 inspection。
- 只有 `codex_hooks` 时显示固定弃用提示并按 effectiveState 呈现 enabled/disabled 行为；两个 Feature 键冲突或非布尔时显示配置冲突且无安装、修复、卸载按钮，CodePulse 不改写两键。
- 本地 hooks=false 且存在安全 CodePulse marker 时，UI 在手动启用说明之外提供“预览卸载 CodePulse Hook”；不得提供安装、修复或自动启用。
- 真实验收记录只在执行本计划时创建于 `docs/superpowers/verifications/2026-07-16-codex-status-island-e2e.md`。
- CLI环境阻塞必须如实记录为“环境阻塞”。此时文档与实现可以完成、App门禁可以单独通过，但阻止“Windows原生CLI与App完整正式兼容已通过”声明。
- A自动行为矩阵的路径对象只读取`integration_transaction_file`；事务staging路径由transactionId+target filename推导，不扩张`CodexIntegrationPaths`。范围脚本断言路径对象不存在第二个含`transaction`的字段、startup只调用`recover_interrupted_codex_integration_transaction()`，并确认只有`paths.rs`拼接`codex-integration-transaction.json`。
- 同一 Integration Journal 必须包含Config/Bridge/Record适用的target temp、prepared backup、replaced snapshot、conflict-preserved-current与removed tombstone路径；所有路径都由transactionId+target filename确定性推导。optimistic precondition check只负责重读分类，不能称为原子CAS；Existing、Absent、Removal必须调用04B统一的三个原子语义接口，writer/installer不得分叉实现。
- 四个且仅四个Journal阶段保持`Prepared → BridgeApplied → ConfigApplied → StructureCommitted`；`all-staging-ready`只是在内存中的屏障，ListeningStatus、revision与generation均不是事务phase。普通事务Lease全部保持到StructureCommitted；之后释放并为普通artifact新取得cleanup Handle，cleanup Warning与Conflict分开呈现。
- 普通`StableArtifactLease`只存在于04B进程内事务句柄，不进入IPC、UI、Journal或SnapshotStore；04C只验证其外部行为与公开Conflict，不建立第二套前端状态。StructureCommitted后先释放普通事务Lease，再新开`GENERIC_READ | DELETE`、仅`FILE_SHARE_READ`的cleanup Handle，并使用新取得的同一 cleanup Handle 完成身份校验、摘要校验和删除标记；禁止给原Lease增加`DELETE`或按路径删除。
- 2026-07-17重新核对Microsoft官方[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[GetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)、[CreateFileMappingW](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-createfilemappingw)、[MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile)、[DeleteFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew)与[Closing and Deleting Files](https://learn.microsoft.com/en-us/windows/win32/fileio/closing-and-deleting-files)；A矩阵按“仅FILE_SHARE_READ排斥writer/writable mapping/delete access、volume serial+128位file ID、ReplaceFileW实际snapshot、no-replace move、新cleanup Handle持有DELETE并在该Handle上FileDispositionInfo删除”验收。不同占用场景的生产断言统一为`SharingViolation`/`ActiveArtifactHandleConflict`，UI只显示“目标文件正在被其他程序占用，请关闭相关程序后重新尝试安全恢复。”，不诊断具体来源。
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

**消费接口：** 04B-3四个integration Tauri commands、阶段二`getCodexListeningStatus()`/`runCodexSelfCheck()`与listening event。

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

## 任务4（A）：建立自动行为矩阵、PE与范围门禁

**独立交付物：** TempDir/loopback/ManualClock可重复验证十四项设计场景对应的协议、聚合状态、优先级、生命周期、文件事务、恢复、generation/revision、端口fallback、用户Hook保留、等待信任、Bridge更新与卸载等内部行为和不变量，不触碰真实用户配置。该矩阵不能证明真实Codex App/CLI的信任、触发或正式兼容。

**Files:**

- Modify: `src-tauri/Cargo.toml`（仅 dev-dependency 引用 workspace Bridge）
- Create: `src-tauri/src/codex/e2e_tests.rs`
- Modify: `src-tauri/src/codex/mod.rs`（`#[cfg(test)] mod e2e_tests;`）
- Create: `scripts/verify-codex-status-scope.ps1`

**消费接口：** 四阶段 Rust 接口、ManualClock、fake publisher/process runner、TempDir、loopback；不使用真实 Codex Home。

**产生接口：** 无生产接口；范围脚本作为发布门禁。

- [ ] **步骤1：先写十四项设计场景自动行为失败测试**

  明确测试名覆盖模拟CLI/App来源的普通任务、两端并行、读取/编辑/命令/测试、PermissionRequest等待授权与重复提醒抑制、退出等待后再次提醒、测试先失败后成功Stop、最终失败、完成5分钟删除、失败clear、server退出无历史补偿、47653冲突fallback、用户Hook保留、exact无当前generation事件时awaiting_trust、新资源修复旧Bridge。这里的模拟来源只证明内部行为，不作为B/C真实环境证据。

  增加跨配置层事件级去重代表用例：两个模拟活动Hook文件对ToolStarted/ToolFinished使用相同`sessionId + turnId + eventType + toolUseId`但不同随机`eventId`，只处理一次；改变toolUseId时不得误合并。SubagentStarted/SubagentFinished同理使用agentId并验证计数只变化一次/不同agentId独立。TurnStarted/TurnStopped按sessionId+turnId+eventType精确处理。重复SessionStarted使用不同eventId时只幂等刷新不敏感元数据，不创建任务、attention、提醒或计数。PermissionRequested不进入第二层逻辑键缓存：同一session/turn已waiting时不产生第二次attention或强提醒，稳定工具事件或新轮次/Stop退出后新的Permission可以再次提醒；缺turnId时只更新安全session元数据且不改变任务。填满并越过缓存容量，断言eventId缓存与仅含Tool/Subagent/Turn键的逻辑缓存都有界且只由单线程Actor维护。逻辑键与Debug不得包含prompt正文、cwd、路径、命令、tool input/output、授权说明、用户内容摘要或occurredAt；Bridge和Vue均无第二层缓存或构键代码。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：全链路 harness 尚未接线，测试失败。

- [ ] **步骤 2：先写生命周期、事务与 Owner 审查回归失败测试**

  覆盖：editing 事件后墙钟/occurredAt 回拨两小时再收到 running_tests，必须进入 running_tests；较小 occurredAt 的 PermissionRequested 立即 waiting_approval，但occurredAt不得进入逻辑键或提醒去重判断；未安装 Hook/Runtime dormant 时 get snapshot 成功且 tasks=[]、不产生 service_error；HooksDisabled install/repair 无 prepared/Bridge/runtime，safe marker uninstall 允许且不启动 Runtime；只有旧 alias 按有效值工作并带弃用 Issue；双键同值带 Duplicate warning；双键冲突/非布尔使三动作 ConfigConflict、Runtime RemainStopped且无 Prepared/Journal；手动消除冲突重新 inspect 后才恢复动作；exact/modified/safe marker 启动；idlePersistent 不启动。

  固定Runtime重启序列共用同一个进程级`CodexSnapshotStore`：模拟安装并运行任务至revision=20、后端`runtime_generation=1`/`authenticated_generation=1`/running→卸载→stop发布revision=21空快照、UI清旧任务、not_installed→重新安装`runtime_generation=2`/`authenticated_generation=None`/awaiting_trust→generation=1晚到事件忽略→第一条generation=2已认证模拟事件后running且任务revision>21。该用例只证明内部generation不变量；第一条真实Hook由B/C验收，不得由本用例替代。

  Integration Transaction公开行为只采用以下顺序：静态检查→展示预览→用户确认→分配transactionId→pure prepare Config/Bridge/Record且零稳定目标副作用→持久化Prepared→三目标optimistic precondition check→创建并验证prepared backup、target temp与removal staging→all-staging-ready→Bridge/Record原子操作→BridgeApplied→必要临时Runtime→Config原子操作→ConfigApplied→action-specific invariant→StructureCommitted→释放普通事务Lease→为普通产物新取cleanup Handle并清理→发布awaiting_trust/partial/not_installed/service_error→本地self-check→等待self-check完成后当前generation第一条新真实认证Hook→running。某action不涉及的资源以已满足/无需变更推进相应阶段，不得调换顺序或新增phase。

  Integration Transaction自动行为矩阵至少逐项覆盖：

  - 调用顺序：静态inspection→preview→用户confirm后才分配transactionId；cancel/关闭确认框/确认前失败时transactionId、prepare、Journal、staging调用均为零。确认后transactionId在`prepare_config_apply`/`prepare_bridge_install`前分配，两个pure prepare收到同一ID，只计算Config/Bridge/Record内存材料且Prepared Journal原子持久化前稳定目标无变化、无正式staging；
  - Optimistic precondition check：Prepared已持久化 → 用户修改Config → staging创建前由`verify_artifact_matches_expected_original()`发现变化 → Config/Bridge/Record都不写、不创建新staging；另一个进程在expectedDigest检查后、Prepared写入后修改任一目标也不能被覆盖；该测试只证明早期发现，不作为原子替换证明；
  - Prepared backup与all-staging-ready：precondition全部通过后，每个existedBefore目标的当前摘要先等于originalDigest，再create_new/write/flush/close/取得prepared backup普通Lease并通过Handle再次等于originalDigest；该Lease保持到StructureCommitted。existedBefore=false要求prepared backup=None且目标仍缺失；target temp用短生命周期staging verification Handle验证后关闭以允许rename，不冒充结果普通Lease；removal destination验证缺失、同卷与transactionId归属。任一摘要/身份错误、capture路径意外存在或当前Prepared Journal ID不符时零目标操作，且不新增AllStagingReady phase；
  - Stable Lease打开与身份：精确断言DesiredAccess=`GENERIC_READ | FILE_READ_ATTRIBUTES`、ShareMode=`FILE_SHARE_READ`、CreationDisposition=`OPEN_EXISTING`，没有`FILE_SHARE_WRITE | FILE_SHARE_DELETE`；同一Handle取得volume serial、128位file ID、size，关键摘要只经`hash_artifact_through_lease()`，`std::fs::read`不得用于snapshot或tombstone；
  - Existing正常替换：最后一次检查通过→`ReplaceFileW`成功→取得target Lease→取得snapshot Lease→两个file ID不同→Handle snapshot=originalDigest且Handle target=targetDigest→允许继续；snapshot创建、任一Lease、Handle摘要或IdentityChanged失败都停止下一文件并保留可恢复artifact；
  - Existing活动写句柄：外部以`GENERIC_WRITE`和兼容share打开原目标→ReplaceFileW成功→旧Handle继续指向snapshot并写入→snapshot Lease取得失败→不读取不稳定摘要、不清snapshot、Conflict；外部关闭Handle后retry取得Lease并用最终snapshot digest按late modification处理；
  - Writable mapping：原目标存在`PAGE_READWRITE`/`FILE_MAP_WRITE`映射→ReplaceFileW成功或sharing failure均可→不得清映射对应capture；Lease失败立即Conflict，映射释放后retry；
  - 统一生产错误：活动writer、writable mapping、delete/rename Handle分别建立独立fixture和测试名，但每例只断言`StableArtifactLeaseError::SharingViolation`以及公开`CodexIntegrationError::ActiveArtifactHandleConflict`；UI断言通用占用文案，不断言具体进程、Handle类型或mapping来源；
  - Existing最后时刻修改：外部修改发生在最后一次检查之后、系统原子替换内部之前→`ReplaceFileW`捕获snapshot→两个Lease成功后Handle snapshot不等于originalDigest→返回`CapturedLateModification`且外部字节不丢；只有第一次target/snapshot双Lease稳定才释放相关Lease并执行第二次`ReplaceFileW`，之后重新取得restored target/conflict-current双Lease并验证；第一次snapshot Lease失败不执行第二次，第二次后任一Lease失败不清任何版本并Conflict；
  - Lease排他性：Lease成功后另一线程请求`GENERIC_WRITE`、rename、delete都得到sharing violation；Lease期间两次Handle摘要、volume serial/file ID与路径身份不变，普通只读与Runtime self-check仍成功；
  - Absent最后时刻出现与发布后writer：检查时Bridge、Record或新Hook目标absent→`BeforeAtomicReplace`后外部创建目标→no-replace publish返回`DestinationAppeared`→外部目标字节不变、transaction temp保留；publish成功后外部立即写打开target→target Lease失败或Handle摘要不符→target保留、Journal保留且Conflict；
  - Bridge/Record顺序：Bridge正常替换→Record替换瞬间捕获late modification→不继续Config→Repair按replaced snapshot优先恢复Bridge→Record外部修改保留；
  - Config顺序：Bridge/Record已Target且BridgeApplied已持久化→Config不重跑optimistic precondition check，直接用统一原子语义捕获late modification→Config外部修改不丢→Bridge/Record按action-aware规则恢复；prepared backup不得覆盖late snapshot；
  - Removal原子捕获：Bridge rename到removed tombstone后旧写Handle继续指向tombstone并写入→tombstone Lease失败→不按路径读取、不永久删除、不进入Uninstalled；关闭Handle后retry以最终Handle摘要重新分类；tombstone后目标路径被重新创建→两者保留。正常Uninstall固定Bridge/Record进入tombstone并持Lease推进BridgeApplied，再原子移除CodePulse marker推进ConfigApplied，Uninstalled invariant通过后持全部Lease推进StructureCommitted；资源缺失时阶段按已满足推进但不得跳过BridgeApplied；
  - 原子故障：覆盖`ReplaceFileW`官方`ERROR_UNABLE_TO_REMOVE_REPLACED`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT`、`ERROR_UNABLE_TO_MOVE_REPLACEMENT_2`及sharing/access等错误，snapshot创建失败、snapshot Lease/Handle摘要失败、第二次安全恢复及后置Lease失败、no-replace目标已存在、tombstone rename/Lease失败、StructureCommitted后cleanup Handle失败；任一失败不得丢失当前目标、replaced snapshot、tombstone或prepared backup；
  - 代表性中断恢复：Prepared写入前崩溃时无正式Journal/staging且目标不变；Prepared已落盘但precondition失败时Journal存在、零staging/零目标操作且不做结构回滚；precondition通过后只创建一部分staging时崩溃，只清理Journal列出的本transactionId普通staging或由startup recovery接管，另一个ID的artifact不得删除；
  - 孤立Journal temp：无稳定Journal+一个或两个合法Prepared-only temp→全部删除；文件名/内容ID不符、stage=BridgeApplied、目标已改变或存在同ID staging/capture artifact→保留并`OrphanTransactionConflict`、Runtime不启动；稳定Journal ID=A+ID=B Journal temp或普通目标artifact→只处理A，B只诊断不删除；测试显式保持单实例前提；
  - BridgeApplied 混合恢复：Bridge=Target/Record=Original 只恢复 Bridge；Bridge=Original/Record=Target 只恢复 Record；首次 Install Bridge=Target/Record=ExpectedAbsent 删除新 Bridge，最终两者均不存在；
  - ConfigApplied 混合恢复：Config=Target、Bridge=Target、Record=Original 时先回滚 Config，再逐文件恢复 Bridge/记录；反向混合同理；不得把部分结构提升为 StructureCommitted；
  - ConfigApplied完整目标：Install要求Marker=Exact且原用户Hook保留、Bridge版本/摘要/PE属性正确、Record与最终结构一致且只记录Runtime请求意图；Repair还要求缺失/旧Bridge与CodePulse Hook已修复、非CodePulse Hook未被破坏。满足后才返回InstalledOrRepaired并提升StructureCommitted；尚无self-check后真实事件时不得running；
  - action-aware rollback：Repair 前 Hook 一直引用稳定路径时仍恢复旧 EXE/旧记录且不返回引用冲突；Install 前 Bridge 不存在但配置仍引用稳定路径时禁止删除新 EXE；
  - Uninstall部分捕获：Config仍为Original时，Bridge tombstone+Record present或Bridge present+Record tombstone属于BridgeApplied前后的可恢复中间态；全部Bridge/Record removal满足并持久化BridgeApplied后才移除CodePulse marker。只有用户其他Hook保持、Marker=Absent、无引用、两目标absent且tombstone受当前Journal控制才返回Uninstalled/StructureCommitted；Runtime stop/空快照/not_installed在文件事务后编排；
  - Lease跨阶段：prepared backup及原子结果target/snapshot/tombstone普通Lease全部持有到StructureCommitted持久化；BridgeApplied/ConfigApplied不是释放点。`AfterHashBeforeStagePersist`注入阶段写失败时Lease保持且不继续任何后续操作，进程崩溃后recovery重新获取，Lease不出现在Journal/IPC；
  - Rollback/recovery Lease：使用current target、snapshot/conflict-current/tombstone/prepared backup前逐个Lease→identity→Handle摘要；高优先级Lease失败时不降级到prepared backup、不删除任何capture，关闭外部Handle后的安全retry才继续；
  - StructureCommitted cleanup Handle：先释放全部普通事务Lease，再用`CreateFileW(GENERIC_READ | DELETE, FILE_SHARE_READ, OPEN_EXISTING)`为每个普通artifact新开cleanup Handle；在同一Handle完成identity→digest→identity/digest复核→`FileDispositionInfo`删除标记，close后检查路径absent、delete pending或path reuse。cleanup失败只Warning，文件和StructureCommitted Journal保留，正确结构不回滚、不映射为整体安装失败；Conflict artifact永不进入普通cleanup，Conflict只能安全retry且保留外部变化证据；
  - ConfigApplied 后用户并发修改配置或 Bridge：Bridge=ExternalModification+Record=Target 返回 Conflict，不覆盖用户字节、不删除仍被引用 Bridge并保留诊断；
  - 每个故障注入点后读取Hook与稳定Bridge：Install/Repair不得提交Hook指向缺失Bridge；Uninstall的BridgeApplied中间态允许marker尚未移除，但不得发布running，且必须能按Journal+Handle安全恢复，最终StructureCommitted必须无稳定路径引用；
  - StructureCommitted后self-check超时/失败：Hook/Bridge保留、ListeningStatus为partial/service_error；cleanup失败仅Warning且不改变监听状态。ConfigApplied前、StructureCommitted前和self-check期间到达的真实事件均不得running，self-check后下一条新的当前generation真实认证Hook才running。

  Conflict安全重试自动行为矩阵固定覆盖：文件未处理或活动writer/mapping/delete Handle仍存在时retry重新获取Lease但仍Conflict且字节不变；外部关闭Handle后retry读取最终Handle摘要并继续；用户手工恢复Config为Original后retry完成回滚并以Handle清理Journal；三者恢复为Target且invariant通过时retry在Lease下提升StructureCommitted；并发点击由operation mutex只执行一次状态机；无Journal/孤立temp返回NoPendingTransaction；成功后重新Inspection并发布ListeningStatus。UI只显示“重新尝试安全恢复”，不显示强制覆盖/丢弃/忽略入口。

  标准Fixture自动行为矩阵：分别用 `C:\Users\Test User\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe`、`C:\Users\测试用户\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe` 和含单引号的 `C:\Users\O'Connor\AppData\Local\CodePulse\bin\codepulse-codex-bridge.exe` 稳定 Bridge 路径，从空 JSON/TOML 配置执行实际 Install，再读取实际安装结果。JSON 解析为 `serde_json::Value`，TOML 解析为 `toml_edit::DocumentMut`；调用 04A 同一 `normalize_codepulse_hook_commands_for_exact(..., paths.installed_bridge.as_path())`，只提取CodePulse-owned groups并在AST command value中反向规范化具体路径，再与`codepulse-hooks-exact.json`/`.toml`母版AST比较。分别断言JSON/TOML可解析、command语义正确、JSON serializer正确处理反斜杠、TOML单引号不破坏文档、无placeholder残留。Repair modified后重复相同比较；用户已有独立matcher group不进入projection且CodePulse仍Exact；用户handler与CodePulse handler混合同group时为Modified，Repair后用户Handler规范AST深度相等且CodePulse group独立。wrong-path EXE+marker、旧Bridge路径、基础/Windows command任一个错误或缺失、附加`--extra`均不得变成Exact。禁止`actual_text.replace(actual_path, ...)`，测试不得内嵌第二套八事件期望或第二个loader。

  `DiscoveryOwner` 竞态：Runtime A 写 owner A，Runtime B 原子替换 owner B，A 的 stop/drop/RunEvent::Exit 调用 `remove_discovery_if_owned()` 返回 `ReplacedByNewRuntime` 且不删除 B；相同 PID不同 token、损坏文件均不盲删。PE 覆盖无签名、x64/ARM64 反配、Optional Header 太短、非法 Magic、Console/未知 Subsystem、不支持 triple 和旧 target误复制；x64/ARM64+WindowsGui 通过。正常/超时退出仍只启动一次 shutdown。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests::review_regressions -- --nocapture
  Pop-Location
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-codex-bridge-resource-validation.ps1
  ```

  预期：审查回归尚未进入自动行为矩阵，测试失败。

- [ ] **步骤 3：实现临时目录/内存 harness**

  Bridge使用库入口和真实`std::process::Command` piped进程，HTTP用真实loopback，Actor用ManualClock，SnapshotStore由Manager fixture只构造一次并跨两个fake Runtime共用，配置用TempDir，publisher/installer/runtime generation/owner/Integration Journal/operation mutex调用序列可断言。文件系统harness必须在统一`AtomicIntegrationFs`抽象中提供`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`、`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`精确注入点，并保留Prepared后staging前、每个prepared backup后的早期注入；不能只在调用`MoveFileExW`前注入。harness必须能用真实Windows Handle建立活动writer、`PAGE_READWRITE`/`FILE_MAP_WRITE`映射、Lease成功后的新write/rename/delete请求、Lease释放后的恢复竞态与cleanup Handle取得失败；每个注入点验证Handle identity/originalDigest/targetDigest以及target、replaced snapshot、conflict-preserved-current、removed tombstone、prepared backup的保留状态。Fixture注入、目标序列化与Exact反向规范化全部调用04A同一AST loader并传入`paths.installed_bridge`，不复制内容、不做原始文本replace。除loopback不使用真实网络/Home；每例结束TempDir删除，仓库无discovery/Integration Journal/事件文件。

  运行：

  ```powershell
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::e2e_tests -- --nocapture
  Pop-Location
  ```

  预期：十四项设计场景的自动行为矩阵、稳定事件跨层逻辑键、Session/Permission幂等公开行为与审查回归全部通过；结果不写成真实App/CLI兼容结论。

- [ ] **步骤 4：实现并运行范围脚本**

  `verify-codex-status-scope.ps1`必须在以下条件失败：package-lock/yarn.lock；生产WSL/wsl.exe；授权allow/deny/open-session/pause/terminate API；Bridge缺少`windows_subsystem = "windows"`、历史写入/重试/stdout非`{}`；PE校验缺Machine或WindowsGui Subsystem；IslandView出现聚合生命周期/Stop classifier；Inspection DTO出现动态hookState/phase；CodePulse前端或planner自动写Hooks feature/删除`codex_hooks`；显示偏好调用runtime；Codex模块在paths.rs外拼接CodePulse/runtime/bin或`codex-integration-transaction.json`；`CodexIntegrationPaths`出现第二个含`transaction`的字段，或startup调用的恢复接口不是`recover_interrupted_codex_integration_transaction()`；用户确认前分配transactionId/prepare/写Journal、transactionId在pure prepare后分配、Prepared前创建正式staging、Prepared后未先完成三文件optimistic precondition check就创建staging、在staging或单文件apply阶段重跑precondition、prepared backup未按originalDigest经Handle验证、缺all-staging-ready、任一capture路径不能由Journal/transactionId归属；Existing target仍使用裸`MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`、没有transaction-owned replaced snapshot、snapshot摘要不符后继续下一文件、late modification被prepared backup覆盖；Absent target使用`MOVEFILE_REPLACE_EXISTING`或目标出现后仍覆盖；Uninstall直接用`DeleteFileW`、绕过BridgeApplied或先推进ConfigApplied、未使用removed tombstone；普通事务Lease在StructureCommitted前释放或被复用为cleanup Handle；Conflict artifacts作为普通成功清理删除；writer与installer各自实现不同替换逻辑；缺少`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`任一精确注入点；稳定Journal不存在时扫描范围宽于精确`.<journal-filename>.codepulse-<32hex>.tmp`，或异常孤立temp被删除；Manager构造不显式接收Store或setup另manage第二份Store；标准Fixture缺任一事件/command Windows override/timeout=2，或出现matcher/statusMessage/async；`normalize_codepulse_hook_commands_for_exact`未显式接收expected_bridge_path/expected command，CodePulse projection包含用户独立Hook，Fixture loader/Exact/E2E对raw JSON/TOML调用path/placeholder replace，JSON未经serde_json AST、TOML未经toml_edit AST，Inspection/Planner/Repair/E2E存在第二套loader或手写八事件模板；StructureCommitted仍一律要求Marker Exact，或Uninstall未要求Marker Absent+无引用+Bridge/Record absent+tombstone受Journal控制；cleanup Warning被映射为Conflict/整体安装失败；self-check前事件进入running；Conflict UI缺安全retry或存在force overwrite/discard/ignore入口；Discovery存在无owner删除；验收路径不唯一。

  范围脚本还必须失败于：snapshot/tombstone使用`std::fs::read`、`File::open`或其他路径型关键摘要；Lease的ShareMode包含`FILE_SHARE_WRITE`或`FILE_SHARE_DELETE`；ReplaceFileW成功后未同时取得target/snapshot `StableArtifactLease`并验证不同file ID；no-replace成功后未取得target Lease；tombstone capture成功后未取得tombstone Lease；recovery/rollback在Lease失败后降级为路径读取或prepared backup覆盖；StructureCommitted cleanup直接调用路径型`DeleteFileW`或采用“路径摘要→删除同名路径”；Conflict artifact进入`delete_verified_artifact_by_handle`；BridgeApplied/StructureCommitted Journal持久化前释放对应Lease；缺少`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`任一注入点。

  运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-status-scope.ps1
  ```

  预期：脚本逐项输出通过。

- [ ] **步骤5：全量运行A自动行为矩阵并提交**

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

## 任务5（B/C）：分别完成Codex App与独立CLI真实验收

**独立交付物：** 同一记录中严格分栏保存B Codex App真实验收与C独立CLI真实验收的日期、版本、来源、客观结果和发布影响；状态只允许“通过”“失败”“环境阻塞”。A自动行为测试不得填入B/C证据栏。

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

### B. Codex App真实验收

- [ ] **步骤3：用设置页安装并验证App真实Hook信任**

  在 preview 确认八事件、稳定 Bridge 和警告后 apply；立即读取实际安装结果，按表示方式解析成 JSON/TOML AST，调用 04A 同一 `normalize_codepulse_hook_commands_for_exact(..., paths.installed_bridge.as_path())`只提取并规范化CodePulse-owned projection，再确认matcher组与对应标准Fixture AST语义相等且用户其他独立Handler深度相等。禁止在真实配置原始文本上替换Bridge路径，也不能把wrong-path/extra-arg handler规范化成Exact。状态先为awaiting_trust。启动新Codex App任务，在官方UI信任CodePulse command Hook并提交只读请求；第一条属于当前Runtime generation的真实事件后才变running，来源包含App。不得把token或generation诊断细节写入验收文档。

  运行：

  ```powershell
  Get-FileHash -Algorithm SHA256 -LiteralPath "$env:LOCALAPPDATA\CodePulse\bin\codepulse-codex-bridge.exe"
  Get-Content -LiteralPath "$env:LOCALAPPDATA\CodePulse\runtime\codex-bridge.json" -Encoding utf8
  ```

  预期：稳定 EXE 存在，发现文件 PID/port/version 有效；文档不记录 token。

- [ ] **步骤4：验证App多会话、来源、状态与生命周期**

  两个真实App任务覆盖读取、编辑临时测试仓库、命令、测试、授权、先失败后修复、明确无法完成；确认来源识别为App，并记录主/卫星、列表/详情、子任务计数、中间失败、完成5分钟、失败clear、鼠标离开一秒、无授权按钮。10/30分钟只用A矩阵的ManualClock证据，不在发布构建暴露调试接口，也不把该自动证据冒充真实App时长验收。

  运行：

  ```powershell
  pnpm run test -- src/components/island/codex src/components/island/IslandView.codex.test.ts src/modules/island/display.test.ts
  Push-Location src-tauri
  cargo test -p netspeed-dynamic codex::lifecycle_tests -- --nocapture
  Pop-Location
  ```

  预期：自动证据通过，人工 App 场景逐项记录。

- [ ] **步骤5：验证App GUI无闪烁、安装/修复/卸载与重装generation**

  先让 Codex App 连续触发多个 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse Hook，观察全程无可见黑色控制台窗口或任务栏闪烁；同时确认每个 Hook 行为正常、Bridge stdout 管道仍精确 `{}`、stderr 空、exit 0。把“GUI Subsystem 无控制台闪烁”作为独立验收项记录，不能只用 PE 自动测试代替人工观察。

  占用47653后启动CodePulse，确认fallback；托盘退出应经过统一ExitRequested，两秒内owner-aware删除自己的discovery，旧Runtime清理不能删除重启后新discovery；重启只接新事件。用真实设置动作完成Install、Repair缺失/旧Bridge与Uninstall。用测试账户制造可逆的事务Conflict，确认设置页只显示固定安全说明与“重新尝试安全恢复”，无强制覆盖/丢弃/忽略；未处理时重试仍Conflict且字节不变，手工恢复到Journal已知Original/Target后重试可完成并清Journal。执行“安装并运行任务→记录当前revision→Uninstall→观察更高revision空快照清旧任务/not_installed→重新Install→第一条当前generation的真实Hook前awaiting_trust→真实Hook后任务正常显示且revision继续递增”，确认旧generation认证未沿用。用户其他Hook语义不变，cleanup失败只警告不恢复Hook。

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

### C. 独立CLI真实验收

- [ ] **步骤6：在PowerShell可独立运行的官方CLI环境完成真实验收**

  先读取CLI版本；随后由该独立CLI执行真实任务并触发真实Hook，确认来源识别为CLI。至少覆盖与App并行、授权请求、成功完成和最终失败场景。模拟`source='cli'`、mock父进程链、直接POST事件或A矩阵中的fake CLI都不能替代本步骤。

  运行：

  ```powershell
  $codex = Get-Command codex -ErrorAction Stop
  & $codex.Source --version
  ```

  预期：只有独立CLI命令以0退出才继续真实任务、真实Hook、CLI来源、授权、完成/失败和App并行验收；不可用或无法完成真实Hook链路时只记录“环境阻塞”，App门禁可单独通过，但不得声明“Windows原生CLI与App完整正式兼容已通过”。

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
- A自动行为矩阵覆盖十四项设计场景、occurredAt/墙钟回拨、dormant空快照、跨Runtime revision/generation、disabled uninstall、用户确认后才分配transactionId、pure prepare/Prepared前零正式staging、Prepared→precondition→staging→all-staging-ready固定顺序、BridgeApplied/ConfigApplied混合状态恢复、Install/Repair/Uninstall action-specific invariant、提交后cleanup Warning、Discovery owner竞态、退出和PE Machine+WindowsGui；这些只属于内部行为证据。
- A自动行为矩阵覆盖两个模拟活动Hook文件对Tool/Subagent/Turn相同稳定键使用不同`eventId`时只处理一次，并覆盖不同turnId/toolUseId/agentId不误合并；SessionStarted重复只幂等刷新；PermissionRequested同轮重复无第二次强提醒、退出等待后可再次提醒且不进入逻辑键缓存；缺失稳定标识按事件表处理；eventId与逻辑键缓存均有界且Actor独占；逻辑键/Debug不含用户内容、cwd、路径、命令、tool input/output、授权说明或occurredAt，Bridge/Vue不实现第二层去重。
- A自动行为矩阵明确区分三种原子语义并验证后置Lease：Existing由`ReplaceFileW`捕获实际旧内容后取得target/snapshot双Lease；Absent由no-replace move发布并在成功后取得target Lease；Removal把Bridge/Record原子rename为removed tombstone后取得tombstone Lease且StructureCommitted前不永久删除。关键摘要只经Handle，不存在裸检查后`MOVEFILE_REPLACE_EXISTING`被称为CAS。
- A自动行为矩阵覆盖Prepared后一次三目标optimistic precondition check、后续staging verification与all-staging-ready、Existing正常双Lease、existing旧写Handle继续写snapshot、writable mapping、普通Lease保持到StructureCommitted、最后一次检查之后的late modification、第一次Lease失败禁止第二次ReplaceFileW、第二次恢复后重新取得双Lease、Absent发布后立即writer、Uninstall也按Bridge/Record→BridgeApplied→Config→ConfigApplied、tombstone旧writer及retry、写后Handle targetDigest失败停止、精确孤立Journal temp清理/Conflict、operation mutex安全retry与NoPendingTransaction；不同占用场景统一映射`SharingViolation`/`ActiveArtifactHandleConflict`，late snapshot优先于prepared backup，所有冲突版本保留并只进入现有安全retry。
- `AtomicIntegrationFs`提供`BeforeAtomicReplace`、`AfterTargetOpenedOrPrepared`、`AfterAtomicReplaceBeforeVerification`、`BeforeConflictRestore`、`AfterRemovalCaptureBeforeVerification`、`BeforeStableLeaseAcquire`、`AfterStableLeaseAcquireBeforeHash`、`AfterHashBeforeStagePersist`、`BeforeVerifiedHandleDelete`；故障矩阵覆盖ReplaceFileW官方失败状态、snapshot创建/Lease/Handle摘要、第二次恢复及后置Lease、no-replace destination appeared/发布后writer、tombstone rename/Lease和提交后cleanup Handle。
- JSON/TOML 实际 Install 与 Repair 结果用04A同一AST loader并显式传入`paths.installed_bridge`，提取CodePulse-owned projection后分别语义等于唯一标准Fixture；空格、中文、单引号路径可解析且命令语义正确，JSON反斜杠/TOML单引号由serializer安全处理。wrong-path/旧路径/双command不一致/extra参数不可能Exact；用户独立Handler不进入projection且前后深度相等，混合group Repair后用户Handler保留、CodePulse group独立；E2E不做原始文本replace，不内嵌第二套loader或八事件模板。
- UI/composable对`IntegrationTransactionConflict`/`OrphanTransactionConflict`只提供安全重试；重试不改Feature键、不采用外部字节为Original、不忽略摘要。没有强制覆盖、强制删除事务或忽略并继续功能。
- A自动行为矩阵证明StructureCommitted后先释放全部普通事务Lease，再为每个普通artifact取得新的cleanup Handle并在同一Handle完成identity→digest→identity/digest复核→`FileDispositionInfo`删除标记；路径替换被cleanup Handle阻止，cleanup失败只Warning并保留StructureCommitted Journal，已提交结构不回滚且监听状态不改为安装失败，Conflict artifact不进入普通cleanup。
- 范围脚本除阻止WSL、控制Codex、历史补偿、自动改Hooks feature、路径分叉和错误验收路径外，还阻止确认前分配ID/prepare/Journal、Prepared后staging先于precondition、第二次precondition、缺all-staging-ready、Uninstall绕过BridgeApplied或先ConfigApplied、Existing裸`MOVEFILE_REPLACE_EXISTING`、Absent覆盖发布、直接`DeleteFileW`、原子操作后缺Lease、普通Lease在StructureCommitted前释放或复用为cleanup Handle、Conflict artifact普通清理、cleanup Warning映射为Conflict/整体失败、self-check前事件running及writer/installer替换逻辑分叉。
- B Codex App真实验收单独证明官方信任流程、真实Hook触发、App来源、GUI无控制台闪烁、多会话、实际安装/修复/卸载，以及第一条当前generation真实事件后才running。
- C独立CLI真实验收单独证明版本读取、真实任务、真实Hook、CLI来源、App并行、授权及完成/失败；模拟source、mock父进程链或直接POST不得替代。CLI不可用只记录“环境阻塞”，此时不得声明Windows原生CLI与App完整正式兼容通过。
- 全部完成后停止，不自动开展下一版功能。
