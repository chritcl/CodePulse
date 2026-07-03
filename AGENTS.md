# CodePulse 开发规范与项目指南

## 项目概况

**NetSpeed Dynamic Pro (NSD)** — 基于 Tauri 2 + Vue 3 + Rust 的 Windows 桌面灵动岛组件。实时显示网速、支持多平台音乐控制、系统通知接收、硬件监控，支持置于任务栏及智能轮换模式。

- **版本**: 2.3.7
- **标识**: `com.ryen.nsd`
- **仓库**: https://github.com/GEORGEWWWU/NetSpeed-Dynamic
- **协议**: MIT

---

## 项目结构

### 当前结构

```
CodePulse/
├── src/                        # 前端 (Vue 3 + TypeScript)
│   ├── App.vue                 # 根组件，仅 <router-view />
│   ├── main.ts                 # 应用入口
│   ├── router/index.ts         # 路由配置 (2 条路由)
│   ├── views/
│   │   ├── MainPanel.vue       # 主控制台 (~2010 行，设置/统计/音乐)
│   │   └── WidgetIsland.vue    # 灵动岛悬浮窗 (~1764 行)
│   └── assets/                 # 静态资源 (图标、截图)
├── src-tauri/                  # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── main.rs             # Rust 入口，调用 lib::run()
│   │   └── lib.rs              # 全部后端逻辑 (~726 行，单文件)
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置 (双窗口: main + widget)
│   └── capabilities/           # Tauri v2 权限声明
├── vite.config.ts              # Vite 配置
├── tsconfig.json               # TypeScript 配置
├── package.json                # 前端依赖
└── index.html                  # Vite 入口 HTML
```

### 路由结构

| 路径 | 组件 | 用途 |
|------|------|------|
| `/` | `MainPanel.vue` | 主控制台窗口 (700x550) |
| `/widget` | `WidgetIsland.vue` | 灵动岛悬浮窗 (210x36, 无边框, 透明, 置顶) |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | 2.x |
| 前端框架 | Vue 3 | 3.5 |
| 构建工具 | Vite | 6.x |
| 路由 | Vue Router | 5.x |
| 状态管理 | Pinia | 2.x (待引入) |
| 图表 | ECharts | 6.x |
| 图标 | Lucide Vue Next | 0.577 |
| 系统监控 | sysinfo (Rust) | 0.30 |
| 异步运行时 | Tokio (Rust) | 1.x |
| HTTP 客户端 | reqwest (Rust) | 0.12 |
| 媒体控制 | Windows SMTC API | windows 0.58 |
| Windows API | windows-sys + winapi | 0.59 / 0.3 |
| 本地存储 | localStorage | — (待迁移到 Rust 存储) |

---

## 代码规范

### 通用规则

1. **编码**: 所有文本文件必须 UTF-8 without BOM，中文直接输出，禁止 `\uXXXX` 转义。
2. **语言**: 代码注释、commit message、PR 描述均使用中文。
3. **风格**: 优先遵循项目已有代码风格，不做无关重构。
4. **平台**: 仅支持 Windows，可大胆使用 Win32 API，不需要跨平台兼容。
5. **提交**: commit message 结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

### TypeScript / Vue 前端

- Vue 3 Composition API (`<script setup lang="ts">`)。
- 响应式数据使用 `ref` / `computed` / `watch`。
- 窗口间通信使用 Tauri 事件系统 (`emit` / `listen`)。
- Tauri 命令调用使用 `@tauri-apps/api` 的 `invoke`。
- CSS 直接写在 Vue SFC 的 `<style scoped>` 中，无 CSS 框架。
- 组件文件不超过 300 行，单个 composable 不超过 200 行。

### Rust 后端

- Tauri 命令使用 `#[tauri::command]` 标注。
- 全局状态使用 `static` + `Mutex` / `AtomicU32` / `AtomicBool`。
- Tauri 管理状态通过 `State<T>` 注入。
- 异步任务使用 `tokio::spawn` 或 `std::thread::spawn`。
- Win32 API 调用封装在 `unsafe` 块中，添加注释说明安全性。
- 模块文件不超过 300 行，每个函数不超过 50 行。

---

## 重构计划

> 详细计划参见 `docs/NetSpeed-Dynamic-现有项目重构计划.md`

### 重构原则

