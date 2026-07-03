# CodePulse 开发规范与项目指南

## 项目概况

**NetSpeed Dynamic Pro (NSD)** — 基于 Tauri 2 + Vue 3 + Rust 的 Windows 桌面灵动岛组件。实时显示网速、支持多平台音乐控制、系统通知接收、硬件监控，支持置于任务栏及智能轮换模式。

- **版本**: 2.3.7
- **标识**: `com.ryen.nsd`
- **仓库**: https://github.com/GEORGEWWWU/NetSpeed-Dynamic
- **协议**: MIT

---

## 项目结构

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
| 图表 | ECharts | 6.x |
| 图标 | Lucide Vue Next | 0.577 |
| 系统监控 | sysinfo (Rust) | 0.30 |
| 异步运行时 | Tokio (Rust) | 1.x |
| HTTP 客户端 | reqwest (Rust) | 0.12 |
| 媒体控制 | Windows SMTC API | windows 0.58 |
| Windows API | windows-sys + winapi | 0.59 / 0.3 |
| 本地存储 | localStorage | — |

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

### Rust 后端

- Tauri 命令使用 `#[tauri::command]` 标注。
- 全局状态使用 `static` + `Mutex` / `AtomicU32` / `AtomicBool`。
- Tauri 管理状态通过 `State<T>` 注入。
- 异步任务使用 `tokio::spawn` 或 `std::thread::spawn`。
- Win32 API 调用封装在 `unsafe` 块中，添加注释说明安全性。

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
├── main.ts
├── App.vue
├── router/
│   └── index.ts
├── stores/                     # Pinia stores
│   ├── settings.ts             # 主题、透明度、自启等设置
│   ├── network.ts              # 网速、流量统计
│   ├── music.ts                # 播放状态、歌曲信息
│   ├── hardware.ts             # CPU/GPU/RAM 数据
│   ├── notifications.ts        # 消息通知队列
│   └── agent.ts                # AI agent 状态 (未来)
├── composables/                # 可复用逻辑
│   ├── useTauriCommand.ts      # 统一的 Tauri invoke 封装
│   ├── useNetworkSpeed.ts      # 网速轮询逻辑
│   ├── useMusicControl.ts      # 音乐控制逻辑
│   ├── useHardwareMonitor.ts   # 硬件监控轮询
│   ├── useNotification.ts      # 通知监听逻辑
│   ├── useIslandAnimation.ts   # 灵动岛动画控制
│   └── useTheme.ts             # 主题切换
├── components/                 # 可复用 UI 组件
│   ├── island/                 # 灵动岛相关
│   │   ├── IslandContainer.vue # 岛容器 + 拖拽 + 动画
│   │   ├── SpeedDisplay.vue    # 网速展示
│   │   ├── MusicPlayer.vue     # 音乐控制
│   │   ├── HardwareStats.vue   # 硬件监控
│   │   ├── NotificationCard.vue# 通知卡片
│   │   └── AgentStatus.vue     # AI agent 状态 (未来)
│   ├── panel/                  # 控制台相关
│   │   ├── PanelHeader.vue     # 头部品牌 + 开关
│   │   ├── SpeedCard.vue       # 实时网速卡片
│   │   ├── SettingsCard.vue    # 设置面板
│   │   ├── StatsCard.vue       # 流量统计
│   │   └── DynamicIslandSettings.vue # 灵动岛设置
│   └── shared/                 # 通用组件
│       ├── ToggleSwitch.vue
│       ├── ThemeSelect.vue
│       └── ChartWrapper.vue
├── views/
│   ├── MainPanel.vue           # 组合 panel/* 组件 (~100 行)
│   └── WidgetIsland.vue        # 组合 island/* 组件 (~100 行)
├── types/                      # TypeScript 类型定义
│   ├── network.ts
│   ├── music.ts
│   ├── hardware.ts
│   └── tauri-commands.ts       # Tauri command 参数/返回值类型
├── utils/                      # 工具函数
│   ├── format.ts               # 速度格式化、单位转换
│   └── storage.ts              # localStorage 封装
└── assets/
```

### Rust 目标结构

```
src-tauri/src/
├── main.rs                     # 入口，调用 lib::run()
├── lib.rs                      # run() 函数 + plugin 注册
├── commands/                   # Tauri command 处理函数
│   ├── mod.rs
│   ├── media.rs                # 音乐播放控制 (SMTC)
│   ├── network.rs              # 网速、延迟、流量
│   ├── hardware.rs             # CPU/GPU/RAM 监控
│   ├── notification.rs         # 系统通知捕获
│   ├── window.rs               # 窗口管理 (置顶、位置、大小)
│   └── cover.rs                # 专辑封面获取
├── state/                      # 应用状态
│   ├── mod.rs
│   ├── app_state.rs            # AppState 结构体
│   └── animation_state.rs      # 动画状态原子变量
├── media/                      # 媒体控制封装
│   ├── mod.rs
│   └── smtc.rs                 # Windows SMTC API 封装
├── system/                     # 系统交互
│   ├── mod.rs
│   ├── tray.rs                 # 系统托盘
│   ├── autostart.rs            # 开机自启
│   └── dwm.rs                  # DWM 窗口效果
├── animation/                  # 动画引擎
│   ├── mod.rs
│   └── spring.rs               # 弹簧物理动画
└── error.rs                    # 统一错误类型
```

### 重构优先级

| 优先级 | 任务 | 理由 |
|--------|------|------|
| P0 | 引入 ESLint + Prettier + clippy | 代码质量基线 |
| P0 | 定义 TypeScript 类型系统 | 为拆分组件打基础 |
| P1 | 前端拆分组件 + composables | 当前巨型文件无法维护 |
| P1 | Rust 拆分模块 | 同上 |
| P1 | 引入 Pinia 状态管理 | 状态散落，窗口间同步困难 |
| P2 | 引入 vitest + cargo test | 防止重构引入回归 |
| P2 | 统一 WinAPI crate | 减少编译时间和二进制体积 |
| P2 | 统一错误处理 | 提高健壮性 |
| P3 | CI/CD 流程 | 自动化质量保障 |
| P3 | AI Agent 监控功能 | 新功能扩展 |

---

## 本地开发

### 前置依赖

- Node.js >= 18
- Rust >= 1.70
- Tauri 2 CLI

### 常用命令

```powershell
# 安装依赖
npm install

# 开发模式 (前端 + Rust 热重载)
npm run tauri dev

# 仅前端构建检查
npm run build

# 类型检查
npx vue-tsc --noEmit

# Rust 构建
cd src-tauri; cargo build

# Rust 测试 (待配置)
cd src-tauri; cargo test

# 前端测试 (待配置)
npx vitest run
```

### 构建发布

```powershell
npm run tauri build
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

## 审查要点

代码审查时重点关注：

1. **巨型文件**: 新增代码是否加剧了 MainPanel.vue / WidgetIsland.vue / lib.rs 的膨胀。
2. **状态管理**: 新增状态是否考虑了窗口间同步的需求。
3. **Win32 安全性**: `unsafe` 块是否有充分注释和错误处理。
4. **内存泄漏**: 定时器、事件监听器、Tauri event listener 是否在组件卸载时清理。
5. **性能**: 灵动岛 120 FPS 动画期间，前端是否有不必要的重渲染。
6. **编码问题**: 文件是否为 UTF-8 without BOM。
