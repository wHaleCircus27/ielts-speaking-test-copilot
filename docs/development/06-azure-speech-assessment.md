# 06 Azure 语音评估

## 目标

接入 Azure Pronunciation Assessment，对转码后的 WAV 进行发音评估，输出发音准确度、流利度、韵律/语调自然度（Prosody）、逐词评分、逐词时间戳和音素级错误；词汇、语法和话题内容评分统一由 DeepSeek 基于 transcript、题目和教师案例库补充。

## 不做什么

- 不接入 SpeechSuper。
- 不做实时流式评估。
- 不做多语言评估，首版默认英文。

## 用户流程

1. 用户完成音频转码。
2. 用户点击开始语音评估。
3. 应用提交 WAV 给 Azure。
4. 页面展示评分摘要和 transcript 数据。

## 技术设计

- Azure key、region、language 从配置模块读取。
- Rust 后端只负责 Azure 配置校验和短期 Speech token 签发，Azure Key 不传给前端。
- 前端使用 `microsoft-cognitiveservices-speech-sdk` 的 continuous recognition / pronunciation assessment 处理长音频。
- 不使用短音频 REST `recognize once` 作为主链路；业务场景包含 30 秒以上长音频。
- 返回统一 `SpeechAssessmentResult`，前端不直接依赖 Azure 原始结构。
- Azure 错误统一映射为 `AppError`。
- 逐词时间戳使用毫秒单位。
- 默认按 IELTS 自由作答使用 unscripted assessment；`referenceText` 只作为可选 scripted assessment 输入。
- Azure 官方 `ProsodyScore` 面向 `en-US`，描述重音、语调、语速、节奏、自然度和表达性；产品文案统一展示为“韵律自然度（Prosody）”。
- Azure Speech SDK 1.46+ 不再直接提供 content assessment；本项目不再接入 Azure OpenAI / Foundry chat deployment，Vocabulary、Grammar、Topic 使用现有 DeepSeek 批改链路。
- Azure 评分摘要、媒体评估状态、播放器和 transcript 展示以 [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md) 的当前代码实现为 UI 验收依据。

## 数据结构

```ts
type SpeechAssessRequest = {
  wavPath: string;
  referenceText?: string;
};

type SpeechAssessmentResult = {
  overall: {
    accuracyScore?: number;
    fluencyScore?: number;
    completenessScore?: number;
    prosodyScore?: number;
    pronunciationScore?: number;
  };
  words: SpeechWordAssessment[];
  durationMs: number;
  recognizedText: string;
};

type SpeechWordAssessment = {
  word: string;
  startMs: number;
  durationMs: number;
  accuracyScore?: number;
  errorType?: string;
  phonemes?: Array<{
    phoneme: string;
    accuracyScore?: number;
  }>;
};
```

## Tauri commands

- `validate_azure_config() -> AzureConfigValidationResult`
- `issue_azure_speech_token() -> AzureSpeechToken`

说明：

- `assess_pronunciation(request: SpeechAssessRequest) -> SpeechAssessmentResult` 当前由前端 SDK 封装完成，不作为 Tauri command 暴露。
- `issue_azure_speech_token` 只返回短期 token、region、language，不返回本地保存的 Azure Key。
- DeepSeek 文本评分复用 `grade_speaking(request: GradeRequest) -> GradeResult`，不新增 Azure OpenAI 内容评分 command。

## 任务拆分

- A-001：确认 Azure SDK 或 REST 调用方式。已完成：长音频使用 Azure Speech SDK continuous mode。
- A-002：实现 Azure 配置校验。已完成：`validate_azure_config` 返回 key/region/language 状态。
- A-003：实现 WAV 文件读取和提交。已完成：前端从转码 WAV asset 读取并提交 SDK。
- A-004：解析 Azure 原始响应。已完成：解析 detailed JSON 的 `NBest`、`Words`、`PronunciationAssessment`。
- A-005：映射为统一 `SpeechAssessmentResult`。已完成。
- A-006：实现前端评分摘要组件。已完成：主工作台和媒体页均展示评分。
- A-007：实现 Azure 错误提示和重试入口。已完成基础错误提示；后续可补专门 retry 控件。

## 当前实现进展

- 主工作台媒体流程已改为：选择媒体 -> 转码 WAV -> 校验 Azure 配置 -> Azure 长音频发音评估 -> DeepSeek 基于 transcript 补充词汇、语法和话题内容 -> 生成历史报告。
- 主工作台媒体链路按 IELTS 自由作答使用 unscripted assessment，不再把题目传给 Azure Speech `referenceText`；题目仅传给 DeepSeek 文本评分。
- 独立媒体页已提供转码后“开始语音评估”调试入口。
- 新增 `src-tauri/src/speech.rs`、`src/lib/speech.ts`、`src/types/speech.ts`。
- Azure token 请求 endpoint 为 `https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`。
- `en-US` 下启用 prosody assessment；其他 language 不强制要求 prosody 返回。
- DeepSeek 文本评分可选依赖 DeepSeek Key；配置缺失或请求失败时不阻塞 Azure Speech 发音评估。
- continuous mode 不支持 `EnableMiscue`，遗漏和插入不作为 MVP3 当前必达能力。
- MVP 3 真实 Azure Key 场景尚未完成；已并入 RH-405，作为 RC 阻断门槛。当前代码收口依据仍为微软文档结构一致性和 mock 自动化验证。
- 已新增真实 Key 本地预检脚本：`pnpm azure:speech-preflight -- --region <region> --language en-US`。脚本只验证 token endpoint 和 WAV 样本格式，不打印 Azure Key 或短期 token。

