import type { AgentListenerStatus, AgentTaskPhase } from './agent';

export type ClaudeChildKind = 'subagent' | 'task';

export interface ClaudeChildTaskSnapshot {
  taskKey: string;
  childKind: ClaudeChildKind;
  childId: string;
  parentTaskKey?: string;
  phase: AgentTaskPhase;
  taskSummary?: string;
  operationSummary?: string;
  errorSummary?: string;
  lastActivityAtMs: number;
}

export interface ClaudeSessionSnapshot {
  taskKey: string;
  sessionId: string;
  phase: AgentTaskPhase;
  effectivePhase: AgentTaskPhase;
  projectName?: string;
  sessionLabel?: string;
  taskSummary?: string;
  operationSummary?: string;
  errorSummary?: string;
  children: ClaudeChildTaskSnapshot[];
  lastActivityAtMs: number;
}

export interface ClaudeStatusSnapshot {
  revision: number;
  generatedAtMs: number;
  sessions: ClaudeSessionSnapshot[];
  representativeSession: ClaudeSessionSnapshot | null;
  hasWaitingApproval: boolean;
  hasFailedTask: boolean;
  listenerStatus: AgentListenerStatus;
}

export type ClaudeCliStatus = 'missing' | 'unsupported' | 'ready';
export type ClaudeHookStatus =
  'not_installed' | 'installed' | 'needs_repair' | 'manual_intervention';
export type ClaudeBridgeStatus = 'ready' | 'missing' | 'needs_repair';
export type ClaudeIntegrationAction = 'install_or_repair' | 'uninstall';

export interface ClaudeIntegrationStatus {
  cli: ClaudeCliStatus;
  cliVersion: string | null;
  minimumCliVersion: string;
  hook: ClaudeHookStatus;
  bridge: ClaudeBridgeStatus;
  settingsFile: string;
  bridgeFile: string;
  cliFile: string;
  disableAllHooks: boolean;
  allowManagedHooksOnly: boolean;
  message: string | null;
}

export interface ClaudeIntegrationPreview {
  id: string;
  action: ClaudeIntegrationAction;
  targetFile: string;
  bridgeFile: string;
  changes: string[];
  warnings: string[];
  canConfirm: boolean;
}

export interface ClaudeIntegrationActionResult {
  action: ClaudeIntegrationAction;
  backupFile: string | null;
  bridgeCleanupPending: boolean;
  listenerStartFailed: boolean;
}

export interface ClaudeDisplayPreferencesPayload {
  idleResident: boolean;
  showOperationSummary: boolean;
  showTaskSummary: boolean;
}
