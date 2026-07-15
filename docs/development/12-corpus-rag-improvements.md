# 12 教师案例库 RAG 设计审查与改进计划

## 目标

针对本地知识库（教师案例库 + 智谱 embedding + RAG 注入）的设计审查结论，制定分阶段改进计划：先根治存储层的可靠性与部署风险，再提升检索质量，最后补齐 RAG 透明度与维护性。保持「教师案例库」定位不变。

## 当前状态

- Phase 1 已完成：教师案例库存储层已迁移到 `rusqlite` bundled、参数化查询、事务、UUID、毫秒时间戳和 f32 BLOB 向量。
- Phase 2 已完成：相似度阈值、score 透传、自动 embedding、`failed + embedding_error`、有限重试和题目+答案检索 query 已落地。
- Phase 3 已完成：批改结果 RAG 引用展示、语料页搜索预览、失败原因展示和死代码清理已落地。
- Phase 4 已完成：相似度阈值配置化、query embedding 缓存、检索诊断、pending/failed 队列重建和本地 benchmark 脚本已落地。
- CRI-207/CRI-405 仅保留为本地真实 Key 基准记录任务：不得提交、打印或写入任何真实 API Key。

## 不做什么

- 不做文档级 RAG：不引入文档导入、粘贴长文、分块（chunking）与 chunk 级检索。
- 不引入 `sqlite-vec`：个人规模（几十~几百条案例）下暴力余弦足够，仅预留迁移位。
- 不做云端语料库、多人协作和复杂标签体系（与 [08-teacher-rag.md](08-teacher-rag.md) 的 non-goals 一致）。

## 审查结论

### 现状概述

本章初始审查时的实现为「教师案例库」：每条记录是 `(originalText, revisedText, teacherComment, scoringPreference?)` 四元组，整条拼接后调用智谱 `embedding-3`（当时固定 2048 维）生成单个向量存入 SQLite；批改时前端以学生答案全文检索 Top-3 案例，注入 DeepSeek Prompt 的 `<teacher_examples>` XML 块。定位本身符合 08 号文档设计，问题集中在实现方式与检索质量。

### P0 缺陷 — 可靠性与部署风险

| 编号 | 缺陷 | 位置 | 根因与影响 |
| --- | --- | --- | --- |
| D-01 | SQLite 层整体通过外壳调用系统 `sqlite3` CLI 实现，`Cargo.toml` 无任何 SQLite crate | `corpus.rs:741-764` | 打包分发后用户机器上很可能没有 `sqlite3`，整个案例库功能不可用（`CORPUS_SQLITE_UNAVAILABLE`）。最大部署风险。 |
| D-02 | `sqlite_text_literal` 转义：每转义一个字符串值需写共享临时目录临时文件 + 起一个 `sqlite3 :memory:` 进程执行 `quote(readfile())`；任何 I/O 或进程失败时静默降级为 `''` | `corpus.rs:800-827` | 数据可能被无声写空、ID 变空串且无任何报错；一次 create/update spawn 多个进程，叠加检索的 N+1 查询（`corpus.rs:163-169`）单次检索可 spawn 数十个进程。 |
| D-03 | 无事务：update 案例 + 删旧 embedding、写 embedding + 置 `ready` 均为两次独立进程调用 | `corpus.rs:383-384`、`corpus.rs:135-136` | 中断后留下状态与向量不一致；无 `busy_timeout`，并发下 `SQLITE_BUSY` 表现为不透明的 `CORPUS_SQLITE_FAILED`。 |
| D-04 | async 命令内做阻塞 I/O：`search`/`rebuild` 在 Tauri async runtime 线程上直接跑同步 `Command` 和 fs 操作 | `corpus.rs:741-764`、`corpus.rs:800-827` | 未用 `spawn_blocking`，叠加 45s HTTP 超时可阻塞 runtime worker。 |
| D-05 | ID 用纳秒时间戳生成并作为 PRIMARY KEY；时间戳存为纳秒字符串 | `corpus.rs:868-881` | 快速连续创建可主键碰撞（表现为不透明 SQL 错误）；排序依赖等宽字符串的巧合，脆弱。 |

### P1 缺陷 — 检索质量