## 验收标准

- 无 Azure Key 时不能提交评估。
- 转码 WAV 可成功获得评估结果。
- 逐词时间戳和评分不为空。
- 配置 DeepSeek 后可基于 transcript、题目和 RAG 案例获得 vocabulary、grammar、topic 内容评分。
- Azure 鉴权失败、网络失败、格式错误都有明确提示。
- Tauri 桌面人工验收需在设置弹窗配置 Azure Key、region、language 后，用 30 秒以上 WAV 验证 continuous assessment、点击跳转和播放高亮。

## 测试建议

- 单元测试：Azure 响应映射。已覆盖，并使用 Microsoft Learn Pronunciation Assessment detailed JSON 形态构造 mock fixture，覆盖 `DisplayText`、`NBest`、`Words`、`PronunciationAssessment`、`Phonemes`、`Offset`、`Duration`。
- 单元测试：错误码映射。
- 集成测试：mock Azure 成功、401、超时、空结果。
- 集成测试：mock DeepSeek 成功和失败；失败时仍保留 Azure Speech 发音报告。
- 手动测试：短音频、长音频、低质量音频。

## MVP 3 阶段验证记录（历史）

- `pnpm typecheck` 通过。
- MVP 3 收口时 `pnpm test` 通过：7 个测试文件，27 个测试；mock 覆盖 Azure detailed JSON 映射、空词列表、非法 JSON、媒体页和主工作台 UI 评估流程。
- MVP 3 收口时 `pnpm build` 通过，但存在 Azure Speech SDK 引入后的 chunk size warning；该 warning 已在后续 R-506/R-507 分包中消除。
- MVP 3 收口时 `cd src-tauri && cargo test -- --test-threads=1` 通过 31 个测试；后续 corpus 测试已使用 `tempfile` 隔离，当前默认并行 Rust 测试结果以 09 号文档为准。
- MVP 3 CLI 验收未执行 Tauri 真实桌面 UI；continuous pronunciation assessment 上传、点击跳转和播放高亮现由 RH-405 承接。
- 真实 Key 到位后的前置命令：`pnpm azure:speech-preflight -- --region <region> --language en-US`。默认使用 `test-resource/azureSpeechKey.txt` 或 `AZURE_SPEECH_KEY`，默认检查 `test-resource/speakTest-afconvert-16k-mono.wav` 与 `test-resource/speakTest-nvidia-asr.wav`。
- Azure Speech 真实 Key 连通性预检通过：使用本地 `test-resource/azureApikey.txt` 中第一条可用 Key、region `eastasia`、language `en-US` 请求 token endpoint，HTTP 200，短期 token 非空；`test-resource/speakTest-afconvert-16k-mono.wav` 与 `test-resource/speakTest-nvidia-asr.wav` 均为 `1 ch, 16000 Hz, Int16`。测试输出未包含 Azure Key 或短期 token。
- 媒体链路 mock 验证：Azure Speech 成功后会调用 DeepSeek `grade_speaking` 补充文本维度；DeepSeek 不可用时不阻塞发音报告。
- 使用本地 `test-resource/deepseekApiKey.txt` 验证 DeepSeek 文本维度前置链路：`/models` HTTP 200，包含 `deepseek-v4-flash` 和 `deepseek-v4-pro`；`deepseek-v4-flash` `/chat/completions` JSON mode HTTP 200，返回预期 JSON。测试输出未包含 API Key。

## 微软文档一致性清单

- 长音频：微软文档建议 30 秒以上音频使用 continuous mode；当前实现使用 `startContinuousRecognitionAsync`。
- 结果结构：mock fixture 按 Microsoft Learn Pronunciation Assessment detailed JSON 形态覆盖 `NBest`、`Words`、`PronunciationAssessment`、`Phonemes`、`Offset`、`Duration`；`Offset` 和 `Duration` 按 100ns ticks 转换为毫秒。
- 自由作答：`ReferenceText` 为空时按 unscripted assessment；主工作台媒体链路不向 Azure Speech 传题目文本。
- Prosody：微软文档说明 prosody assessment 当前面向 `en-US`；当前实现仅在 `language === "en-US"` 时启用 `enableProsodyAssessment`，并在产品文案中解释为韵律自然度。
- 内容评分：Vocabulary、Grammar、Topic 不由 Azure Speech 返回；当前实现由 DeepSeek `grade_speaking` 基于 transcript、题目和 RAG 案例完成，Topic 进入综合批语和改进建议。
- 音素粒度：当前实现使用 `PronunciationAssessmentGranularity.Phoneme`，并解析 phoneme accuracy 用于 hover 提示。
- 误读能力边界：continuous mode 不支持 `EnableMiscue`；当前不把遗漏/插入作为 MVP 3 必达项。
- 密钥边界：Azure Key 只在 Rust command 层用于签发短期 token，前端只接收 token、region、language。

## 风险与后续扩展

- Azure Speech SDK 已在前端 webview 侧接入，Rust 侧不直接集成 Azure SDK。
- 参考文本缺失时评估维度可能受限，UI 需解释当前模式。
- 真实 Azure Key + 30 秒以上长音频人工验收尚未完成；需要在本地配置 Azure Speech Key 后按 RH-405 补齐验收记录。
