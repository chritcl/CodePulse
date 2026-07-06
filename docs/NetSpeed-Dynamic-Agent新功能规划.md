# NetSpeed Dynamic Agent 新功能规划

> 目标：在完成现有项目重构后，将 NetSpeed Dynamic 从网速灵动岛扩展为 Windows AI Agent 状态中心，展示 Agent 的运行状态、任务进度、等待确认、完成和失败信息，并支持任务栏详情弹窗及远程消息通知。

---

## 1. 功能定位

产品定位建议从：

```text
Windows 网速与系统状态灵动岛
```

升级为：

```text
Windows AI Agent Activity Hub
```

核心展示终端：

1. 动态岛：即时状态和重要提醒
2. 任务栏弹窗：当前任务详情和快捷操作
3. 管理控制台：Agent 管理、历史、配置和通知规则

---

## 2. 本阶段范围

### 包含内容

- Agent Provider 扩展体系
- Codex Agent 首个接入
- 通用 Agent 状态模型
- Agent 状态动态岛
- Agent 详情展开状态
- 任务栏 Agent 弹窗
- Agent 运行历史
- 等待输入、完成和失败提醒
- Windows Toast 通知
- 企业微信或通用 Webhook 通知
- 通知规则和去重
- 多 Agent 基础支持

### 暂不包含

- 在应用内部直接执行 Agent
- 替代 Codex 或 Claude Code 客户端
- 完整终端模拟器
- 远程控制用户电脑
- 自动批准高风险操作
- 将密钥保存在前端
- 第一版同时深度支持所有 Agent

---

## 3. 实施前置条件

开始本功能前，建议现有项目至少完成：

- Vue 核心组件拆分
- Rust 模块拆分
- 统一 AppState
- 统一 IPC 协议
- 统一设置存储
- Rust 后台调度器
- 基础 SQLite 存储能力

Agent 功能不应继续直接写入旧版 `WidgetIsland.vue` 和 `lib.rs`。

---

## 4. 产品信息架构

```text
控制台
├── 总览
│   ├── 当前运行 Agent
│   ├── 等待处理
│   ├── 今日完成任务
│   └── 最近失败任务
├── Agent
│   ├── Codex
│   ├── Claude Code
│   ├── Cursor
│   └── Generic Agent
├── 历史
│   ├── 会话历史
│   ├── 状态时间线
│   └── 错误记录
├── 通知
│   ├── Windows 通知
│   ├── 企业微信
│   ├── Webhook
│   └── 通知规则
└── 设置
    ├── 动态岛
    ├── 任务栏弹窗
    ├── Agent 检测
    └── 隐私与数据
```

---

## 5. Agent 统一状态模型

### 5.1 状态枚举

```ts
export type AgentRunStatus =
  | 'offline'
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

### 5.2 Agent 快照

```ts
export interface AgentSnapshot {
  providerId: string;
  providerName: string;

  agentId: string;
  sessionId?: string;

  projectName?: string;
  projectPath?: string;

  taskTitle?: string;
  currentStep?: string;
  detail?: string;

  status: AgentRunStatus;
  progress?: number;

  model?: string;
  processId?: number;