| 编号 | 缺陷 | 位置 | 根因与影响 |
| --- | --- | --- | --- |
| D-06 | 无相似度阈值，Top-K 恒返回结果 | `corpus.rs:140-170` | 弱相关甚至无关案例照样注入 Prompt，可能带偏评分。 |
| D-07 | 余弦相似度 score 在前端映射时被丢弃 | `src/lib/corpus.ts:33-40` | LLM 无从得知示例匹配强弱，无法自行降权弱匹配。 |
| D-08 | Embedding 需手动逐条重建：create/update 后状态置 `pending`，用户须手动点「重建 Embedding」 | `CorpusPage.tsx`、`corpus.rs:89-97` | 忘点则案例静默不参与检索，无任何提示。 |
| D-09 | `failed` 状态不可达：枚举定义了但无代码路径写入 | `corpus.rs:26` | Embedding 失败后案例永远显示 `pending`，误导用户。 |
| D-10 | 向量存为 f64 JSON 文本，每次检索全量载入重新解析 | `corpus.rs:421` | 2048 维每条几十 KB 文本，比 f32 BLOB 大 2-3 倍且解析慢。 |
| D-11 | Embedding 请求无重试、无限流、无查询缓存；每次批改都重新 embed 查询文本 | `corpus.rs:562-647`、`corpus.rs:148` | 429/超时直接失败无退避；重复批改同一文本浪费延迟与配额。 |
| D-12 | 检索 query 仅用学生答案全文，未纳入题目；Workspace 中 question 默认硬编码示例题 | `useGradingWorkflow.ts:41`、`Workspace.tsx:40` | 检索上下文单一，且默认题目易被遗忘修改，影响相似度语境。 |

### P2 缺陷 — 透明度与维护性

| 编号 | 缺陷 | 位置 | 根因与影响 |
| --- | --- | --- | --- |
| D-13 | RAG 完全静默：检索失败或未配智谱 Key 时 catch 吞掉返回 `[]`，批改照常 | `useGradingWorkflow.ts:36-45` | 结果面板不显示引用了哪些案例与相似度，教师无法判断个性化是否真的生效。 |
| D-14 | 语料页无检索预览：`search_teacher_cases` 命令已存在但 UI 无查询入口 | `CorpusPage.tsx` | 调试检索质量只能跑真实批改。 |
| D-15 | 死代码：`GradingPage.tsx` 完整但无处引用，RAG 注入逻辑与 `useGradingWorkflow` 双份可漂移；`getTeacherCase` 前端包装从未调用 | `src/features/grading/GradingPage.tsx`、`src/lib/corpus.ts:13` | 维护漂移风险。 |
| D-16 | 文档漂移：2048 维从未用真实 Key 基准测试；文档说「2-3 条」而代码恒取 3 | `08-teacher-rag.md:116`、`useGradingWorkflow.ts:41` | 验证记录与实现不一致。 |

## 技术设计

### Phase 1（P0）存储层迁移 rusqlite

- 引入 `rusqlite`（`bundled` feature 内嵌 SQLite），彻底消除对系统 `sqlite3` CLI 的运行时依赖，覆盖 D-01。
- 参数化查询全面替换 `sqlite_text_literal` 与 SQL 字符串拼接，删除临时文件转义路径，覆盖 D-02。
- 连接管理：通过同步 helper 打开 `rusqlite` 连接，打开时执行 `PRAGMA foreign_keys = ON` 与 `PRAGMA busy_timeout`；Tauri async command 中 DB 操作进入 `spawn_blocking`。
- 多步写操作包事务：update 案例 + 删旧 embedding、写 embedding + 置 `ready`，覆盖 D-03。
- async 命令中 DB 操作移入 `tauri::async_runtime::spawn_blocking`（或等效），HTTP 保持 reqwest async，覆盖 D-04。
- ID 改为 UUID v4；`created_at`/`updated_at` 存整数毫秒（`INTEGER`），覆盖 D-05。
- 向量改存 f32 小端 BLOB；保留 `provider`/`model`/`dimensions` 过滤逻辑不变，覆盖 D-10。
- 数据迁移：启动时检测旧 schema（TEXT 纳秒时间戳 + JSON 向量），先备份原 db 文件再一次性迁移；迁移失败保留备份并返回明确错误。

### Phase 2（P1）检索质量

