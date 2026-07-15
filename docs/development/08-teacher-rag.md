# 08 教师个性化 RAG

## 目标

构建本地教师案例库，通过智谱 `embedding-3` 和本地 SQLite 向量记录检索相似历史批改案例，并注入 DeepSeek Prompt，使模型更接近个人教师批改风格。

## 不做什么

- 不做云端语料库。
- 不做多人协作语料管理。
- 不做复杂标签体系。
- 不做批量导入首版必选能力。

## 用户流程

1. 用户进入语料页面。
2. 录入学生原始文本、教师修改意见、打分偏好。
3. 保存到本地 SQLite；若已配置智谱 API Key，保存后自动重建 Embedding。
4. 自动重建失败时案例标记为 `failed` 并显示错误摘要；用户仍可手动重建 Embedding。
5. 用户开始新批改。
6. 应用检索最相似的 2-3 个案例。
7. 案例以 XML 格式注入批改 Prompt。

## 技术设计

- 本地 SQLite 通过 Rust `rusqlite` bundled 访问，不依赖用户系统安装 `sqlite3` CLI。
- 数据库打开时启用 `foreign_keys` 和 `busy_timeout`；多步写入使用事务。
- 当前阶段已接入智谱 `embedding-3`：`POST https://open.bigmodel.cn/api/paas/v4/embeddings`，Bearer 鉴权，固定 `dimensions=1024`，请求超时 `45s`，对 timeout、429、5xx 最多重试 2 次。
- 当前阶段使用 `teacher_case_embeddings` SQLite 表存储 f32 little-endian BLOB 向量，并在 Rust 层做 cosine similarity Top-K；检索按 provider、model 和当前 `1024` 维度过滤向量，非当前维度向量不参与检索。当前不存在 2048 维持久化数据，因此无需迁移；后续可按数据规模评估 `sqlite-vec`。
- 当前阶段使用 `teacher_case_query_embeddings` SQLite 表缓存 query embedding；只保存 SHA-256 `query_hash`、provider、model、dimensions 和 f32 BLOB，不保存原始 query，按 `last_used_at` 保留最近 200 条。
- 检索相似度阈值默认 `0.45`，可在 Settings AI 页配置；低于阈值的案例不注入 Prompt。
- 当前阶段已接入 RAG Prompt 准备层：案例清洗、长度截断、XML 转义、最多 3 个带可选 `similarity` 属性的 `<example>`。
- 案例入库和 Prompt 注入前做清洗，保留原文、修改后文本、教师评语和可选打分偏好。
- RAG 检索失败或智谱 Key 未配置不阻塞普通批改。
- 批改结果面板展示本次 RAG 状态、引用案例摘要和相似度；案例库页面提供诊断搜索预览，展示阈值、cache/network 来源、候选数、命中数和 near misses。
- 教师案例库在当前工作台左侧历史栏中作为固定入口 `教师案例库` 展示，UI 索引见 [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md)。

## 数据结构

```ts
type TeacherCaseInput = {
  originalText: string;
  revisedText: string;
  teacherComment: string;
  scoringPreference?: string;
};

type TeacherCase = TeacherCaseInput & {
  id: string;
  embeddingStatus: "pending" | "ready" | "failed";
  embeddingError?: string;
  createdAt: string;
  updatedAt: string;
};

type TeacherCaseMatch = {
  case: TeacherCase;
  score: number;
};

type TeacherCaseSearchDiagnostics = {
  threshold: number;
  topK: number;
  readyCandidateCount: number;
  matchedCount: number;
  belowThresholdCount: number;
  embeddingSource: "cache" | "network";
  durationMs: number;
  included: TeacherCaseMatch[];
  nearMisses: TeacherCaseMatch[];
};
```

## Prompt XML 格式

```xml
<example similarity="0.9123">
  <original_text>...</original_text>
  <revised_text>...</revised_text>
  <teacher_comment>...</teacher_comment>
  <scoring_preference>...</scoring_preference>
</example>
```

## Tauri commands

- `create_teacher_case(input: TeacherCaseInput) -> TeacherCase`
- `list_teacher_cases() -> TeacherCase[]`
- `get_teacher_case(id: string) -> TeacherCase`
- `update_teacher_case(id: string, input: TeacherCaseInput) -> TeacherCase`
- `delete_teacher_case(id: string) -> void`
- `rebuild_teacher_case_embedding(id: string) -> TeacherCase`
- `search_teacher_cases(queryText: string, topK: number) -> TeacherCaseMatch[]`
- `diagnose_teacher_case_search(queryText: string, topK: number, thresholdOverride?: number) -> TeacherCaseSearchDiagnostics`