1. **不改变现有功能**: 重构过程中所有现有功能必须继续可用。
2. **Rust 作为运行状态源**: Rust 负责系统数据、窗口控制和长期运行状态；Vue 负责渲染和临时交互状态；Pinia 只作为前端快照缓存。
3. **所有通信必须类型化**: 所有 Tauri 命令、事件和 Payload 都应有统一定义。
4. **先兼容，再替换**: 重构过程中可暂时保留旧事件，在新模块稳定后逐步移除。
5. **每个阶段都可独立运行**: 每个重构阶段结束后，项目必须能够正常启动、构建和使用。

### 分阶段实施

#### 阶段 R1：工程基线

- 切换 pnpm
- 统一版本号
- 添加 ESLint、Prettier、Vitest
- 添加 Rust 格式和 Clippy 检查
- 建立 `shared/ipc`
- 建立统一 TypeScript 类型

#### 阶段 R2：前端组件拆分

- 拆分 `MainPanel.vue` → `DashboardView.vue` + 子组件
- 拆分 `WidgetIsland.vue` → `IslandView.vue` + 子组件
- 抽取 Composable
- 引入 Pinia
- 保持旧事件兼容

#### 阶段 R3：Rust 模块拆分

- 拆分 `lib.rs` → `commands/`, `state/`, `media/`, `system/`, `animation/`
- 精简 `lib.rs` 只保留启动与模块注册
- 建立统一 AppState
- 建立后台 Scheduler

#### 阶段 R4：统一状态与通信

- 建立 `AppSnapshot` 统一快照
- 建立统一设置更新接口
- 建立统一状态广播事件
- 逐步移除旧事件

#### 阶段 R5：存储迁移与稳定性

- 设置迁移到 Rust 存储
- 流量统计预留 SQLite
- 增加异常恢复和日志
- 修复 GPU 临时实现

---

## 架构现状与重构方向

### 当前问题 (已知技术债)

> 以下问题是项目现状的真实记录，重构时需逐步解决。

#### 1. 前端巨型单文件

- `MainPanel.vue` 约 2010 行，`WidgetIsland.vue` 约 1764 行。
- 模板、逻辑、样式全部耦合在一个文件中。
- 没有提取任何 composables / hooks。
- 没有提取任何子组件。
- **重构目标**: 拆分为独立组件 + composables，每个文件不超过 300 行。

#### 2. Rust 后端单文件

- 全部逻辑集中在 `lib.rs` 一个文件 (~726 行)。
- 13 个 Tauri command、全局状态、Win32 调用、动画逻辑全部混杂。
- **重构目标**: 按职责拆分为独立模块 (`commands/`, `state/`, `media/`, `system/`, `animation/`)。

#### 3. 缺少状态管理

- 前端没有 Pinia / Vuex，状态散落在各组件的 `ref` 中。
- 使用 `localStorage` 直接读写，没有抽象层。
- **重构目标**: 引入 Pinia，按领域建立 store (settings, network, music, hardware, notifications)。

#### 4. 零测试覆盖

- 整个项目没有任何测试文件 (前端和 Rust 都没有)。
- 没有配置 vitest / cargo test。
- **重构目标**: 关键逻辑必须有测试覆盖，至少包括 Tauri command 的单元测试和核心 composables 的测试。

#### 5. 缺少工程化工具

- 没有 ESLint / Prettier 配置。
- 没有 Rust clippy / rustfmt 配置。
- 没有 CI/CD 流程。
- 没有 pre-commit hooks。
- **重构目标**: 引入 lint + format + 类型检查的完整工具链。

#### 6. WinAPI crate 混用

- 同时依赖 `winapi` (0.3) 和 `windows` (0.58) + `windows-sys` (0.59) 三个 crate。
- 功能重叠，增加编译时间和二进制体积。
- **重构目标**: 统一到 `windows` crate，移除 `winapi` 和 `windows-sys`。

#### 7. 错误处理不一致

- Rust 侧部分 command 返回 `Result`，部分直接 `unwrap`。
- 前端调用 Tauri command 时缺少统一的错误处理策略。
- **重构目标**: 定义统一的错误类型，所有 command 返回 `Result<T, AppError>`。

### 未来功能规划

> 以下是计划新增的功能模块，设计架构时需要预留扩展空间。

#### AI Agent 监控面板

