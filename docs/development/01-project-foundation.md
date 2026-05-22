# 01 基础工程

## 目标

建立 Tauri 2 + React 18 + Vite + TypeScript + Tailwind CSS 的基础工程，为后续桌面能力、API 调用和本地存储提供稳定边界。

## 不做什么

- 不在本阶段接入 DeepSeek、Azure、FFmpeg 或 SQLite。
- 不做复杂状态管理。
- 不做发布打包优化。

## 用户流程

1. 用户启动应用。
2. 应用展示主窗口和基础导航。
3. 前端可调用一个 Rust command 验证前后端通信正常。

## 技术设计

- 前端使用 React 18、Vite、TypeScript。
- 样式使用 Tailwind CSS。
- 桌面壳使用 Tauri 2。
- Rust 后端通过 commands 暴露能力。
- 前端建立统一 `invokeCommand` 包装，统一错误转换。

## 数据结构

```ts
type AppError = {
  code: string;
  message: string;
  detail?: string;
};

type HealthCheckResult = {
  ok: true;
  version: string;
  platform: string;
};
```

## 任务拆分

- F-001：初始化 Tauri 2 + React + Vite + TypeScript 工程。
- F-002：配置 Tailwind CSS、PostCSS 和全局样式入口。
- F-003：建立目录结构：`src/app`、`src/components`、`src/features`、`src/lib`、`src/styles`。
- F-004：实现基础路由和空白页面：批改、媒体、语料、设置。
- F-005：实现 Rust `health_check` command。
- F-006：实现前端 `invokeCommand` 包装和错误类型。
- F-007：建立基础 lint、typecheck、test 命令。

## 验收标准

- `pnpm dev` 可启动前端。
- Tauri 开发模式可打开桌面窗口。
- 前端可调用 `health_check` 并显示成功状态。
- TypeScript 编译通过。
- Tailwind 样式生效。

## 测试建议

- 单元测试：`invokeCommand` 对成功、失败、未知错误的处理。
- 集成测试：调用 `health_check`。
- 手动测试：应用启动、路由切换、窗口关闭。

## 风险与后续扩展

- Tauri 2 插件 API 与 Tauri 1 差异较大，后续新增 shell、fs、dialog 能力时逐项引入。
- 首版不引入重型状态管理，等跨模块状态增多后再评估 Zustand 或 Jotai。
