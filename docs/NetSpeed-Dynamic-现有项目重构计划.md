# NetSpeed Dynamic 现有项目重构计划

> 目标：在不改变现有功能和用户体验的前提下，重构项目结构、状态管理、跨窗口通信和 Rust 模块边界，为后续 Agent 状态展示、任务栏弹窗和消息通知功能提供稳定基础。

---

## 1. 重构范围

本阶段只处理现有项目的技术债和工程结构，不新增 Agent 业务功能。

### 包含内容

- 前端大组件拆分
- Rust `lib.rs` 模块拆分
- 多窗口状态同步重构
- 设置项统一管理
- 定时任务和系统监控统一管理
- IPC 命令与事件类型化
- 本地存储结构调整
- 工程规范、测试和构建流程补齐
- 修复明显的临时实现和潜在问题

### 不包含内容

- Codex、Claude Code、Cursor 等 Agent 接入
- Agent 状态解析
- Agent 历史记录
- 企业微信或微信消息推送
- 新的任务栏 Agent 弹窗
- Agent Token、额度和任务进度展示

---

## 2. 当前主要问题

### 2.1 前端组件过大

当前核心页面主要集中在：

- `src/views/MainPanel.vue`
- `src/views/WidgetIsland.vue`

两个文件同时承担页面渲染、状态管理、定时任务、Tauri 调用、窗口控制和业务判断，后续继续增加功能会显著提高维护成本。

### 2.2 状态来源分散

当前状态分布在：

- Vue `ref`
- `localStorage`
- Tauri 事件
- Rust 静态变量
- 多个前端定时器

这会导致：

- 主窗口与灵动岛状态不一致
- 同一数据被重复采集
- 新增窗口时需要复制逻辑
- 状态恢复和异常处理困难

### 2.3 跨窗口事件缺乏统一规范

目前使用多个字符串事件，例如：

```ts
emit('control-music-ctl')
emit('control-hardware-mon')
emit('control-msg-mode')
emit('control-rotation-mode')
```

存在以下问题：

- 事件名称散落
- Payload 没有统一类型
- 调用方和监听方容易不一致
- 修改字段时缺少编译期检查

### 2.4 Rust 后端职责混杂

当前 `src-tauri/src/lib.rs` 同时包含：

- 网速监控
- 硬件监控
- 媒体控制
- 音乐封面获取
- Windows 通知读取
- 应用唤醒
- 窗口动画
- 窗口置顶
- 托盘初始化
- Tauri 命令注册

需要按领域拆分，避免后续继续形成单文件核心。

### 2.5 本地存储能力不足

目前多个设置和流量统计直接保存在 `localStorage`。

适合保留在设置存储中的内容：

- 主题
- 灵动岛透明度
- 位置锁定
- 功能开关

不适合继续保存在 `localStorage` 的内容：

- 长期流量历史
- 系统事件历史
- 后续 Agent 会话和任务历史
- 通知发送日志

### 2.6 工程版本不统一

目前版本号分别存在于：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

应建立单一版本来源或自动同步脚本。

### 2.7 部分功能仍属于临时实现

例如 GPU 占用率目前并非真实采集，应在重构阶段：

- 明确标注为估算值；或
- 暂时移除 GPU 展示；或
- 接入真实 Windows 性能数据源

---

## 3. 重构原则

### 3.1 不改变现有功能

重构过程必须保证以下功能继续可用：

- 网速展示
- 网络状态灯
- 音乐信息和控制
- 硬件状态
- Windows 通知展示
- 灵动岛显隐
- 任务栏停靠
- 拖拽与位置锁定
- 流光边框
- 轮换模式
- 开机启动
- 托盘操作
- 检查更新

### 3.2 Rust 作为运行状态源

建议明确职责：

- Rust 负责系统数据、窗口控制和长期运行状态
- Vue 负责渲染和临时交互状态
- Pinia 只作为前端快照缓存
- UI 不直接维护系统级业务状态

