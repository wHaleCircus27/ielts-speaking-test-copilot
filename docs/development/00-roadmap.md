# 00 Roadmap 与里程碑

## 目标

定义项目从空仓库到可用个人版桌面应用的实施路径，确保每个阶段都有可验收成果。

## 不做什么

- 不在首版追求完整商业化发布流程。
- 不做多端同步。
- 不做复杂用户权限。
- 不把 SpeechSuper 和 Ollama 作为首版阻塞项。

## MVP 1：基础工程与文本批改

### 目标

用户可以启动桌面应用，配置 DeepSeek，输入雅思口语文本，并获得结构化批改结果。

### 任务拆分

- R-001：初始化 Tauri 2 + React 18 + Vite + TypeScript。
- R-002：接入 Tailwind CSS 和基础路由。
- R-003：实现应用壳和设置页入口。
- R-004：实现本地配置读写。
- R-005：实现 DeepSeek 批改请求。
- R-006：实现 JSON 清洗和 Schema 校验。
- R-007：实现批改结果页。

### 验收标准

- 应用可本地启动。
- DeepSeek 配置可保存和恢复。
- DeepSeek 默认模型为 `deepseek-v4-flash`，可切换到 `deepseek-v4-pro`。
- 设置页可对已保存 DeepSeek 配置执行 `/models` 连通性测试，并展示可用模型列表。
- 输入文本可返回总分、四项小分、词汇建议和重构示范。
- 非法 JSON 或 API 错误不会导致页面崩溃。

### 当前状态

- 已接入 `deepseek-v4-flash` 和 `deepseek-v4-pro`。
- 已保留 `deepseek-chat`、`deepseek-reasoner` 旧模型值的本地配置兼容读取。
- 已用本地测试 Key 验证 `/models` 和 `deepseek-v4-flash` `/chat/completions` 连通性，测试输出未包含 API Key。

## MVP 2：媒体处理

### 目标

用户可以导入媒体文件，应用将其转码为语音评估标准 WAV。

### 任务拆分

- R-101：实现拖拽和文件选择。
- R-102：实现文件类型校验。
- R-103：配置 FFmpeg sidecar。
- R-104：实现 Rust 转码命令。
- R-105：展示转码状态和错误。
- R-106：接入音频播放器。

### 验收标准

- 支持 MP4、MP3、M4A、WAV。
- 输出格式为 `WAV 16kHz 16bit mono PCM`。
- 转码失败时给出明确错误。

## MVP 3：语音评估与播放同步

### 目标

用户可以基于音频获取 Azure 发音评估，并查看逐词评分、停顿和播放同步。

### 任务拆分

- R-201：实现 Azure 配置读取。已完成。
- R-202：实现 Pronunciation Assessment 调用。已完成：使用 Azure Speech SDK continuous mode 支持长音频。
- R-203：解析逐词时间戳和评分。已完成。
- R-204：渲染 transcript。已完成。
- R-205：实现停顿标注。已完成：超过 2 秒标红。
- R-206：实现点击单词跳转。已完成。
- R-207：实现播放中当前词高亮。已完成：主工作台词级高亮。

### 验收标准

- 转码后的 WAV 可提交语音评估。
- 逐词评分和时间戳可被前端展示。
- 停顿超过 2 秒标红。
- 点击单词能跳转播放器位置。

### 当前状态

- 主工作台媒体流程已接入转码后 Azure 长音频发音评估，并生成真实 transcript 和历史报告。
- 独立媒体页已提供语音评估调试入口。
- 自动化测试已覆盖 Azure 响应映射、transcript token、主工作台和媒体页 mock 评估流程。
- 已完成微软文档一致性核对：continuous mode、unscripted assessment、prosody `en-US` 限制、`EnableMiscue` 边界和 token 密钥边界均已对齐。
- 真实 Azure Speech Key + 30 秒以上长音频人工验收此前未闭环，现已并入第 13 章 RH-405，并作为 RC 阻断门槛。

## MVP 4：教师个性化 RAG

### 目标

用户可以录入教师历史批改案例，并在新批改中检索相似案例注入 Prompt。

### 任务拆分

- R-301：设计教师案例数据结构。
- R-302：实现案例录入页面。
- R-303：建立 SQLite 表。
- R-304：接入智谱 `embedding-3`。
- R-305：建立向量检索。实际实现为 SQLite f32 BLOB 向量存储 + Rust 层 cosine similarity，`sqlite-vec` 迁移列为后续扩展。
- R-306：实现 Top-K 检索。
- R-307：将案例格式化为 XML 片段注入 Prompt。

### 验收标准

- 案例可新增和查询。
- Embedding 成功后可检索相似案例。
- 批改请求中包含 2-3 个相似案例。
- 超长案例会被清洗和截断。