- 相似度阈值：默认 `0.45`，低于阈值的匹配不注入 Prompt；全部低于阈值时按无案例处理，覆盖 D-06。
- score 透传：`RagPromptExample` 增加 `score` 字段，Prompt XML 的 `<example>` 携带 `similarity` 属性供 LLM 参考，覆盖 D-07。
- 自动 embedding：create/update 成功后自动触发重建（保留手动重建入口作为兜底），覆盖 D-08。
- 失败状态落地：embedding 失败时写入 `failed` 状态与错误摘要字段（新增 `embedding_error TEXT`），覆盖 D-09。
- 有限重试：embedding 请求对 429/超时/5xx 做最多 2 次指数退避重试，覆盖 D-11。
- 检索 query 拼入题目上下文（`question + answer`），并去除 Workspace 默认硬编码题目（改为空值 + 占位提示），覆盖 D-12。
- 本章制定时原计划用真实智谱 Key 补做 `dimensions=2048` 的延迟/质量基准以覆盖 D-16 前半；固定维度现已调整为 `1024`，当前验收改由 RH-405 补做 `dimensions=1024` 基准并回填 [08-teacher-rag.md](08-teacher-rag.md)。实现和文档均不得读取或提交真实 Key。

### Phase 3（P2）透明度与维护性

- 批改结果显示 RAG 元信息：「本次引用 N 条教师案例」+ 每条案例摘要与相似度；检索失败或未配 Key 时显式提示（不阻塞批改），覆盖 D-13。
- 语料页增加检索预览：输入任意文本 → 显示 Top-K 匹配与 score，复用现有 `search_teacher_cases`，覆盖 D-14。
- 案例列表展示 `failed` 状态的错误原因，配合 Phase 2 的 `embedding_error` 字段。
- 清理死代码：删除 `src/features/grading/GradingPage.tsx` 与未使用的 `getTeacherCase` 前端包装（后端命令保留），覆盖 D-15。
- 同步更新 [08-teacher-rag.md](08-teacher-rag.md) 技术设计小节（存储实现、阈值、自动重建），消除文档漂移，覆盖 D-16 后半。

### Phase 4（P2）RAG 校准与可观测

- 阈值配置化：`PublicAppConfig.zhipu.similarityThreshold` 默认 `0.45`，Settings AI 页可调整并由后端校验 `0.0-1.0`。
- Query embedding 缓存：新增 `teacher_case_query_embeddings` 表，仅存 `query_hash`、provider、model、dimensions、f32 BLOB 和 LRU 时间戳；hash 由 provider/model/dimensions/规范化 query 计算，不保存原始 query。
- 检索诊断：新增 `diagnose_teacher_case_search(queryText, topK, thresholdOverride?)`，返回阈值、候选数、命中数、低于阈值数、cache/network 来源、耗时、included 和 near misses。
- 语料页搜索预览改用诊断结果，显示阈值、缓存来源、入选案例和低于阈值的 near misses。
- 维护重建：语料页新增“重建 pending/failed”按钮，前端按顺序调用现有 `rebuild_teacher_case_embedding`，不新增批量删除能力。
- 本地 benchmark：新增 `pnpm zhipu:embedding-benchmark`，读取 `ZHIPU_API_KEY` 或 `test-resource/zhipuApiKey.txt`，只输出维度、样本数、延迟统计、HTTP 状态计数和通过状态，不输出 Key/Header/原始敏感响应。

## 任务拆分

### Phase 1

- CRI-101：引入 `rusqlite`（bundled），实现连接管理和 PRAGMA。已完成。
- CRI-102：用参数化查询重写 `teacher_cases` CRUD，删除 `sqlite_text_literal` 与 CLI 调用路径。已完成。
- CRI-103：用参数化查询重写 embedding 表读写，向量改存 f32 LE BLOB。已完成。
- CRI-104：多步写操作事务化（update+删 embedding、写 embedding+置 ready）。已完成。
- CRI-105：async 命令 DB 操作移入 spawn_blocking。已完成。
- CRI-106：ID 改 UUID，时间戳改整数毫秒。已完成。
- CRI-107：旧库检测 + 备份 + 一次性迁移（时间戳、向量格式、ID 保持原值不变）。已完成。
- CRI-108：迁移后回归 cargo test（含转义边界、事务中断、迁移用例）。已完成。

### Phase 2

- CRI-201：检索加相似度阈值（常量 + 过滤逻辑 + 单测）。已完成。
- CRI-202：score 透传至 `RagPromptExample` 与 Prompt XML `similarity` 属性。已完成。
- CRI-203：create/update 后自动触发 embedding 重建。已完成。
- CRI-204：`failed` 状态与 `embedding_error` 字段落地。已完成。
- CRI-205：embedding 请求指数退避重试（429/超时/5xx，最多 2 次）。已完成。
- CRI-206：检索 query 拼入题目上下文；移除 Workspace 硬编码默认题。已完成。
- CRI-207：本章原任务为真实 Key 补做 2048 维基准；当前待验收目标已随固定维度调整为 1024，并由 RH-405 承接。仅本地人工执行并回填 08 号文档，不提交 Key。