### 3.3 所有通信必须类型化

所有 Tauri 命令、事件和 Payload 都应有统一定义。

### 3.4 先兼容，再替换

重构过程中可暂时保留旧事件，在新模块稳定后逐步移除，避免一次性大改导致功能回归。

### 3.5 每个阶段都可独立运行

每个重构阶段结束后，项目必须能够正常启动、构建和使用。

---

## 4. 目标目录结构

### 4.1 Vue 前端

```text
src/
├── app/
│   ├── bootstrap.ts
│   └── router/
├── windows/
│   ├── dashboard/
│   │   ├── DashboardView.vue
│   │   └── components/
│   └── island/
│       ├── IslandView.vue
│       └── components/
├── modules/
│   ├── network/
│   ├── hardware/
│   ├── music/
│   ├── notifications/
│   ├── settings/
│   └── island/
├── stores/
│   ├── app.store.ts
│   ├── settings.store.ts
│   └── island.store.ts
└── shared/
    ├── ipc/
    │   ├── commands.ts
    │   ├── events.ts
    │   └── contracts.ts
    ├── components/
    ├── types/
    └── utils/
```

### 4.2 Rust 后端

```text
src-tauri/src/
├── lib.rs
├── app/
│   ├── bootstrap.rs
│   ├── state.rs
│   └── scheduler.rs
├── commands/
│   ├── settings_commands.rs
│   ├── system_commands.rs
│   ├── media_commands.rs
│   └── window_commands.rs
├── domain/
│   ├── settings.rs
│   ├── metrics.rs
│   ├── media.rs
│   └── notification.rs
├── services/
│   ├── settings_service.rs
│   ├── metrics_service.rs
│   ├── media_service.rs
│   ├── notification_service.rs
│   └── window_service.rs
├── platform/
│   └── windows/
│       ├── media.rs
│       ├── notifications.rs
│       ├── process.rs
│       └── window.rs
└── storage/
    ├── settings_store.rs
    └── history_store.rs
```

---

## 5. 前端拆分方案

## 5.1 拆分 `MainPanel.vue`

建议拆为：

```text
DashboardView.vue
├── DashboardHeader.vue
├── RealtimeNetworkCard.vue
├── TrafficStatisticsCard.vue
├── GeneralSettingsCard.vue
├── IslandSettingsPanel.vue
├── MusicSettings.vue
├── NotificationSettings.vue
├── HardwareSettings.vue
├── UpdateChecker.vue
└── AppDialog.vue
```

### 需要抽取的 Composable

```text
useAppTheme.ts
useAppVersion.ts
useUpdateChecker.ts
useTrafficStatistics.ts
useAutostart.ts
useIslandSettings.ts
```

### 拆分要求

- 页面组件不直接访问大量 `localStorage`
- 图表实例只存在于对应图表组件
- Tauri 调用封装到 Service 或 Store
- 页面只负责组合组件和响应用户操作

---

## 5.2 拆分 `WidgetIsland.vue`

建议拆为：

```text
IslandView.vue
├── IslandShell.vue
├── NetworkIslandContent.vue
├── MusicIslandContent.vue
├── HardwareIslandContent.vue
├── NotificationIslandContent.vue
├── IslandStatusIndicator.vue
└── IslandContextMenu.ts
```

### 需要抽取的 Composable

```text
useIslandWindow.ts
useIslandPosition.ts
useIslandAnimation.ts
useIslandDrag.ts
useIslandDisplayMode.ts
useMusicController.ts
useSystemNotification.ts
```

### 拆分要求

- 内容组件不直接控制 Tauri 窗口
- 窗口尺寸和位置统一交给 `useIslandWindow`
- 右键菜单逻辑独立
- 定时器统一创建和销毁
- 展示内容通过单一状态决定，不再依赖大量布尔值交叉判断

---

## 6. 状态管理重构

### 6.1 建议引入 Pinia

Pinia 用于保存：

