# 04 DeepSeek 批改生成

## 目标

实现雅思口语文本批改能力：根据输入文本生成总分、四项小分、教师风格评语、词汇纠错和高分重构示范。

## 不做什么

- 不在本阶段处理音频。
- 不在本阶段接入 RAG。
- 不展示模型推理链。

## 用户流程

1. 用户进入批改页。
2. 输入雅思口语回答文本。
3. 可选择 Part 1、Part 2、Part 3。
4. 点击批改。
5. 页面展示结构化评分与建议。

## 技术设计

- 前端提交 `GradeRequest` 给 Rust command。
- Rust command 读取 DeepSeek 配置并调用 API。
- 请求使用 `response_format: { "type": "json_object" }`。
- System Prompt 强制原始 JSON 输出。
- 响应进入 JSON 清洗函数，再做 Schema 校验。
- 校验失败时保留原始响应摘要用于调试，但不显示密钥。

## 数据结构

```ts
type GradeRequest = {
  text: string;
  part: "part1" | "part2" | "part3";
  question?: string;
  ragExamples?: RagPromptExample[];
};

type GradeResult = {
  overall_band: number;
  sub_scores: {
    FC: number;
    LR: number;
    GRA: number;
    PR: number;
  };
  personal_style_comment: string;
  vocabulary_corrections: Array<{
    original: string;
    suggested: string;
    reason: string;
  }>;
  reconstructed_essay: string;
};

type RagPromptExample = {
  original_text: string;
  revised_text: string;
  teacher_comment: string;
};
```

## Prompt 约束

必须包含以下要求：

- 按 IELTS Speaking 标准评分。
- 只输出 JSON，不输出 Markdown。
- 不使用 code fence。
- `overall_band` 和四项小分使用 0-9 分。
- 词汇纠错必须说明原因。
- 重构示范保持学生原意，不虚构经历。

## Tauri commands

- `grade_speaking(request: GradeRequest) -> GradeResult`
- `validate_deepseek_config() -> ConfigValidationResult`

## 任务拆分

- G-001：实现批改页输入表单。
- G-002：设计 DeepSeek System Prompt 和 User Prompt。
- G-003：实现 Rust DeepSeek HTTP client。
- G-004：实现 JSON 清洗函数。
- G-005：实现 `GradeResult` Schema 校验。
- G-006：实现批改结果展示组件。
- G-007：实现错误状态和重试入口。
- G-008：为后续 RAG 预留 `ragExamples` Prompt 注入位置。

## 验收标准

- 输入合法文本可获得结构化结果。
- 模型返回 Markdown 包裹 JSON 时仍可解析。
- 模型返回字段缺失时显示格式错误。
- 空文本不能提交。
- API Key 缺失时不发起请求。

## 测试建议

- 单元测试：JSON 清洗。
- 单元测试：Schema 校验。
- 单元测试：Prompt 组装。
- 集成测试：mock DeepSeek 成功、超时、401、非法 JSON。

## 风险与后续扩展

- `deepseek-reasoner` 响应更慢，首版应显示明确 loading 状态。
- 第三方 Base URL 可能不支持 `response_format`，需将错误提示具体化。

