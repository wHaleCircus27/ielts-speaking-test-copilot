# 11 MVP 5 附加改进计划

## 目标

在 MVP 5 原有稳定化任务（R-401~R-406）基础上，针对项目检视中发现的架构和工程问题，制定可落地的改进方案。改进以提升可维护性和开发效率为核心，不引入新功能。

## 不做什么

- 不改变现有功能行为和用户体验。
- 不引入新的外部依赖或框架（如 Redux、Zustand）。
- 不做 Playwright E2E 测试（后续扩展）。
- 不做 Tauri 打包和分发流程。
- 不做 sqlite-vec 迁移（已记录为后续扩展）。

## 改进项 A：App.tsx 组件拆分

### 问题

`src/app/App.tsx` 当前 2171 行，承担路由、状态管理、业务逻辑、UI 渲染等全部职责。单文件认知负担过高，难以独立测试和复用。

### 拆分方案

#### 第一层：抽取自定义 Hooks

| Hook | 职责 | 来源逻辑 |
|------|------|----------|
| `useGradingWorkflow` | 批改状态、DeepSeek 调用、RAG 注入 | 批改相关 state + grade 函数 |
| `useMediaWorkflow` | 媒体导入、转码、播放器状态 | 媒体相关 state + transcode 函数 |
| `useTranscriptPlayback` | transcript tokens、当前词、播放同步 | transcript 相关 state + seek/highlight |
| `useSessionHistory` | 历史记录 CRUD、localStorage 持久化 | history 相关 state + save/load |
| `useAppConfig` | 配置读取、主题切换、字体设置 | config 相关 state + getAppConfig |

目标目录：`src/hooks/`

#### 第二层：抽取 UI 组件

| 组件 | 职责 |
|------|------|
| `MacMenuBar` | 顶部菜单栏（Apple 菜单、文件、主题切换、右侧状态） |
| `FinderSidebar` | 左侧历史记录和教师案例库入口 |
| `WorkspaceInput` | 工作台左栏（文本输入 / 媒体导入） |
| `WorkspaceResult` | 工作台右栏（评分结果、transcript、纠错） |
| `TranscriptPanel` | 逐词 transcript 渲染和播放高亮 |
| `WindowStatusBar` | 底部状态栏 |

目标目录：`src/components/workspace/`

#### 第三层：App.tsx 瘦身

拆分后 `App.tsx` 仅保留：
- 顶层布局结构。
- Hooks 组合和 props 传递。
- 模态框（Settings、Help）的开关状态。

目标行数：300~500 行。

### 验收标准

- `pnpm typecheck` 通过。
- `pnpm test` 全部通过，无测试回归。
- `pnpm build` 通过。
- App.tsx 行数 ≤ 500。
- 各 Hook 可独立 import 和单元测试。

### 执行顺序

1. 先抽取 Hooks（不改 UI 结构，风险最低）。
2. 再抽取 UI 组件（逐个抽取，每次验证构建）。
3. 最后瘦身 App.tsx。

## 改进项 B：Rust lib.rs 模块化

### 问题

`src-tauri/src/lib.rs`（591 行）混合了配置类型定义、常量、Tauri command 注册和部分业务逻辑。随着功能增长，模块边界不清晰。

### 拆分方案

| 新文件 | 职责 | 来源 |
|--------|------|------|
| `config.rs` | `AppConfig`、`PublicAppConfig`、配置读写函数、默认值 | lib.rs 中 config 相关 struct 和 fn |
| `constants.rs` | 全局常量（`ZHIPU_EMBEDDING_DIMENSIONS`、超时值等） | lib.rs 中 const 定义 |
| `errors.rs` | `AppError` 类型定义和 impl | lib.rs 中 error 相关代码 |

拆分后 `lib.rs` 仅保留：
- `mod` 声明。
- `run()` 函数和 Tauri command 注册。
- 必要的 re-export。

### 验收标准

- `cargo build` 通过。
- `cargo test -- --test-threads=1` 全部通过。
- `cargo clippy` 无新增 warning。
- lib.rs 行数 ≤ 150。

## 改进项 C：Rust 测试并行化

### 问题

当前 Rust 测试必须使用 `--test-threads=1` 串行执行，原因是 corpus 测试共享同一个 SQLite 文件，并行时出现 `CORPUS_CASE_NOT_FOUND` 偶发失败。

### 方案

为每个测试函数创建独立的临时数据库：