- 监控 AI agent 的运行状态 (空闲、执行中、等待确认、完成、失败)。
- 呈现任务生命周期变化和状态流转。
- 实时显示 agent 输出流和中间结果。
- 可能需要 WebSocket / SSE 连接外部 AI 服务。
- **架构影响**: 需要独立的 agent store、agent 状态机、事件流处理层。

#### 更多监控维度

- GPU 详细监控 (温度、显存、功耗)。
- 磁盘 I/O 监控。
- 进程级网络流量监控。
- **架构影响**: Rust 侧需要可插拔的监控 provider 抽象。

#### 灵动岛功能扩展

- 更多岛模式 (天气、日程、倒计时等)。
- 自定义岛内容和布局。
- 插件化岛内容系统。
- **架构影响**: 前端需要岛内容注册机制和动态组件加载。

---

## 架构重构指引

### 前端目标结构

```
src/
├── app/
│   ├── bootstrap.ts            # 应用启动引导
│   └── router/
├── windows/
│   ├── dashboard/
│   │   ├── DashboardView.vue   # 主控制台 (~100 行)
│   │   └── components/
│   │       ├── DashboardHeader.vue
│   │       ├── RealtimeNetworkCard.vue
│   │       ├── TrafficStatisticsCard.vue
│   │       ├── GeneralSettingsCard.vue
│   │       ├── IslandSettingsPanel.vue
│   │       ├── MusicSettings.vue
│   │       ├── NotificationSettings.vue
│   │       ├── HardwareSettings.vue
│   │       ├── UpdateChecker.vue
│   │       └── AppDialog.vue
│   └── island/
│       ├── IslandView.vue      # 灵动岛 (~100 行)
│       └── components/
│           ├── IslandShell.vue
│           ├── NetworkIslandContent.vue
│           ├── MusicIslandContent.vue
│           ├── HardwareIslandContent.vue
│           ├── NotificationIslandContent.vue
│           ├── IslandStatusIndicator.vue
│           └── IslandContextMenu.ts
├── modules/
│   ├── network/
│   │   ├── composables/
│   │   │   └── useNetworkSpeed.ts
│   │   └── types.ts
│   ├── hardware/
│   │   ├── composables/
│   │   │   └── useHardwareMonitor.ts
│   │   └── types.ts
│   ├── music/
│   │   ├── composables/
│   │   │   ├── useMusicControl.ts
│   │   │   └── useMusicController.ts
│   │   └── types.ts
│   ├── notifications/
│   │   ├── composables/
│   │   │   └── useSystemNotification.ts
│   │   └── types.ts
│   ├── settings/
│   │   ├── composables/
│   │   │   ├── useAppTheme.ts
│   │   │   ├── useAppVersion.ts
│   │   │   ├── useUpdateChecker.ts
│   │   │   ├── useAutostart.ts
│   │   │   └── useIslandSettings.ts
│   │   └── types.ts
│   └── island/
│       ├── composables/
│       │   ├── useIslandWindow.ts
│       │   ├── useIslandPosition.ts
│       │   ├── useIslandAnimation.ts
│       │   ├── useIslandDrag.ts
│       │   └── useIslandDisplayMode.ts
│       └── types.ts
├── stores/                     # Pinia stores
│   ├── app.store.ts            # 应用全局状态
│   ├── settings.store.ts       # 设置快照
│   ├── island.store.ts         # 灵动岛状态
│   └── app.d.ts                # AppSnapshot 类型定义
├── shared/
│   ├── ipc/
│   │   ├── commands.ts         # Tauri 命令封装
│   │   ├── events.ts           # 事件常量定义
│   │   └── contracts.ts        # 事件 Payload 类型
│   ├── components/             # 通用组件
│   │   ├── ToggleSwitch.vue
│   │   ├── ThemeSelect.vue
│   │   └── ChartWrapper.vue
│   ├── types/                  # 通用类型定义
│   └── utils/                  # 工具函数
│       ├── format.ts           # 速度格式化、单位转换
│       └── storage.ts          # localStorage 封装 (兼容层)
├── views/                      # 兼容层，逐步迁移到 windows/
│   ├── MainPanel.vue
│   └── WidgetIsland.vue
├── App.vue
├── main.ts
└── assets/
```

### Rust 目标结构

