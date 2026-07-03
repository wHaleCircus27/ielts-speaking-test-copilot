# 09 测试与验收

## 目标

建立覆盖 MVP 全流程的测试矩阵和人工验收清单，确保文本批改、媒体转码、语音评估、播放同步和 RAG 都有明确通过标准。

UI 验收以 [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md) 为索引；当 UI 文档与代码不一致时，以当前代码实现为准，并同步更新 UI 固化文档。

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
- SQLite CRUD、旧库迁移和 f32 BLOB 向量存储。
- Rust 层 cosine similarity Top-K 检索与相似度阈值过滤。

### 手动验收

- 主题切换。
- 桌面窗口启动。
- 文本批改完整链路。
- DeepSeek `/models` 连通性测试。
- 媒体转码完整链路。
- Azure 语音评估完整链路。
- 播放同步和点击跳转。
- RAG 注入效果。
- UI 固化一致性：macOS 菜单、历史栏、工作台双栏、result selector、设置弹窗、帮助弹窗和三套主题与 `10-assessor-ui-redesign.md` 一致。

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
- Azure Speech 真实 Key 预检可读取 `test-resource/azureSpeechKey.txt` 或 `AZURE_SPEECH_KEY`，预检输出不得包含 Key 或短期 token。
- 智谱 Embedding 真实 Key 验证只允许读取本地 `test-resource/zhipuApiKey.txt` 或环境变量，输出不得包含 Key。

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
- `ProsodyScore` 展示为韵律自然度（Prosody）。
- 配置 DeepSeek 后，可基于 transcript、题目和 RAG 案例得到 vocabulary、grammar、topic 文本维度；失败时不阻塞发音评估。
- 当前收口标准：微软文档一致性、SDK 调用形态和 mock 自动化验证通过。
- Deferred：真实 Azure API Key、region、真实 token、真实 30 秒以上 WAV 上传验收；获得 Azure Speech Key 后再补 continuous pronunciation assessment、点击跳转和播放高亮人工验收。

### MVP 4

- 教师案例可新增、查看、编辑和单个删除，使用 `rusqlite` bundled 本地 SQLite 存储，不依赖系统 `sqlite3` CLI。
- 教师案例 Embedding 使用智谱 `embedding-3`、2048 维、f32 BLOB 向量存储和 Rust 层 cosine similarity Top-K。
- 检索相似度阈值默认 `0.45`，可在 Settings AI 页配置；低于阈值的案例不注入 Prompt。
- query embedding 使用本地 SQLite cache，按 provider/model/dimensions/规范化 query hash 隔离，最多保留 200 条，不保存原始 query。
- 批改 Prompt 支持最多 3 个 XML `<example similarity="...">`，并做清洗、截断和 XML 转义。
- create/update 后自动尝试重建 Embedding；失败时写入 `failed` 与 `embeddingError`，案例列表展示原因。
- RAG 检索成功时自动注入最多 3 个相似案例；智谱 Key 缺失或检索失败时结果面板显式提示且不阻塞普通批改。
- 语料页提供诊断搜索预览，展示阈值、cache/network 来源、included、near misses 和 score。
- 语料页提供 pending/failed 顺序重建队列；仍不提供批量删除能力。
- Deferred：用户提供智谱 API Key 后，执行 `pnpm zhipu:embedding-benchmark` 补真实 `embedding-3` 2048 维基准；后续数据量增大再评估 `sqlite-vec`。

### 智谱真实 Key 基准

- 执行 `pnpm zhipu:embedding-benchmark`。
- 默认从 `test-resource/zhipuApiKey.txt` 读取 Key；也可用 `ZHIPU_API_KEY` 环境变量，或通过 `--key-file` 指定本地 Key 文件。
- 默认使用 `embedding-3`、`dimensions=2048` 和 3 条内置样本；可通过 `--model`、`--dimensions`、`--sample` 覆盖。
- 通过标准：所有样本 HTTP 2xx 且返回向量维度等于配置维度。
- 记录标准：只记录维度、样本数、HTTP 状态计数、avg/p50/p95 和是否通过，不记录 API Key、Authorization header 或原始敏感响应。

### Azure 真实 Key 预检

- 执行 `pnpm azure:speech-preflight -- --region <Azure Speech region> --language en-US`。
- 默认从 `test-resource/azureSpeechKey.txt` 读取 Key；也可用 `AZURE_SPEECH_KEY` 环境变量，或通过 `--key-file` 指定本地多 Key 文件。
- 默认检查 `test-resource/speakTest-afconvert-16k-mono.wav` 和 `test-resource/speakTest-nvidia-asr.wav`。
- 通过标准：Azure token endpoint 返回 2xx、短期 token 非空、两个 WAV 均为 `16kHz / mono / 16-bit PCM`。
- 记录标准：只记录 region、language、音频文件名、HTTP 状态和是否通过，不记录 Azure Key 或短期 token。

## 发布前检查

- API Key 不出现在日志、错误提示和前端源码。
- 真实外部服务连通性测试输出不包含 API Key。
- 外部服务错误都有用户可理解提示。
- 三套主题下主要页面可读可操作。
- `10-assessor-ui-redesign.md` 与当前代码实现一致，相关开发文档均保留 UI 文档索引。
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
- DeepSeek JSON 清洗、Schema、RAG Prompt 注入和媒体链路自动文本评分均有自动化测试。

## 当前验证记录