```rust
// 使用 tempfile crate 创建临时目录
let tmp = tempfile::tempdir().unwrap();
let db_path = tmp.path().join("test.db");
// 将 db_path 传入 corpus 初始化函数
```

### 改动范围

- `Cargo.toml`：添加 `tempfile` 为 dev-dependency。
- `src-tauri/src/corpus.rs`：测试中使用 `tempfile::tempdir()` 替代固定路径。
- 移除文档中 `--test-threads=1` 的要求（CLAUDE.md、09-testing-acceptance.md）。

### 验收标准

- `cargo test`（不带 `--test-threads=1`）全部通过，连续运行 3 次无偶发失败。
- 测试执行时间缩短。

## 改进项 D：构建产物优化

### 问题

`pnpm build` 产生 chunk 体积警告：主 JS bundle 679 kB（gzipped 158 kB）。对桌面应用影响有限，但影响启动速度和内存占用。

### 方案

1. **Lucide 图标 tree-shaking**：确认当前导入方式是否已支持 tree-shaking（`import { Icon } from "lucide-react"` 已支持）。如果 bundle 中包含未使用图标，检查 Vite 配置。

2. **Feature 模块 lazy import**：对非首屏模块使用 `React.lazy`：
   ```tsx
   const CorpusPage = React.lazy(() => import("../features/corpus/CorpusPage"));
   const MediaPage = React.lazy(() => import("../features/media/MediaPage"));
   const SettingsPage = React.lazy(() => import("../features/settings/SettingsPage"));
   ```

3. **Vite manual chunks**：在 `vite.config.ts` 中配置 `build.rollupOptions.output.manualChunks`，将 `lucide-react` 和 `@tauri-apps` 分离为独立 chunk。

### 验收标准

- `pnpm build` 无 chunk 体积警告（单 chunk ≤ 500 kB）。
- 应用启动和功能无回归。

## 任务拆分

| 编号 | 任务 | 改进项 | 优先级 | 预估工时 |
|------|------|--------|--------|----------|
| R-501 | 抽取 5 个自定义 Hooks | A | P0 | 4h |
| R-502 | 抽取 6 个 UI 组件 | A | P0 | 4h |
| R-503 | App.tsx 瘦身和集成验证 | A | P0 | 2h |
| R-504 | Rust lib.rs 拆分为 config/constants/errors 模块 | B | P1 | 2h |
| R-505 | Rust 测试引入 tempfile 实现并行化 | C | P1 | 2h |
| R-506 | Vite manual chunks 配置 | D | P2 | 1h |
| R-507 | Feature 模块 lazy import | D | P2 | 1h |
| R-508 | 文档状态同步和改进记录更新 | — | P0 | 1h |

### 优先级说明

- **P0**：直接影响开发效率和代码可维护性，MVP 5 内完成。
- **P1**：改善工程质量，MVP 5 内尽量完成。
- **P2**：优化体验，可延后到 MVP 5 收尾或后续迭代。

## 执行原则

- 每个改进项独立提交，不混合。
- 每次拆分后立即运行 `pnpm typecheck && pnpm test && pnpm build` 验证。
- Rust 改动后运行 `cargo test -- --test-threads=1`（在 R-505 完成前保持串行）。
- 拆分过程中不改变任何业务逻辑和 UI 行为。
- 如果拆分导致测试失败，优先修复测试而非跳过。

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| App.tsx 拆分引入 props drilling | 优先使用 Hooks 共享状态，必要时用 Context |
| Rust 模块拆分破坏 pub 可见性 | 使用 `pub(crate)` 控制，逐步调整 |
| lazy import 导致首次加载闪烁 | 添加 Suspense fallback loading 状态 |
| tempfile 在 CI 环境行为差异 | tempfile 是 Rust 生态标准方案，跨平台兼容 |

## 与 MVP 5 原有任务的关系

| 原有任务 | 状态 | 与改进项关系 |
|----------|------|-------------|
| R-401 单元测试补齐 | ✅ 已完成 | R-501 拆分后可为新 Hooks 补充独立测试 |
| R-402 Rust 集成测试 | ✅ 已完成 | R-504/R-505 拆分后测试结构更清晰 |
| R-403 Mock 建立 | ✅ 已完成 | 无影响 |
| R-404 手动验收 | ⏳ Deferred | 改进项不阻塞，获取真实 Key 后独立执行 |
| R-405 密钥泄露检查 | ✅ 已完成 | 无影响 |
| R-406 UI 文档维护 | ✅ 已完成 | R-502 拆分后需同步更新 UI 文档事实源列表 |
