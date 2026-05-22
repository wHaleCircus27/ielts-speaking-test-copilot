# 09 测试与验收

## 目标

建立覆盖 MVP 全流程的测试矩阵和人工验收清单，确保文本批改、媒体转码、语音评估、播放同步和 RAG 都有明确通过标准。

## 不做什么

- 不要求首版达到完整企业级 CI。
- 不做真实外部服务的高频自动化调用。
- 不把性能压测作为首版阻塞项。

## 测试分层

### 单元测试

- JSON 清洗。
- Schema 校验。
- Prompt 组装。
- DeepSeek `/models` endpoint 生成。
- 停顿 token 生成。
- 当前播放词定位。
- 配置默认值和脱敏。
- 教师案例清洗、截断、XML 转义。

### 集成测试

- Tauri command 成功和失败路径。
- DeepSeek mock client。
- Azure mock client。
- FFmpeg mock sidecar。
- SQLite CRUD。
- `sqlite-vec` Top-K 检索。

### 手动验收

- 主题切换。
- 桌面窗口启动。
- 文本批改完整链路。
- DeepSeek `/models` 连通性测试。
- 媒体转码完整链路。
- Azure 语音评估完整链路。
- 播放同步和点击跳转。
- RAG 注入效果。

## Mock 策略

- DeepSeek：使用固定 JSON 响应、Markdown 包裹 JSON、非法 JSON、401、超时。
- DeepSeek 连通性：mock `/models` 成功、401、网络失败、当前模型不在返回列表。
- Azure：使用 Microsoft Learn Pronunciation Assessment detailed JSON 形态的固定逐词结果，覆盖空词列表、非法 JSON、鉴权失败、格式错误。
- FFmpeg：使用 mock command 返回成功路径、进程失败、二进制缺失。
- Embedding：使用固定维度向量，避免测试依赖真实网络。

## 测试资源

- `test-resource/` 是本项目约定的本地测试资源目录。
- 该目录仅用于人工验收、本地调试和临时测试样本，例如音频、视频、压缩包或格式兼容性样本。
- 该目录不属于产品运行数据或发布资产，已加入 `.gitignore`，不应提交到仓库。
- 自动化测试应优先使用 mock、fixture 或小型可审查样本；真实媒体样本默认只在本地 `test-resource/` 中使用。

## MVP 验收清单

### MVP 1

- 应用可启动。
- 设置保存和恢复正常。
- 无 DeepSeek Key 时批改按钮不可用或明确提示。
- DeepSeek 连接测试成功时展示 `/models` 返回的模型列表。
- DeepSeek 连接测试失败时不泄露 API Key。
- 文本批改结果包含总分、四项小分、评语、词汇纠错和重构示范。
- 非法 JSON 不导致页面崩溃。

### MVP 2

- 支持 MP4、MP3、M4A、WAV。
- 转码输出为 `WAV 16kHz 16bit mono PCM`。
- 文件路径包含空格或中文时可转码。
- FFmpeg 缺失时错误清晰。
- 原始文件不会被覆盖。

### MVP 3

- Azure 配置缺失时有明确提示。
- WAV 可提交 Azure Speech SDK continuous pronunciation assessment。
- transcript 顺序正确。
- 停顿超过 2 秒标红。
- 分数低于 60 的词下划线。
- 点击单词可跳转。
- 播放时当前词高亮不卡顿。
- 当前收口标准：微软文档一致性、SDK 调用形态和 mock 自动化验证通过。
- Deferred：真实 Azure API Key、region、真实 token、真实 30 秒以上 WAV 上传验收；获得 Azure Speech Key 后再补 continuous pronunciation assessment、点击跳转和播放高亮人工验收。

### MVP 4

- 第一阶段已启动：教师案例可新增、查看、编辑和单个删除，使用 SQLite 本地存储。
- 当前阶段：教师案例 Embedding 切换为智谱 `embedding-3`，支持重建向量、本地 SQLite JSON 向量存储和 Rust 层 cosine similarity Top-K。
- 批改 Prompt 支持最多 3 个 XML `<example>`，并做清洗、截断和 XML 转义。
- RAG 检索成功时自动注入最多 3 个相似案例；智谱 Key 缺失或检索失败时不阻塞普通批改。
- Deferred：用户提供智谱 API Key 后，补真实 `embedding-3` 重建和 Top-K 人工验收；后续再迁移 `sqlite-vec`。