  startedAt?: number;
  updatedAt: number;
  completedAt?: number;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    tokenLimit?: number;
    quotaRemaining?: number;
  };

  error?: {
    code?: string;
    message: string;
  };

  actions?: AgentAction[];
}
```

### 5.3 可执行操作

```ts
export interface AgentAction {
  id: string;
  label: string;
  type:
    | 'open_agent'
    | 'open_project'
    | 'open_log'
    | 'approve'
    | 'reject'
    | 'cancel';
  enabled: boolean;
  risk?: 'low' | 'medium' | 'high';
}
```

第一版建议只提供：

- 打开 Agent
- 打开项目
- 查看日志

审批、拒绝和取消等控制操作放到后续版本。

---

## 6. Agent 事件模型

```ts
export type AgentEventType =
  | 'agent.detected'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.waiting'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled'
  | 'agent.disconnected';

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  providerId: string;
  agentId: string;
  sessionId?: string;
  timestamp: number;
  snapshot: AgentSnapshot;
}
```

所有动态岛展示、历史记录和消息通知都应基于统一事件流。

---

## 7. Provider 扩展体系

### 7.1 Rust Trait

```rust
#[async_trait]
pub trait AgentProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;

    async fn detect(&self) -> Result<bool, ProviderError>;
    async fn snapshot(&self) -> Result<AgentSnapshot, ProviderError>;
}
```

### 7.2 Provider 分层

```text
AgentProvider
├── GenericProcessProvider
├── CodexProvider
├── ClaudeCodeProvider
├── CursorProvider
└── CustomWebhookProvider
```

### 7.3 第一版接入顺序

1. Generic Process Provider
2. Codex Provider
3. 自定义 Webhook Provider
4. Claude Code Provider
5. Cursor Provider

第一版不建议同时深度接入多个 Agent。

---

## 8. Agent 状态采集方式

### 8.1 第一层：进程检测

可采集：

- Agent 是否运行
- PID
- 启动时间
- CPU 和内存
- 可执行文件路径
- 命令行参数
- 最近活动时间

优点：

- 通用
- 实现简单
- 不依赖 Agent 官方接口

限制：

- 无法准确知道当前步骤
- 无法准确识别等待输入
- 无法获取 Token 和额度

### 8.2 第二层：日志和本地数据监听

可采集：

- 当前项目
- 当前会话
- 当前任务
- 最近一次工具调用
- 构建或测试结果
- 错误信息
- 是否等待用户确认

每个 Agent 使用独立 Adapter 解析，不允许把 Agent 特有逻辑写入动态岛组件。

### 8.3 第三层：Hook、插件或官方接口

可采集：

- 精确任务状态
- Token 使用量
- 当前模型
- 上下文窗口
- 工具调用
- 审批请求
- 任务完成比例

能使用官方接口时，应优先使用官方接口，而不是依赖不稳定的 UI 抓取。

---

## 9. Codex MVP

第一版 Codex 接入建议只实现以下能力。

### 检测

- Codex 是否运行
- 当前 PID
- 当前工作目录
- 启动时间

### 状态

- 空闲
- 正在运行
- 等待用户输入
- 已完成
- 执行失败
- 已退出

### 任务信息

- 项目名称
- 当前任务标题
- 当前步骤摘要
- 已运行时长
- 最近更新时间

### 操作

- 打开 Codex
- 打开项目目录
- 查看最近日志

### 通知

- 等待输入
- 运行完成
- 运行失败

---

## 10. 动态岛状态设计

### 10.1 显示状态模型

```ts
export type IslandView =
  | { type: 'agent-running'; agent: AgentSnapshot }
  | { type: 'agent-waiting'; agent: AgentSnapshot }
  | { type: 'agent-completed'; agent: AgentSnapshot }
  | { type: 'agent-error'; agent: AgentSnapshot }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'music'; music: MusicSnapshot }
  | { type: 'metrics'; metrics: SystemMetrics }
  | { type: 'network'; network: NetworkSnapshot };
```

### 10.2 展示优先级

| 优先级 | 状态 | 行为 |
|---|---|---|
| P0 | Agent 失败 | 持续显示，直到确认或超时降级 |
| P0 | Agent 等待输入 | 持续显示并提供打开入口 |
| P1 | Agent 正在运行 | 展示当前步骤与运行时长 |
| P2 | Agent 完成 | 展示 5～10 秒 |
| P3 | 普通系统通知 | 临时覆盖 |
| P4 | 音乐 | 空闲时展示 |
| P5 | 硬件和网速 | 最低优先级轮换 |

### 10.3 紧凑状态示例

#### 空闲

```text
CODX   Ready
```

#### 运行中

```text
CODX   Refactoring router...
       02:18
```

#### 等待输入

```text
CODX   Waiting for approval
       Open
```

#### 已完成

```text
CODX   Task completed
       6 files changed
```

#### 失败

```text
CODX   Build failed
       TypeScript error
```

---

## 11. 动态岛展开状态

点击动态岛后展开：

```text
Codex · CodePulse
────────────────────────
正在重构 AgentProvider
步骤 4 / 7

✓ 分析项目结构
✓ 创建状态模型
● 修改事件总线
○ 运行测试

运行时间  03:42

[打开 Codex] [查看日志]
```

### 展开内容

- Agent 名称
- 项目名称
- 当前任务
- 当前步骤
- 运行时长
- 最近事件
- 快捷操作

### 交互要求

- 点击运行中状态展开
- 鼠标离开后自动收起
- 等待输入或失败时延长停留
- 点击“打开 Agent”后切换到对应程序
- 不在动态岛内直接展示过长日志

---

## 12. 任务栏弹窗

任务栏弹窗与动态岛是两个独立窗口，不应复用同一套完整页面布局。

### 12.1 入口

- 点击任务栏区域小组件
- 点击托盘图标
- 点击动态岛详情入口
- 全局快捷键

### 12.2 页面结构

```text
┌────────────────────────────┐
│ Agent Activity             │
├────────────────────────────┤
│ Codex · CodePulse          │
│ ● 正在运行  03:42          │
│ 修改 Agent 事件总线        │
│ [打开] [查看详情]          │
├────────────────────────────┤
│ Claude Code                │
│ ○ 空闲                     │
├────────────────────────────┤
│ 最近事件                   │
│ 10:21 Codex 等待确认       │
│ 10:18 测试执行完成         │
└────────────────────────────┘
```

### 12.3 功能

- 展示所有 Agent 当前状态
- 切换当前重点 Agent
- 查看最近事件
- 打开对应程序
- 打开项目目录
- 临时静音通知
- 进入完整控制台

---

## 13. 控制台 Agent 页面

### 13.1 Agent 总览

展示：

- 当前运行数量
- 等待处理数量
- 今日完成数量
- 今日失败数量
- 总运行时长

### 13.2 Agent 卡片

每张卡片展示：

- Agent 名称和图标
- 当前状态
- 当前项目
- 当前任务
- 运行时长
- 最近更新时间
- 通知开关
- 详情入口

### 13.3 会话详情

```text
会话基本信息
├── Agent
├── 项目
├── 模型
├── 开始时间
├── 结束时间
└── 持续时间