```
src-tauri/src/
├── main.rs                     # 入口，调用 lib::run()
├── lib.rs                      # run() 函数 + plugin 注册 (精简版)
├── app/
│   ├── bootstrap.rs            # 应用启动流程
│   ├── state.rs                # 全局 AppState
│   └── scheduler.rs            # 后台任务调度器
├── commands/
│   ├── mod.rs
│   ├── settings_commands.rs    # 设置相关命令
│   ├── system_commands.rs      # 系统监控命令
│   ├── media_commands.rs       # 媒体控制命令
│   └── window_commands.rs      # 窗口管理命令
├── domain/
│   ├── mod.rs
│   ├── settings.rs             # 设置领域模型
│   ├── metrics.rs              # 指标领域模型
│   ├── media.rs                # 媒体领域模型
│   └── notification.rs         # 通知领域模型
├── services/
│   ├── mod.rs
│   ├── settings_service.rs     # 设置服务
│   ├── metrics_service.rs      # 指标采集服务
│   ├── media_service.rs        # 媒体控制服务
│   ├── notification_service.rs # 通知服务
│   └── window_service.rs       # 窗口管理服务
├── platform/
│   └── windows/
│       ├── mod.rs
│       ├── media.rs            # Windows SMTC API
│       ├── notifications.rs    # Windows 通知 API
│       ├── process.rs          # 进程管理
│       └── window.rs           # 窗口 API
├── storage/
│   ├── mod.rs
│   ├── settings_store.rs       # 设置持久化
│   └── history_store.rs        # 历史数据存储
└── error.rs                    # 统一错误类型
```

### 重构优先级

| 阶段 | 优先级 | 任务 | 理由 |
|------|--------|------|------|
| R1 | P0 | 工程基线 | 建立代码质量基线 |
| R2 | P1 | 前端组件拆分 | 当前巨型文件无法维护 |
| R3 | P1 | Rust 模块拆分 | 同上 |
| R4 | P1 | 统一状态与通信 | 状态散落，窗口间同步困难 |
| R5 | P2 | 存储迁移与稳定性 | 防止重构引入回归 |

---

## 本地开发

### 前置依赖

- Node.js >= 18
- Rust >= 1.70
- Tauri 2 CLI
- pnpm (推荐)

### 常用命令

```powershell
# 安装依赖
pnpm install

# 开发模式 (前端 + Rust 热重载)
pnpm tauri dev

# 仅前端构建检查
pnpm build

# 类型检查
pnpm typecheck

# Lint 检查
pnpm lint

# 格式化
pnpm format

# 前端测试
pnpm test

# Rust 构建
cd src-tauri; cargo build

# Rust 测试
cd src-tauri; cargo test

# Rust 格式检查
cd src-tauri; cargo fmt --check

# Rust Clippy 检查
cd src-tauri; cargo clippy --all-targets --all-features -- -D warnings
```

### 构建发布

```powershell
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

---

## 关键约定

### 窗口间通信

两个窗口 (main + widget) 通过 Tauri 事件系统通信，不共享 Vue 状态：

- `main` 窗口发送设置变更事件 → `widget` 窗口监听并响应。
- `widget` 窗口发送状态事件 → `main` 窗口监听并更新 UI。
- 事件名称使用 `kebab-case`，如 `settings-changed`、`widget-toggle`。

### 灵动岛动画

动画由 Rust 侧驱动 (弹簧物理模型，约 120 FPS，400ms 周期)，前端通过 Tauri command 触发，通过 `set_window_bounds` 命令实时更新窗口位置和大小。

### 封面获取策略

多源降级：SMTC 本地缩略图 → Apple Music API → NetEase API → Deezer API → SVG 渐变兜底。最近 50 首封面缓存在内存中。

### 通知过滤

自动过滤微信通知 (`WeChat` / `WeChatService`)，通过 `AUMID` 识别。其他通知通过协议唤起对应应用。

---

## 测试清单

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

## 审查要点

代码审查时重点关注：

1. **巨型文件**: 新增代码是否加剧了 MainPanel.vue / WidgetIsland.vue / lib.rs 的膨胀。
2. **状态管理**: 新增状态是否考虑了窗口间同步的需求。
3. **Win32 安全性**: `unsafe` 块是否有充分注释和错误处理。
4. **内存泄漏**: 定时器、事件监听器、Tauri event listener 是否在组件卸载时清理。
5. **性能**: 灵动岛 120 FPS 动画期间，前端是否有不必要的重渲染。
6. **编码问题**: 文件是否为 UTF-8 without BOM。
