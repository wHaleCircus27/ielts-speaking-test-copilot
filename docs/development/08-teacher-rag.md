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
3. 当前阶段先保存到本地 SQLite，并将 `embeddingStatus` 标记为 `pending`。
4. 用户在设置页配置智谱 API Key 后，可为案例重建 Embedding。
5. 用户开始新批改。
6. 应用检索最相似的 2-3 个案例。
7. 案例以 XML 格式注入批改 Prompt。

## 技术设计

- 本地 SQLite 存储案例元数据。
- 第一阶段已接入 SQLite CRUD，通过系统 `sqlite3` 写入本地数据库。
- 当前阶段已接入智谱 `embedding-3`：`POST https://open.bigmodel.cn/api/paas/v4/embeddings`，Bearer 鉴权，默认 `dimensions=1024`。
- 当前阶段使用 `teacher_case_embeddings` SQLite 表存储 JSON 向量，并在 Rust 层做 cosine similarity Top-K；后续可迁移到 `sqlite-vec`。
- 当前阶段已接入 RAG Prompt 准备层：案例清洗、长度截断、XML 转义、最多 3 个 `<example>`。
- 案例入库和 Prompt 注入前做清洗，保留原文、修改后文本、教师评语和可选打分偏好。
- RAG 检索失败或智谱 Key 未配置不阻塞普通批改。

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
  createdAt: string;
  updatedAt: string;
};

type TeacherCaseMatch = {
  case: TeacherCase;
  score: number;
};
```

## Prompt XML 格式

```xml
<example>
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

## 任务拆分

- RAG-001：设计 SQLite 表结构。已完成第一阶段。
- RAG-002：实现案例录入表单。已完成第一阶段。
- RAG-003：实现案例列表和详情。已完成第一阶段：列表、编辑和单条删除。
- RAG-004：实现智谱 `embedding-3` 调用。已完成接口层对接，等待真实 Key 人工验证。
- RAG-005：接入本地 SQLite 向量存储。已完成 JSON 向量表；`sqlite-vec` 迁移保留为后续优化。
- RAG-006：实现 Top-K 检索。已完成 Rust 层 cosine similarity。
- RAG-007：实现案例清洗和长度控制。已完成 Prompt 准备层。
- RAG-008：将检索结果注入 `grade_speaking` Prompt。已完成前端提交前自动检索并按 XML 注入。
- RAG-009：实现 Embedding 失败状态和重建入口。已完成；缺少智谱 Key 时返回明确错误。

## 验收标准

- 案例可新增、查看、编辑和单个删除。第一阶段已完成。
- 智谱 Key 缺失时重建和检索返回明确错误。
- Embedding 成功后状态为 `ready`，并可检索相似案例。
- Prompt 中最多注入 3 个案例，并做 XML 转义。
- Embedding 或检索不可用时仍可普通批改。

## 测试建议

- 单元测试：案例清洗和截断。
- 单元测试：XML 转义。
- 集成测试：SQLite CRUD。
- 集成测试：智谱配置校验、向量存储清理、cosine similarity。
- 集成测试：RAG Prompt 注入。

## 风险与后续扩展

- 当前向量存储使用 JSON 文本，数据量增大后应迁移到 `sqlite-vec`。
- 删除案例只能单个明确路径或记录操作，不做批量删除能力。
- 后续可扩展 CSV 导入、标签、搜索和向量重建队列。

## 当前验证记录

- 智谱 `embedding-3` 真实验证通过：`dimensions=1024`，单次 warmup 延迟约 `419.8 ms`，连续 5 次单次请求平均约 `210.4 ms`，p50 约 `209.1 ms`，p95 约 `263.8 ms`。
- 3 条教师案例重建与 1 次查询的端到端基准通过：总耗时约 `760 ms`，查询延迟约 `188.8 ms`，三条案例 embedding 延迟约 `209.8 ms`、`184.2 ms`、`175.7 ms`。
- Top-K 排序结果：`fluency-focus` `0.9249`，`grammar-focus` `0.8418`，`vocabulary-focus` `0.8266`。
- 真实智谱 API Key 测试未输出 Key；结果用于本地开发基准，不写入仓库数据文件。
