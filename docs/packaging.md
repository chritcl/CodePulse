# CodePulse 打包说明

## 本地构建

```powershell
pnpm run build
```

该命令会依次执行类型检查、单元测试、主进程编译和渲染进程构建。

## 安装包生成

```powershell
pnpm run dist
```

打包输出目录为 `release/`。当前配置使用 Electron Builder 和 NSIS，安装包支持选择安装目录。

## 注意事项

1. 不提交 `dist/`、`release/`、`node_modules/`。
2. 不创建 `package-lock.json` 或 `yarn.lock`。
3. 后续添加原生 SQLite 依赖时，需要补充 Electron 原生模块重建流程。