### Phase 3

- CRI-301：批改结果面板显示 RAG 引用信息与失败提示。已完成。
- CRI-302：语料页检索预览框（Top-K + score）。已完成。
- CRI-303：案例列表展示 embedding 失败原因。已完成。
- CRI-304：删除死代码 `GradingPage.tsx` 与 `getTeacherCase` 前端包装。已完成。
- CRI-305：同步更新 08 号文档技术设计与验收标准。已完成。

### Phase 4

- CRI-401：`zhipu.similarityThreshold` 配置化，Settings AI 页可保存并回显。已完成。
- CRI-402：新增 query embedding SQLite cache、SHA-256 hash、cache hit 更新时间和 200 条 LRU 裁剪。已完成。
- CRI-403：新增 `diagnose_teacher_case_search` command 与诊断返回类型。已完成。
- CRI-404：语料页搜索预览改用诊断结果展示 included 和 near misses。已完成。
- CRI-405：新增 `pnpm zhipu:embedding-benchmark` 本地基准脚本。已完成；真实 Key 数据仅本地人工执行。
- CRI-406：语料页新增 pending/failed 顺序重建队列。已完成。
- CRI-407：同步更新 Phase 4 文档与测试说明。已完成。

## 验收标准

- 在未安装 `sqlite3` CLI 的环境中，案例库全部功能正常（Phase 1 核心验收）。
- 含单引号、换行、CJK、emoji 的案例字段可正确写入与读回，无静默置空。
- update/rebuild 过程中断后重启，状态与向量保持一致（无 `ready` 无向量、无 `pending` 带新向量）。
- 旧版本数据库首次启动自动迁移成功，原文件有备份；迁移失败时报明确错误且原库不损坏。
- 相似度低于阈值的案例不出现在 Prompt 中；Prompt 中的 `<example>` 携带 `similarity`。
- Settings 中可调整教师案例 RAG 相似度阈值；普通评分检索和语料页诊断预览使用同一配置。
- 重复 query 命中 query embedding cache 时不重复请求智谱；缓存不保存原始 query，最多保留 200 条。
- 语料页搜索预览能显示阈值、cache/network 来源、耗时、候选数、included 和 near misses。
- pending/failed 队列重建按单条 rebuild 顺序执行，并显示进度与失败数量。
- `pnpm zhipu:embedding-benchmark` 缺 Key 时明确失败；有 Key 时输出延迟和状态统计且不打印 Key/Header/原始响应。
- 新建/编辑案例后无需手动操作即可参与检索；embedding 失败的案例显示 `failed` 与原因。
- 批改结果中可看到本次引用的案例数量、摘要与相似度；未配 Key 时有显式提示且批改不受阻。

## 测试建议

- Rust 单元测试：参数化写入的转义边界（引号/换行/CJK/emoji）、f32 BLOB 编解码往返、阈值过滤、query hash/cache/LRU、检索诊断、事务回滚。
- Rust 集成测试：`search_teacher_cases_at_path` 端到端排序与阈值行为（当前无此覆盖）；旧库迁移用例（构造旧 schema 临时库）。
- 前端 Vitest：`mapTeacherCaseMatchesToRagExamples` 的 score 透传、Settings 阈值保存、RAG 提示信息渲染、诊断搜索预览和 pending/failed 队列重建。
- 人工验收：真实智谱 Key 下执行 `pnpm zhipu:embedding-benchmark`，补充当前 1024 维基准与检索预览体验。

## 风险与后续扩展

- `rusqlite` bundled 会增加 Rust 编译时间与产物体积；可接受，换取零运行时依赖。
- 数据迁移是一次性破坏性操作：必须先备份原 db 文件，迁移失败保留备份并拒绝启用新表。
- 阈值 0.45 为经验起点，已暴露为本地配置；仍需结合真实 Key 基准（CRI-207/CRI-405）继续校准。
- 数据量增大（数千条以上）后再评估 `sqlite-vec`；当前 schema 的 BLOB 向量格式与其兼容，迁移成本低。
- 后续扩展（不在本计划内）：CSV 批量导入、标签、案例去重检测、query cache 命中率趋势和更细粒度校准集。