## 发布前检查

- API Key 不出现在日志、错误提示和前端源码。
- 真实外部服务连通性测试输出不包含 API Key。
- 外部服务错误都有用户可理解提示。
- 三套主题下主要页面可读可操作。
- 不存在批量删除文件或目录的脚本。
- README 或开发文档说明本地 FFmpeg 二进制准备方式。
- README 和开发文档明确 `test-resource/` 仅为本地测试资源目录。
- 关键路径至少有单元测试或人工验收记录。

## MVP 3 文档一致性验收

- 长音频使用 Azure Speech SDK continuous recognition，验证位置：`src/lib/speech.ts`。
- `ReferenceText` 为空时按 unscripted assessment，验证位置：`createPronunciationAssessmentConfig`。
- `en-US` 才启用 prosody assessment，验证位置：`createPronunciationAssessmentConfig`。
- continuous mode 不要求 `EnableMiscue`，MVP 3 不验收遗漏/插入。
- Azure Key 不传给前端，验证位置：`src-tauri/src/speech.rs` 的 `issue_azure_speech_token`。
- Azure detailed JSON 映射、逐词 token、停顿、低分词、音素错误 tooltip、当前词查找、媒体页和主工作台 mock UI 流程均有自动化测试。

## 当前验证记录

- `pnpm typecheck` 通过。
- `pnpm test` 通过：7 个测试文件，27 个测试，覆盖 MVP 3 mock 验收、MVP 4 教师案例 CRUD 页面和 RAG 自动检索注入。
- `cd src-tauri && cargo test` 通过：30 个 Rust 测试，覆盖既有 Rust 命令、MVP 4 SQLite CRUD、智谱配置校验、向量存储和 cosine similarity。
- `pnpm build` 通过。
- MVP 3 mock 验证通过：Microsoft Learn Pronunciation Assessment detailed JSON 形态可映射为 `SpeechAssessmentResult`，逐词 transcript 可生成停顿 token、低分词状态、音素错误 tooltip 和当前播放词。
- MVP 3 UI mock 验证通过：主工作台转码后会校验 Azure 配置、调用语音评估、生成历史报告；媒体页可转码后手动开始语音评估。
- MVP 3 文档一致性验证通过：已对照微软 Pronunciation Assessment 文档核对 continuous mode、unscripted assessment、prosody `en-US` 限制、`EnableMiscue` 边界和 token 密钥边界。
- MVP 2 本地媒体验收通过：在 `test-resource/mvp2 验证 样本/` 使用包含中文和空格的路径验证 MP4、MP3、M4A、WAV 均可转为 `RIFF WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz`。
- MVP 2 原文件保护验收通过：转码输出写入独立 WAV 文件，原始 MP4、MP3、M4A、WAV 输入文件未被覆盖。
- 当前机器未安装 `ffmpeg` / `ffprobe`，macOS `afconvert` 可用；本次媒体验收覆盖了 FFmpeg 缺失时的 macOS 后备转码路径。
- 使用本地 `test-resource/deepseekApiKey.txt` 验证 DeepSeek `/models`，HTTP 200，返回 `deepseek-v4-flash`、`deepseek-v4-pro`。
- 使用本地 `test-resource/deepseekApiKey.txt` 验证 DeepSeek `/embeddings` 与 `/v1/embeddings`，均返回 HTTP 404；测试未输出 API Key。
- 使用 `deepseek-v4-flash` 验证 `/chat/completions` JSON 模式，HTTP 200，返回 `{"ok":true,"service":"deepseek"}`。
- 上述真实服务测试未输出、提交或写入 API Key。
- Deferred 人工验收：获得真实 Azure Speech Key 后，配置真实 region，并使用 30 秒以上 WAV 验证 continuous pronunciation assessment、点击跳转和播放高亮。
- MVP 4 当前验证：教师案例 SQLite CRUD、前端新增/编辑/单条删除页面流程、智谱配置校验、向量存储清理、cosine similarity、RAG XML Prompt 注入工具和前端自动检索注入均纳入自动化测试；真实智谱 API Key 验证 deferred。

## 风险与后续扩展

- 外部服务测试应默认使用 mock，真实服务测试手动触发。
- 后续可加入 Playwright 做前端交互回归。
- 后续可加入 Tauri 打包 smoke test。
