# CodePulse MVP Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立 CodePulse 首批可运行基础，覆盖工程脚手架、共享模型、MockAdapter、AgentStateHub、托盘、动态岛窗口和任务栏贴边弹窗。

**Architecture:** 主进程拥有唯一 AgentStateHub，适配器只产生统一事件，所有窗口通过 Preload 白名单 API 读取统一快照。渲染进程按窗口类型加载动态岛、贴边弹窗、任务中心或设置页，避免每个界面自行读取业务数据。

**Tech Stack:** Electron、Vue 3、TypeScript strict、Vite、Pinia、Vue Router、Element Plus、ECharts、SQLite、Electron Builder、Vitest。

---

### Task 1: 工程脚手架

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `electron-builder.yml`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.vitest.json`
- Create: `index.html`

**Step 1: 写入项目脚本和 TypeScript 配置**

建立 Electron 主进程、Preload 和 Vue 渲染进程共享的严格模式配置。

**Step 2: 安装依赖**

Run: `pnpm install`

Expected: 生成 `pnpm-lock.yaml`，不生成 `package-lock.json` 或 `yarn.lock`。

**Step 3: 验证脚手架**

Run: `pnpm run typecheck`

Expected: TypeScript 严格检查通过。

### Task 2: 共享模型与 IPC schema

**Files:**
- Create: `src/shared/types/agent.ts`
- Create: `src/shared/types/adapter.ts`
- Create: `src/shared/types/settings.ts`
- Create: `src/shared/types/window.ts`
- Create: `src/shared/ipc/channels.ts`
- Create: `src/shared/ipc/schema.ts`
- Create: `src/shared/constants/priority.ts`

**Step 1: 实现数据模型**

覆盖 `AgentProvider`、`AgentTask`、`AgentActivity`、`QuotaSnapshot`、`DisplaySettings`、`AgentStateSnapshot`。

**Step 2: 实现适配器接口**

覆盖 `start`、`stop`、`detect`、`refresh`、`subscribe`、`getCurrentTasks`、`getQuota`、`getConnectionStatus`、`dispose`。

**Step 3: 验证类型**

Run: `pnpm run typecheck`

Expected: 类型检查通过。

### Task 3: MockAdapter 与 AgentStateHub

**Files:**
- Create: `src/main/adapters/MockAdapter.ts`
- Create: `src/main/state/AgentStateHub.ts`
- Create: `src/main/state/priority.ts`
- Create: `src/main/state/snapshot.ts`
- Create: `src/main/state/AgentStateHub.test.ts`

**Step 1: 写状态核心测试**

覆盖优先级、事件去重、过期判断、额度不可用不显示 0%、适配器异常隔离。

**Step 2: 实现 MockAdapter**

输出稳定模拟任务、活动、额度和连接状态，支持订阅与刷新。

**Step 3: 实现 AgentStateHub**

统一接收适配器事件，维护任务表、活动表、额度表、连接状态、最高优先级任务和聚合文案。

**Step 4: 验证测试**

Run: `pnpm run test`

Expected: 状态核心测试通过。

### Task 4: 桌面外壳

**Files:**
- Create: `src/main/index.ts`
- Create: `src/main/bootstrap/appLifecycle.ts`
- Create: `src/main/windows/windowManager.ts`
- Create: `src/main/windows/popupPosition.ts`
- Create: `src/main/tray/trayManager.ts`
- Create: `src/main/ipc/registerIpc.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/codePulseApi.ts`

**Step 1: 实现单实例与生命周期**

应用启动时获取单实例锁，重复启动时聚焦任务中心。

**Step 2: 实现窗口管理**

创建动态岛、贴边弹窗、任务中心和设置窗口，按查询参数加载对应 Vue 应用。

**Step 3: 实现贴边弹窗定位**

按托盘图标、鼠标点、显示器 `bounds` 和 `workArea` 计算弹窗位置。

**Step 4: 实现托盘**

按快照状态生成不同形态图标，菜单包含规划项。

**Step 5: 实现 Preload 白名单 API**

只暴露 `window.codePulse`，不暴露 `ipcRenderer`、文件系统、Shell 或 Node.js API。

**Step 6: 验证构建**

Run: `pnpm run build`

Expected: 主进程、Preload 和渲染进程构建通过。

### Task 5: 首批渲染界面

**Files:**
- Create: `src/renderer/main.ts`
- Create: `src/renderer/App.vue`
- Create: `src/renderer/stores/stateStore.ts`
- Create: `src/renderer/apps/island/IslandApp.vue`
- Create: `src/renderer/apps/popup/PopupApp.vue`
- Create: `src/renderer/apps/center/CenterApp.vue`
- Create: `src/renderer/apps/settings/SettingsApp.vue`
- Create: `src/renderer/components/TaskCard.vue`
- Create: `src/renderer/styles/base.css`

**Step 1: 实现统一状态 store**

页面启动后通过 `state.getSnapshot()` 获取初始快照，并通过 `state.subscribe()` 接收广播。

**Step 2: 实现动态岛三态界面**

收起、标准和展开状态共享同一快照，等待或失败状态显示持续提醒样式。

**Step 3: 实现任务栏贴边弹窗**

展示总体状态、运行任务、待处理任务、额度和任务中心入口。

**Step 4: 实现任务中心基础页**

展示筛选入口、任务详情、额度和连接状态。

**Step 5: 验证**

Run: `pnpm run typecheck`
Run: `pnpm run build`

Expected: 类型检查和构建通过。