状态时间线
├── 启动
├── 分析项目
├── 修改文件
├── 运行测试
├── 等待确认
└── 完成或失败
```

---

## 14. 数据库存储

建议使用 SQLite。

### 14.1 `agent_sessions`

```text
id
provider_id
agent_id
project_name
project_path
task_title
status
model
started_at
completed_at
created_at
updated_at
```

### 14.2 `agent_events`

```text
id
session_id
event_type
summary
detail_json
created_at
```

### 14.3 `usage_snapshots`

```text
id
session_id
input_tokens
output_tokens
total_tokens
quota_remaining
created_at
```

### 14.4 `notification_logs`

```text
id
event_id
channel_id
status
error_message
sent_at
```

---

## 15. 通知系统

### 15.1 通知方向

需要区分两类能力：

```text
Windows 系统通知 → 动态岛展示
Agent 状态事件 → Windows / 企业微信 / Webhook
```

两者不是同一个功能。

### 15.2 通知渠道接口

```rust
#[async_trait]
pub trait NotificationChannel: Send + Sync {
    fn id(&self) -> &'static str;

    async fn send(
        &self,
        notification: &OutboundNotification,
    ) -> Result<(), NotificationError>;
}
```

### 15.3 支持渠道

第一阶段：

- Windows Toast
- 企业微信机器人
- 通用 Webhook

后续：

- 邮件
- Server 酱或类似推送服务
- Telegram
- 钉钉机器人

### 15.4 通知规则

```text
Agent 等待输入          → 立即通知
Agent 执行失败          → 立即通知
Agent 运行超过 1 分钟完成 → 通知
Agent 运行少于 1 分钟完成 → 可选
Agent 正常运行          → 不通知
相同事件短时间重复      → 去重
夜间时段                → 可静默
```

### 15.5 通知去重

建议生成去重键：

```text
providerId + sessionId + eventType + normalizedMessage
```

在配置的时间窗口内不重复发送。

---

## 16. 企业微信与微信通知建议

优先支持企业微信机器人 Webhook，原因：

- 接入简单
- 不需要个人微信自动化
- 稳定性更高
- 风险更低
- 便于发送结构化 Markdown

消息示例：

```text
Codex 等待你的确认

项目：CodePulse
任务：重构 AgentProvider
状态：Waiting for approval
运行时间：03:42