## 任务拆分

- RAG-001：设计 SQLite 表结构。已完成第一阶段。
- RAG-002：实现案例录入表单。已完成第一阶段。
- RAG-003：实现案例列表和详情。已完成第一阶段：列表、编辑和单条删除。
- RAG-004：实现智谱 `embedding-3` 调用。已完成接口层对接、有限重试和本地人工验证入口。
- RAG-005：接入本地 SQLite 向量存储。已完成 f32 BLOB 向量表；`sqlite-vec` 迁移保留为后续优化。
- RAG-006：实现 Top-K 检索。已完成 Rust 层 cosine similarity、配置化阈值过滤和语料页诊断搜索预览。
- RAG-007：实现案例清洗和长度控制。已完成 Prompt 准备层。
- RAG-008：将检索结果注入 `grade_speaking` Prompt。已完成前端提交前自动检索并按 XML 注入。
- RAG-009：实现 Embedding 失败状态和重建入口。已完成；缺少智谱 Key 时返回明确错误，其他失败写入 `failed` 和 `embeddingError`。
- RAG-010：实现 query embedding cache。已完成；按 provider/model/dimensions/hash 隔离，最多保留 200 条。
- RAG-011：实现搜索诊断和 near misses 展示。已完成。
- RAG-012：实现 pending/failed 顺序重建队列。已完成；不新增批量删除能力。

## 验收标准

- 案例可新增、查看、编辑和单个删除。第一阶段已完成。
- 智谱 Key 缺失时重建和检索返回明确错误；普通评分显示未使用案例库且不阻塞。
- Embedding 成功后状态为 `ready`，并可检索相似案例。
- Prompt 中最多注入 3 个案例，并做 XML 转义和 `similarity` 分数标注。
- Settings AI 页可调整 RAG 相似度阈值，普通评分检索和诊断预览使用同一配置。
- 重复 query 命中 cache 时不重复请求智谱；缓存不保存原始 query。
- Embedding 或检索不可用时仍可普通批改。
- 新建/编辑案例后自动尝试重建 Embedding；失败原因在案例列表展示。
- 批改结果可看到 RAG 引用状态、案例摘要和相似度。
- 案例库搜索预览可看到阈值、cache/network 来源、included 和 near misses。
- 左侧 `教师案例库` 入口、语料页切换和单条删除约束需与 UI 固化文档一致。

## 测试建议

- 单元测试：案例清洗和截断。
- 单元测试：XML 转义。
- 集成测试：SQLite CRUD。
- 集成测试：智谱配置校验、向量存储清理、cosine similarity、阈值过滤、query cache、搜索诊断、旧库迁移。
- 集成测试：RAG Prompt 注入。

## 风险与后续扩展

- 当前向量存储使用 1024 维 f32 BLOB；`dimensions INTEGER` 字段继续记录向量维度并用于严格过滤，数据量增大后应迁移到 `sqlite-vec`。
- 删除案例只能单个明确路径或记录操作，不做批量删除能力。
- 后续可扩展 CSV 导入、标签、query cache 命中率统计和离线校准集。

## 当前验证记录

- 历史智谱 `embedding-3` 真实验证通过：`dimensions=1024`，单次 warmup 延迟约 `419.8 ms`，连续 5 次单次请求平均约 `210.4 ms`，p50 约 `209.1 ms`，p95 约 `263.8 ms`。当前固定维度同为 `1024`，但该记录早于现有 `45s` 超时、有限重试、query cache 和诊断检索链路，仍需使用 `pnpm zhipu:embedding-benchmark` 读取本地 `test-resource/zhipuApiKey.txt` 或 `ZHIPU_API_KEY` 环境变量重新验收；输出不得包含 Key、Authorization header 或原始敏感响应。
- 3 条教师案例重建与 1 次查询的端到端基准通过：总耗时约 `760 ms`，查询延迟约 `188.8 ms`，三条案例 embedding 延迟约 `209.8 ms`、`184.2 ms`、`175.7 ms`。
- Top-K 排序结果：`fluency-focus` `0.9249`，`grammar-focus` `0.8418`，`vocabulary-focus` `0.8266`。
- 真实智谱 API Key 测试未输出 Key；结果用于本地开发基准，不写入仓库数据文件。
