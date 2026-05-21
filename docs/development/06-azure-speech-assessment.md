# 06 Azure 语音评估

## 目标

接入 Azure Pronunciation Assessment，对转码后的 WAV 进行发音评估，输出完整度、流利度、语调、逐词评分、逐词时间戳和音素级错误。

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
- Rust 后端负责调用 Azure SDK 或 REST 封装。
- 返回统一 `SpeechAssessmentResult`，前端不直接依赖 Azure 原始结构。
- Azure 错误统一映射为 `AppError`。
- 逐词时间戳使用毫秒单位。

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

- `assess_pronunciation(request: SpeechAssessRequest) -> SpeechAssessmentResult`
- `validate_azure_config() -> ConfigValidationResult`

## 任务拆分

- A-001：确认 Azure SDK 或 REST 调用方式。
- A-002：实现 Azure 配置校验。
- A-003：实现 WAV 文件读取和提交。
- A-004：解析 Azure 原始响应。
- A-005：映射为统一 `SpeechAssessmentResult`。
- A-006：实现前端评分摘要组件。
- A-007：实现 Azure 错误提示和重试入口。

## 验收标准

- 无 Azure Key 时不能提交评估。
- 转码 WAV 可成功获得评估结果。
- 逐词时间戳和评分不为空。
- Azure 鉴权失败、网络失败、格式错误都有明确提示。

## 测试建议

- 单元测试：Azure 响应映射。
- 单元测试：错误码映射。
- 集成测试：mock Azure 成功、401、超时、空结果。
- 手动测试：短音频、长音频、低质量音频。

## 风险与后续扩展

- Azure SDK 在 Tauri Rust 环境中的可用性需要验证；如集成成本高，首版可使用 REST 或 Node sidecar 方案。
- 参考文本缺失时评估维度可能受限，UI 需解释当前模式。

