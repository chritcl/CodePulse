import type { AgentListenerStatus, AgentTaskPhase } from './agent';

/** Codex 事件来源 */
export type CodexEventSource = 'cli' | 'app' | 'unknown';

/** Codex 任务阶段兼容别名 */
export type CodexTaskPhase = AgentTaskPhase;

/** Codex 接收器状态兼容别名 */
export type CodexListenerStatus = AgentListenerStatus;

/** 单个 Codex 任务快照 */
export interface CodexTaskSnapshot {
  sessionId: string;
  turnId?: string;
  source: CodexEventSource;
  phase: CodexTaskPhase;
  projectName?: string;
  taskSummary?: string;
  operationSummary?: string;
  errorSummary?: string;
  lastActivityAtMs: number;
}

/** 进程内 Codex 状态快照 */
export interface CodexStatusSnapshot {
  revision: number;
  generatedAtMs: number;
  tasks: CodexTaskSnapshot[];
  representativeTask: CodexTaskSnapshot | null;
  hasWaitingApproval: boolean;
  hasFailedTask: boolean;
  listenerStatus: CodexListenerStatus;
}

/** Codex Hook 配置表示 */
export type CodexConfigRepresentation = 'hooks_json' | 'config_toml' | 'ambiguous' | 'invalid';

/** Codex 全局 Hook 状态 */
export type CodexGlobalHooksStatus =
  'enabled' | 'manual_enablement_required' | 'organization_managed';

/** CodePulse 自身 Hook 状态 */
export type CodePulseHookStatus =
  'not_installed' | 'installed' | 'waiting_trust' | 'needs_repair' | 'manual_intervention';

/** 已发布 Bridge 状态 */
export type CodexBridgeStatus = 'ready' | 'missing' | 'needs_repair';

/** Codex 集成可执行动作 */
export type CodexIntegrationAction = 'install_or_repair' | 'uninstall';

/** Rust 只读检查返回的 Codex 集成状态 */
export interface CodexIntegrationStatus {
  selectedConfig: CodexConfigRepresentation;
  globalHooks: CodexGlobalHooksStatus;
  hook: CodePulseHookStatus;
  bridge: CodexBridgeStatus;
  codexHomeExists: boolean;
  selectedConfigFile: string | null;
  bridgeFile: string;
  message: string | null;
}

/** 不写盘的 Codex 集成动作预览 */
export interface CodexIntegrationPreview {
  id: string;
  action: CodexIntegrationAction;
  targetFile: string;
  bridgeFile: string;
  changes: string[];
  warnings: string[];
  canConfirm: boolean;
}

/** 确认已预览动作后的结果 */
export interface CodexIntegrationActionResult {
  action: CodexIntegrationAction;
  backupFile: string | null;
  bridgeCleanupPending: boolean;
  listenerStartFailed: boolean;
}

/** 主窗口同步到桌面岛的 Codex 显示偏好 */
export interface CodexDisplayPreferencesPayload {
  idleResident: boolean;
  showOperationSummary: boolean;
  showTaskSummary: boolean;
}
