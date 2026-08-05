/** Agent 任务阶段 */
export type AgentTaskPhase =
  | 'analyzing'
  | 'reading'
  | 'editing'
  | 'running_command'
  | 'running_tests'
  | 'waiting_input'
  | 'browsing'
  | 'generating'
  | 'delegating'
  | 'waiting'
  | 'compacting'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'interrupted';

/** Agent 接收器状态 */
export type AgentListenerStatus = 'stopped' | 'waiting_for_event' | 'running' | 'failed';
