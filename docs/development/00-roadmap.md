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
- 真实 Azure Speech Key + 30 秒以上长音频人工验收已 deferred，不作为 MVP 3 代码收口阻塞项。

## MVP 4：教师个性化 RAG

### 目标

用户可以录入教师历史批改案例，并在新批改中检索相似案例注入 Prompt。

### 任务拆分

- R-301：设计教师案例数据结构。
- R-302：实现案例录入页面。
- R-303：建立 SQLite 表。
- R-304：接入智谱 `embedding-3`。
- R-305：建立 `sqlite-vec` 向量检索。
- R-306：实现 Top-K 检索。
- R-307：将案例格式化为 XML 片段注入 Prompt。

### 验收标准

- 案例可新增和查询。
- Embedding 成功后可检索相似案例。
- 批改请求中包含 2-3 个相似案例。
- 超长案例会被清洗和截断。

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