### 当前状态

- 教师案例 CRUD（新增、查看、编辑、单条删除）已完成，使用 SQLite 本地存储。
- 智谱 `embedding-3` 已接入，固定 `dimensions=1024`，支持重建向量。
- 向量检索使用 SQLite f32 BLOB 存储 + Rust 层 cosine similarity Top-K，未使用 `sqlite-vec`（列为后续扩展）。
- RAG Prompt 注入已完成：最多 3 个 XML `<example>`，含清洗、截断和 XML 转义。
- 批改时自动检索注入；智谱 Key 缺失或检索失败时不阻塞普通批改。
- 真实智谱 API Key `dimensions=1024` 基准测试和 Tauri 桌面 UI 人工验收并入第 13 章 RH-405，作为 RC 阻断门槛。

## MVP 5：稳定化

### 目标

补齐测试、错误提示、性能检查和发布前验收。

### 任务拆分

- R-401：补齐 JSON、Prompt 和数据转换单元测试。
- R-402：补齐 Rust command 集成测试。
- R-403：建立 mock DeepSeek、mock Azure、mock FFmpeg。
- R-404：完成主题切换和播放同步手动验收。
- R-405：检查日志和错误信息是否泄露密钥。
- R-406：维护 UI 固化文档，UI 变更后同步 `docs/development/10-assessor-ui-redesign.md`，避免设计文档与当前代码实现漂移。

### 验收标准

- 关键路径均有测试或人工验收记录。
- 外部服务失败时都有明确 UI 状态。
- API Key 不出现在日志、错误弹窗和前端源码中。
- UI 文档能准确反映当前代码实现，相关开发文档均可索引到 `10-assessor-ui-redesign.md`。

### 附加改进任务

详细方案见 [11-mvp5-improvements.md](11-mvp5-improvements.md)。

- R-501：抽取 5 个自定义 Hooks（useGradingWorkflow、useMediaWorkflow、useTranscriptPlayback、useSessionHistory、useAppConfig）。已完成。
- R-502：抽取 6 个 UI 组件（MacMenuBar、FinderSidebar、WorkspaceInput、WorkspaceResult、TranscriptPanel、WindowStatusBar）。已完成。
- R-503：App.tsx 瘦身至 ≤ 500 行并集成验证。已完成：`src/app/App.tsx` 当前 213 行。
- R-504：Rust lib.rs 拆分为 config.rs、constants.rs、errors.rs 模块。已完成。
- R-505：Rust 测试引入 tempfile 实现并行化，移除 `--test-threads=1` 约束。已完成。
- R-506：Vite manual chunks 配置，分离 React、Tauri、lucide 和 Azure Speech SDK。已完成。
- R-507：Feature 模块 lazy import（当前实际接线的 CorpusPage、SettingsPage）。已完成。
- R-508：文档状态同步和改进记录更新。已完成。

### 附加改进验收标准

- App.tsx ≤ 500 行，各 Hook 可独立测试。
- Rust lib.rs ≤ 150 行，`cargo clippy` 无新增 warning。
- `cargo test`（无 `--test-threads=1`）连续 3 次通过。
- `pnpm build` 无 chunk 体积警告。

### 当前状态

- R-401~R-403、R-405~R-406 已通过自动化验证。
- R-404 手动验收已拆分并入第 13 章：三套主题切换由 RH-404 `.app` smoke 承接，真实 Azure 播放同步由 RH-405 承接，均作为 RC 门槛。
- R-501~R-508 已完成；`pnpm build` 已无单 chunk > 500 kB 警告，Rust 测试已恢复默认并行 `cargo test`。

## 发布加固与可交付闭环迭代（当前）

### 目标

把已完成核心功能的开发版本收口为可在目标 Apple Silicon macOS 设备重复构建、安装和验收的内部 Release Candidate。

### 当前状态

- 2026-07-10 发布审查结论为 No-Go。
- P0 阻断项包括 Tauri asset protocol、外部服务 endpoint 与 Key 绑定、批改失败输入丢失、历史音频错配。
- P1 工作包括 CSP/capabilities、Keychain、错误脱敏、依赖修复、媒体资源治理、CI、安装包 smoke 和真实服务验收。
- 详细任务、依赖、工时、测试矩阵和 RC 退出标准见 [13-release-hardening.md](13-release-hardening.md)。

### 发布门槛

- 第 13 章任务表列出的 21 项 RH 任务全部完成并具备验收证据。
- fresh clone 自动验证、CI、生产依赖审计和 `.app` smoke test 全部通过。
- DeepSeek、Azure 30 秒以上长音频和智谱 1024 维真实服务验收完成。
- 任一门槛未满足时保持 No-Go，不再以 deferred 方式绕过核心链路。