请回到电脑处理。
```

### 安全要求

- Webhook 地址不保存在前端
- Token 不写入日志
- 配置界面默认遮挡敏感字段
- 提供测试通知
- 支持一键删除渠道
- 导出配置时默认排除密钥

不建议通过模拟个人微信客户端点击来发送消息。

---

## 17. 设置项设计

### Agent 设置

- 启用 Agent 检测
- 自动发现 Agent
- 启用的 Provider
- 扫描间隔
- 项目路径显示方式
- 是否保存历史
- 历史保留天数

### 动态岛设置

- Agent 状态优先展示
- 完成状态停留时长
- 等待输入是否持续显示
- 是否显示项目名称
- 是否显示运行时长
- 是否自动展开错误

### 通知设置

- Windows 通知
- 企业微信
- 通用 Webhook
- 等待输入通知
- 完成通知
- 失败通知
- 最小运行时长
- 静默时间段
- 重复通知间隔

---

## 18. 隐私和安全

Agent 数据可能包含：

- 本地项目路径
- 文件名
- 任务内容
- 错误日志
- 命令行参数
- Token 使用数据

必须提供：

- 是否保存任务内容
- 是否保存项目路径
- 路径脱敏
- 历史保留期限
- 一键清除历史
- 通知内容脱敏
- 敏感字段排除规则

默认不向远程通知发送：

- 完整代码
- 完整日志
- 密钥
- 环境变量
- 命令完整输出

---

## 19. 异常与降级

### Agent 无法解析

降级为：

```text
Codex
● 正在运行
```

只展示进程级状态。

### 日志格式变化

- Provider 标记为部分可用
- 保留进程检测
- 不阻塞其他 Provider
- 记录解析错误
- UI 显示“详细状态暂不可用”

### 通知发送失败

- 保存失败日志
- 支持自动重试
- 不重复轰炸
- 本地 Windows 通知仍可正常工作

### 数据库损坏

- 自动备份
- 尝试修复
- 无法修复时创建新数据库
- 不影响动态岛基本运行

---

## 20. 分阶段实施计划

## 阶段 A1：Agent 基础设施

### 工作内容

- 建立 Agent 状态模型
- 建立 Agent 事件模型
- 建立 Provider Registry
- 建立 AgentService
- 建立 SQLite 表
- 建立 Agent Store

### 验收标准

- 可以注册一个模拟 Provider
- 模拟 Agent 状态能够广播到两个窗口
- 状态能够写入数据库
- 动态岛尚不要求正式展示

---

## 阶段 A2：Codex Provider MVP

### 工作内容

- 检测 Codex 进程
- 获取 PID、启动时间、工作目录
- 读取可用的本地状态或日志
- 识别运行、等待、完成、失败
- 生成统一 AgentSnapshot

### 验收标准

- Codex 启动和退出能被识别
- 任务运行状态能稳定更新
- 无法读取详细信息时能降级
- Provider 异常不影响主程序

---

## 阶段 A3：Agent 动态岛

### 工作内容

- 增加 AgentIslandContent
- 增加 Agent 状态图标和动画
- 建立 Island Arbiter
- 建立展示优先级
- 增加展开详情

### 验收标准

- 运行、等待、完成和失败状态正确展示
- Agent 状态可以覆盖网速和音乐
- 状态结束后能够恢复之前内容
- 不产生窗口尺寸漂移

---

## 阶段 A4：任务栏弹窗

### 工作内容

- 新增独立 Tauri 窗口
- 当前 Agent 列表
- 最近事件
- 快捷打开
- 静音通知
- 进入控制台

### 验收标准

- 弹窗位置正确
- 多显示器和 DPI 缩放正常
- 点击外部自动关闭
- 不抢占全屏应用焦点
- 与动态岛状态保持一致

---

## 阶段 A5：历史与控制台

### 工作内容

- Agent 总览
- 会话历史
- 状态时间线
- 错误详情
- 数据清理
- 隐私设置

### 验收标准

- 可以查看历史会话
- 可以按 Agent、项目和状态筛选
- 可以清理历史
- 保存和展示内容符合隐私设置

---

## 阶段 A6：通知渠道

### 工作内容

- Windows Toast
- 企业微信机器人
- 通用 Webhook
- 通知规则
- 静默时间
- 去重和重试
- 通知日志

### 验收标准

- 等待、完成、失败能够正确通知
- 相同事件不重复发送
- 敏感字段不会出现在通知中
- 通知失败不会影响 Agent 状态采集

---

## 阶段 A7：多 Agent 扩展

### 工作内容

- Claude Code Provider
- Cursor Provider
- 多 Agent 同时运行
- 当前重点 Agent 选择
- Provider 插件化配置

### 验收标准

- 多 Agent 状态互不覆盖
- 动态岛能按优先级选择展示对象
- 任务栏弹窗能展示全部 Agent
- 单个 Provider 崩溃不影响其他 Provider

---

## 21. MVP 功能清单

第一版建议只交付：

- [ ] Codex 进程检测
- [ ] Codex 当前项目
- [ ] 运行状态
- [ ] 运行时长
- [ ] 等待输入
- [ ] 任务完成
- [ ] 执行失败
- [ ] 动态岛状态展示
- [ ] 点击打开 Codex
- [ ] 最近事件
- [ ] Windows 通知
- [ ] 企业微信机器人通知
- [ ] 基础通知规则

第一版暂不做：

- [ ] 自动批准
- [ ] 远程取消任务
- [ ] 完整 Token 统计
- [ ] 五种 Agent 同时深度接入
- [ ] 个人微信自动化
- [ ] 远程执行命令
- [ ] 云端账号系统

---

## 22. 完成定义

满足以下条件后，Agent 新功能第一阶段视为完成：

- Codex Provider 稳定运行
- Agent 状态使用统一模型
- 动态岛能够正确展示关键状态
- 任务栏弹窗能够查看详情
- 状态历史能够持久化
- 等待、完成、失败能够触发通知
- 企业微信或 Webhook 可配置
- 通知支持去重、静默和失败日志
- Provider 异常不会影响原网速、音乐和硬件功能
- 数据和通知内容符合隐私与安全要求
