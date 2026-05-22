# 08 教师个性化 RAG

## 目标

构建本地教师案例库，通过 Embedding 和 `sqlite-vec` 检索相似历史批改案例，并注入 DeepSeek Prompt，使模型更接近个人教师批改风格。

## 不做什么

- 不做云端语料库。
- 不做多人协作语料管理。
- 不做复杂标签体系。
- 不做批量导入首版必选能力。

## 用户流程

1. 用户进入语料页面。
2. 录入学生原始文本、教师修改意见、打分偏好。
3. MVP 4 第一阶段先保存到本地 SQLite，并将 `embeddingStatus` 标记为 `pending`。
4. 后续阶段生成 Embedding。
5. 用户开始新批改。
6. 应用检索最相似的 2-3 个案例。
7. 案例以 XML 格式注入批改 Prompt。

## 技术设计

- 本地 SQLite 存储案例元数据。
- 第一阶段已接入 SQLite CRUD，通过系统 `sqlite3` 写入本地数据库；不接 Embedding、`sqlite-vec`、Top-K 检索和 Prompt 注入。
- `sqlite-vec` 存储和检索向量。
- Embedding 使用 DeepSeek Embedding API。
- 案例入库前做清洗，保留原文、修改后文本、教师评语。
- 单个 Prompt example 目标控制在约 500 tokens。
- RAG 检索失败不阻塞普通批改。

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
</example>
```

## Tauri commands

- `create_teacher_case(input: TeacherCaseInput) -> TeacherCase`
- `list_teacher_cases() -> TeacherCase[]`
- `get_teacher_case(id: string) -> TeacherCase`
- `update_teacher_case(id: string, input: TeacherCaseInput) -> TeacherCase`
- `delete_teacher_case(id: string) -> void`
- `rebuild_teacher_case_embedding(id: string) -> TeacherCase`。后续阶段实现。
- `search_teacher_cases(queryText: string, topK: number) -> TeacherCaseMatch[]`。后续阶段实现。

## 任务拆分

- RAG-001：设计 SQLite 表结构。已完成第一阶段。
- RAG-002：实现案例录入表单。已完成第一阶段。
- RAG-003：实现案例列表和详情。已完成第一阶段：列表、编辑和单条删除。
- RAG-004：实现 DeepSeek Embedding 调用。
- RAG-005：接入 `sqlite-vec` 存储向量。
- RAG-006：实现 Top-K 检索。
- RAG-007：实现案例清洗和长度控制。
- RAG-008：将检索结果注入 `grade_speaking` Prompt。
- RAG-009：实现 Embedding 失败状态和重建入口。

## 验收标准

- 案例可新增、查看、编辑和单个删除。第一阶段已完成。
- Embedding 成功后状态为 `ready`。
- 新批改能检索相似案例。
- Prompt 中最多注入 3 个案例。
- Embedding 或检索失败时仍可普通批改。

## 测试建议

- 单元测试：案例清洗和截断。
- 单元测试：XML 转义。
- 集成测试：SQLite CRUD。
- 集成测试：Top-K 返回顺序。
- 集成测试：RAG Prompt 注入。

## 风险与后续扩展

- DeepSeek Embedding API 的模型名和向量维度需要在实现时确认。
- 删除案例只能单个明确路径或记录操作，不做批量删除能力。
- 后续可扩展 CSV 导入、标签、搜索和向量重建队列。
