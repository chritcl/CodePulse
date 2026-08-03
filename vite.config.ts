import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// @ts-expect-error 配置运行在 Node.js 环境中
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [vue()],

  // 路径别名
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },

  // 保留 Rust 错误输出，方便在 Tauri 开发与构建时排查问题
  clearScreen: false,
  // Tauri 使用固定端口，端口占用时应直接失败
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Rust 源码由 Cargo 监听，避免 Vite 重复监听
      ignored: ['**/src-tauri/**'],
    },
  },
}));