- 当前设置快照
- 当前系统状态快照
- 当前灵动岛展示状态
- 当前音乐状态
- 当前通知状态

Pinia 不负责：

- 直接采集网速
- 直接读取 Windows 通知
- 直接保存长期历史
- 作为跨窗口唯一真相源

### 6.2 统一应用快照

```ts
export interface AppSnapshot {
  settings: AppSettings;
  metrics: SystemMetrics;
  music: MusicSnapshot;
  notification?: NotificationSnapshot;
  island: IslandSnapshot;
  updatedAt: number;
}
```

主窗口和灵动岛都订阅同一份快照。

### 6.3 统一设置模型

```ts
export interface AppSettings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
  };
  island: {
    enabled: boolean;
    theme: 'black' | 'white';
    opacity: number;
    pinToTaskbar: boolean;
    positionLocked: boolean;
    glowBorder: boolean;
    silentMode: boolean;
    rotationEnabled: boolean;
  };
  modules: {
    musicEnabled: boolean;
    hardwareEnabled: boolean;
    notificationEnabled: boolean;
  };
  autostart: boolean;
}
```

---

## 7. IPC 通信重构

### 7.1 命令统一封装

```ts
export const appCommands = {
  getSnapshot: () => invoke<AppSnapshot>('get_app_snapshot'),
  updateSettings: (patch: DeepPartial<AppSettings>) =>
    invoke<AppSettings>('update_settings', { patch }),
  setIslandVisible: (visible: boolean) =>
    invoke<void>('set_island_visible', { visible }),
};
```

### 7.2 事件统一定义

```ts
export const APP_EVENTS = {
  SNAPSHOT_UPDATED: 'app.snapshot.updated',
  SETTINGS_UPDATED: 'app.settings.updated',
  ISLAND_DISPLAY_CHANGED: 'island.display.changed',
} as const;
```

### 7.3 事件 Payload 版本化

```ts
export interface SnapshotUpdatedEvent {
  version: 1;
  payload: AppSnapshot;
}
```

版本化可以降低以后字段升级时的兼容风险。

---

## 8. 定时任务重构

当前多个页面分别存在定时器。建议迁移到 Rust 统一调度。

### Rust 后台调度建议

| 数据 | 建议频率 |
|---|---:|
| 网速 | 1 秒 |
| CPU / 内存 | 1 秒 |
| 网络延迟 | 5 秒 |
| 音乐状态 | 1～2 秒 |
| Windows 通知 | 优先事件监听，无法监听时 2～3 秒轮询 |
| 更新检查 | 启动后一次，之后每天一次 |

### 要求

- 同一数据只采集一次
- 只在对应模块启用时采集
- 窗口隐藏时不应造成重复采集
- 所有调度任务支持停止和重新启动

---

## 9. 本地存储重构

### 9.1 设置数据

建议使用 Tauri Store 或 Rust 管理的 JSON 配置文件。

```text
app-settings.json
```

### 9.2 历史数据

重构阶段可以先为后续预留 SQLite，但不要求立即迁移所有数据。

建议预留：

```text
traffic_daily
system_events
notification_history
```

### 9.3 数据迁移

首次启动新版本时：

1. 读取旧 `localStorage`
2. 转换为新设置模型
3. 写入 Rust 配置存储
4. 保存迁移版本
5. 保留旧值一段版本周期
6. 确认稳定后再删除旧读取逻辑

---

## 10. Rust 模块拆分顺序

建议按风险从低到高拆分。

### 第一批

- `settings_service`
- `window_service`
- `metrics_service`

### 第二批

- `media_service`
- `notification_service`
- `update_service`

### 第三批

- 应用启动流程
- 托盘管理
- 后台调度器
- 全局状态中心

拆分过程中保持原有 Tauri Command 名称，等前端完成迁移后再统一重命名。

---

## 11. 工程规范

### 前端