- `pnpm typecheck` 通过。
- `pnpm test` 通过：8 个测试文件，30 个测试，覆盖 MVP 3 mock 验收、MVP 4 教师案例 CRUD 页面、RAG 自动检索注入、score 透传、Settings 阈值保存、诊断搜索预览和 pending/failed 队列重建。
- `cd src-tauri && cargo test` 通过：48 个 Rust 测试，覆盖既有 Rust 命令、MVP 4 SQLite CRUD、智谱配置校验、f32 BLOB 向量存储、旧库迁移、失败状态、重试判定、配置化相似度阈值、query cache/LRU、搜索诊断和 Prompt similarity 属性。MVP 5 R-505 已使用 `tempfile` 为 corpus SQLite 测试隔离数据库，不再要求 `--test-threads=1`。
- `pnpm build` 通过，Vite production build 已拆分 vendor 和 lazy 页面 chunk，无单 chunk 大于 500 kB 警告。
- 新增 `pnpm mvp4:verify` 本地验收聚合命令，串行执行 `pnpm typecheck`、`pnpm test`、`cd src-tauri && cargo test`、`pnpm build`，并检查 Azure 长音频 WAV 样本格式。
- 新增 `pnpm azure:speech-preflight`，用于获得 Azure Speech Key 后做本地 token 与 WAV 素材预检；脚本不打印 Key 或短期 token。
- 新增 `pnpm zhipu:embedding-benchmark`，用于获得智谱 Key 后做 2048 维 embedding 延迟基准；缺 Key 时明确失败，脚本不打印 Key、Authorization header 或原始敏感响应。
- Azure Speech 真实 Key 连通性预检通过：使用本地 `test-resource/azureApikey.txt` 中第一条可用 Key、region `eastasia`、language `en-US` 请求 token endpoint，HTTP 200，短期 token 非空；默认两个 WAV 样本均为 `1 ch, 16000 Hz, Int16`。测试输出未包含 Azure Key 或短期 token。
- 本次 MVP 3 CLI 链路验收通过：按开发文档边界跳过 Tauri 真实桌面 UI 人工流程，完成 mock 自动化、Rust command 层、生产构建、Azure token/WAV 预检和 DeepSeek 文本维度前置链路验证。
- DeepSeek 文本维度 mock 验证通过：Rust 测试覆盖合法 JSON、Markdown 包裹 JSON、缺字段、分数越界和 RAG Prompt 注入；主工作台 mock 验证媒体链路不向 Azure Speech 传 `referenceText`，并在 Azure transcript 可用后调用 `grade_speaking`。
- MVP 3 mock 验证通过：Microsoft Learn Pronunciation Assessment detailed JSON 形态可映射为 `SpeechAssessmentResult`，逐词 transcript 可生成停顿 token、低分词状态、音素错误 tooltip 和当前播放词。
- MVP 3 UI mock 验证通过：主工作台转码后会校验 Azure 配置、调用语音评估、生成历史报告；媒体页可转码后手动开始语音评估。
- MVP 3 文档一致性验证通过：已对照微软 Pronunciation Assessment 文档核对 continuous mode、unscripted assessment、prosody `en-US` 限制、`EnableMiscue` 边界和 token 密钥边界。
- MVP 2 本地媒体验收通过：在 `test-resource/mvp2 验证 样本/` 使用包含中文和空格的路径验证 MP4、MP3、M4A、WAV 均可转为 `RIFF WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz`。
- MVP 2 原文件保护验收通过：转码输出写入独立 WAV 文件，原始 MP4、MP3、M4A、WAV 输入文件未被覆盖。
- 当前机器未安装 `ffmpeg` / `ffprobe`，macOS `afconvert` 可用；本次媒体验收覆盖了 FFmpeg 缺失时的 macOS 后备转码路径。
- 使用本地 `test-resource/deepseekApiKey.txt` 验证 DeepSeek `/models`，HTTP 200，返回 `deepseek-v4-flash`、`deepseek-v4-pro`。
- 使用本地 `test-resource/deepseekApiKey.txt` 验证 DeepSeek `/embeddings` 与 `/v1/embeddings`，均返回 HTTP 404；测试未输出 API Key。
- 使用 `deepseek-v4-flash` 验证 `/chat/completions` JSON 模式，HTTP 200，返回 `{"ok":true,"service":"deepseek"}`。
- 历史使用本地 `test-resource/zhipuApiKey.txt` 验证智谱 `embedding-3`，`dimensions=1024`，warmup 延迟约 `419.8 ms`，5 次连续请求平均约 `210.4 ms`，p50 约 `209.1 ms`，p95 约 `263.8 ms`；当前实现已切换为固定 `dimensions=2048`、`45s` 请求超时和 429/timeout/5xx 最多 2 次重试，需重新补充真实基准。
- 使用 3 条教师案例做端到端基准：总耗时约 `760 ms`，查询延迟约 `188.8 ms`，Top-K 结果依次为 `fluency-focus` `0.9249`、`grammar-focus` `0.8418`、`vocabulary-focus` `0.8266`。
- 上述真实服务测试未输出、提交或写入 API Key。
- Deferred 人工验收：在 Tauri 设置页配置真实 Azure Speech Key、region 和 language 后，使用 30 秒以上 WAV 验证 continuous pronunciation assessment、点击跳转和播放高亮。
- MVP 4 当前验证：教师案例 SQLite CRUD、前端新增/编辑/单条删除页面流程、智谱配置校验、f32 BLOB 向量存储清理、旧库迁移、cosine similarity、配置化阈值、query cache、搜索诊断、RAG XML Prompt 注入、score 透传、前端自动检索注入、RAG 引用展示、诊断搜索预览和 pending/failed 队列重建均纳入记录；后续可继续补真实 2048 维和更多样本规模的批量基准。

## 风险与后续扩展

- 外部服务测试应默认使用 mock，真实服务测试手动触发。
- 后续可加入 Playwright 做前端交互回归。
- 后续可加入 Tauri 打包 smoke test。
