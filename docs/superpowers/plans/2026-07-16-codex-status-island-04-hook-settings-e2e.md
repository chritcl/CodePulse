# 阶段四：Hook 配置、设置页与端到端验收

## 目标

让用户通过设置页检查、预览、安装、修复和卸载 CodePulse 自己管理的用户层 Hook，并完成真实 CLI 与 App 验收。

这一阶段只实现安全的单次文件操作流程，不建立通用安装器、跨进程事务系统或自动恢复服务。

## 建议文件

- src-tauri/src/codex/integration.rs：检查、预览和动作实现；
- src-tauri/src/codex/config.rs：JSON 与 TOML 的完整解析和精确条目修改；
- src-tauri/src/codex/bridge_install.rs：Bridge 写入与最小可运行检查；
- src-tauri/src/commands/codex_integration_commands.rs：检查、预览和确认命令；
- src/shared/ipc/contracts.ts：集成状态与预览 DTO；
- src/shared/ipc/commands.ts：前端命令封装；
- src/composables/useCodexIntegration.ts：异步操作和旧结果保护；
- src/components/dashboard/CodexIntegrationSettings.vue：设置卡与确认界面；

## 任务 1：实现只读检查

检查只读取用户层 %USERPROFILE%\.codex：

- hooks.json 和 config.toml 是否存在、能否完整解析；
- Hooks 是否启用；
- CodePulse 标记是否不存在、正确、重复、损坏或过期；
- 固定 Bridge 是否存在且满足最小可运行条件。

当两个表示同时存在且无法安全选择、配置由外部策略管理或文件无法解析时，返回清楚的只读状态和人工处理说明。不要扫描仓库、插件或企业配置。

## 任务 2：生成预览

安装、修复和卸载均生成预览，但不写盘。预览必须明确：

- 将使用或创建的配置文件；
- 将新增、修复或删除的 CodePulse 标记；
- Bridge 目标路径；
- 需要用户手动处理的冲突或前置条件。

预览记录目标文件摘要，仅在当前应用进程短期使用。确认操作前必须重新读取并比较该摘要。

## 任务 3：实现安装与修复

确认后按以下顺序执行：

1. 重新检查预览摘要；
2. 写入并验证 Bridge；
3. 完整解析配置并只修改 CodePulse 标记；
4. 创建时间戳备份；
5. 写入同目录临时文件并重新解析；
6. 原子替换配置；
7. 启动服务并返回等待真实事件的状态。

文件在预览后变化、Bridge 写入失败、解析失败或原子替换失败时立即停止。不得自动覆盖外部更改，也不得尝试恢复整个用户配置。

## 任务 4：实现卸载

确认后重新检查摘要，精确移除 CodePulse 标记，按同样的备份、临时校验和原子替换流程写回配置。

配置修改成功后停止服务并尽力删除未被引用的 Bridge。删除失败只提示待清理，不回滚配置。

## 任务 5：设置卡与异步安全

设置卡显示检查状态、预览内容、确认按钮和可理解的失败提示。异步请求要防止组件卸载、重复点击或旧检查结果覆盖新结果。

Hooks 未启用时只提示用户在 Codex 中手动启用。显示偏好仍通过现有 settings store 保存，不能成为修改 Hooks 的快捷开关。

## 任务 6：自动化与真实验收

自动测试使用临时目录和夹具，不读取或写入真实用户配置。至少覆盖：

- JSON 与 TOML 的正确条目修改；
- 其他用户 Hook 保留；
- 重复或损坏 CodePulse 标记；
- 预览后文件变更；
- Bridge 写入失败、临时文件校验失败和原子替换失败；
- 精确卸载及 Bridge 删除失败；
- 设置页加载、预览、确认、取消和请求竞态。

真实验收分别运行：

1. Windows 原生 Codex CLI 的真实任务、等待授权、完成或失败；
2. Codex App 原生 PowerShell 模式的真实任务；
3. 用户已有其他 Hook 的安装与卸载；
4. CodePulse 更新后的修复。

CLI 或 App 环境不可用时如实记录环境阻塞，不用模拟请求冒充真实兼容验收。

## 阶段完成门槛

- 用户可以完成检查、预览、安装、修复和卸载；
- 所有实际写入都经过重新检查、备份、临时解析和原子替换；
- 任何失败不会覆盖用户其他 Hook；
- 设置页与 Widget 状态在安装后显示等待事件，首条真实事件后才显示正常运行；
- 自动测试、前端构建与 Rust 测试通过。

## 实施记录（2026-07-29）

已完成：

- 用户层 `hooks.json` 与 `config.toml` 的只读检查、预览、摘要复核、备份、临时校验、原子替换和精确卸载；
- 固定应用数据目录 Bridge 的临时副本验证、原子替换及未引用时的尽力清理；
- Rust IPC、异步安全的前端 composable、设置卡、确认界面和 Widget 显示偏好同步；
- Bridge 发布构建脚本与 Tauri 资源配置。Bridge 二进制仅在专用 `bridge-bin` 特性下编译；Tauri `build.runner.args` 明确传入 `--bin codepulse`，因此没有添加 Cargo `default-run`，日常 `pnpm tauri dev` 与构建都会选择主程序。

自动验证已覆盖 JSON/TOML 其他 Hook 保留、重复标记识别、无效配置拒写、预览后变更拒绝、Bridge 验证失败、Bridge 删除失败、引用保留、设置页请求竞态与偏好监听清理。

尚待人工验收：真实 `%USERPROFILE%\.codex` 配置、Windows 原生 Codex CLI 和 Codex App。开发与自动化验证未读取或写入真实用户层配置；只有获得用户明确确认后才能进行这些操作。