建议增加：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run",
    "tauri": "tauri"
  }
}
```

建议工具：

- ESLint
- Prettier
- Vitest
- Vue Test Utils
- Pinia

### Rust

CI 中执行：

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

---

## 12. 版本管理

建议以 `tauri.conf.json` 的版本为发布版本来源，并通过脚本同步：

- `package.json`
- `Cargo.toml`
- `tauri.conf.json`

也可以在发布脚本中统一更新三个文件。

---

## 13. 分阶段实施计划

## 阶段 R1：工程基线

### 工作内容

- 切换 pnpm
- 统一版本号
- 添加 ESLint、Prettier、Vitest
- 添加 Rust 格式和 Clippy 检查
- 建立 `shared/ipc`
- 建立统一 TypeScript 类型

### 验收标准

- 项目正常启动
- 构建成功
- 现有功能无变化
- CI 能执行基础检查

---

## 阶段 R2：前端组件拆分

### 工作内容

- 拆分 `MainPanel.vue`
- 拆分 `WidgetIsland.vue`
- 抽取 Composable
- 引入 Pinia
- 保持旧事件兼容

### 验收标准

- 两个核心页面只负责布局和组合
- 单个业务组件职责明确
- 页面中不再散落大量 `localStorage`
- 所有定时器都能正常销毁

---

## 阶段 R3：Rust 模块拆分

### 工作内容

- 拆分 Window、Metrics、Media、Notification
- 精简 `lib.rs`
- 建立统一 AppState
- 建立后台 Scheduler

### 验收标准

- `lib.rs` 只保留启动与模块注册
- 系统数据由 Rust 统一采集
- 主窗口和灵动岛不再重复采集同一数据

---

## 阶段 R4：统一状态与通信

### 工作内容

- 建立 `AppSnapshot`
- 建立统一设置更新接口
- 建立统一状态广播事件
- 逐步移除旧事件

### 验收标准

- 两个窗口使用同一状态快照
- 设置修改后所有窗口立即同步
- 不再依赖多个功能开关事件互相修正

---

## 阶段 R5：存储迁移与稳定性

### 工作内容

- 设置迁移到 Rust 存储
- 流量统计预留 SQLite
- 增加异常恢复
- 增加日志
- 修复 GPU 临时实现

### 验收标准

- 升级后保留原用户设置
- 配置文件损坏时能够恢复默认值
- 长时间运行无明显定时器和监听器泄漏

---

## 14. 测试清单

### 功能回归

- [ ] 主窗口启动正常
- [ ] 灵动岛显示和隐藏正常
- [ ] 网速实时更新
- [ ] 网络状态灯正常
- [ ] 音乐信息正常
- [ ] 上一首、播放暂停、下一首正常
- [ ] 硬件信息正常
- [ ] Windows 通知正常
- [ ] 通知点击唤起应用正常
- [ ] 灵动岛展开和收缩动画正常
- [ ] 任务栏停靠正常
- [ ] 多显示器位置正常
- [ ] DPI 缩放正常
- [ ] 拖拽和位置锁定正常
- [ ] 轮换模式正常
- [ ] 静默模式正常
- [ ] 托盘菜单正常
- [ ] 开机自启动正常
- [ ] 检查更新正常
- [ ] 深色和浅色主题正常

### 稳定性

- [ ] 连续运行 8 小时无明显内存增长
- [ ] 主窗口反复打开关闭不重复注册监听器
- [ ] 灵动岛反复显隐不重复启动定时器
- [ ] 系统休眠恢复后状态正常
- [ ] 网络断开和恢复后状态正常
- [ ] Agent 功能未接入前不影响现有体验

---

## 15. 完成定义

满足以下条件后，现有项目重构阶段视为完成：

- 现有功能全部通过回归测试
- Vue 核心大组件完成拆分
- Rust 核心大文件完成模块拆分
- 系统状态由 Rust 统一采集和管理
- 跨窗口通信完成类型化
- 设置不再分散读写
- 版本号统一
- 前后端均具备基础测试和代码检查
- 已为 Agent Provider、事件历史和通知渠道预留扩展接口
