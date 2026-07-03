# 雅思口语智能批改助手开发总纲

## 1. 产品目标

本项目是一个个人专用的 macOS 本地雅思口语批改与个性化训练工具。首版面向 Apple Silicon 设备，采用 Tauri 2、React 18、Vite、Tailwind CSS、Rust 后端命令层、本地 FFmpeg、Azure Pronunciation Assessment、DeepSeek API 和本地教师案例 RAG。

首版优先交付一条稳定的个人使用链路：

1. 输入或导入口语内容。
2. 完成文本批改、评分和修改建议生成。
3. 导入音频并转码为语音评估标准格式。
4. 获取逐词语音评估、停顿、发音问题和播放同步。
5. 使用本地教师历史案例强化批改风格。

## 2. 首版范围

### 必做

- Tauri 2 + React 18 + Vite + TypeScript 基础工程。
- Tailwind CSS 与三套主题：`theme-claude`、`theme-animal`、`theme-glass`。
- DeepSeek 配置、文本批改、结构化结果展示。
- DeepSeek JSON 输出清洗、Schema 校验和错误处理。
- 本地媒体导入与 FFmpeg sidecar 转码。
- Azure Pronunciation Assessment 集成。
- 逐词 transcript、停顿标注、低分发音标注和播放器同步。
- 本地教师案例库、Embedding、Top-K 检索和 Prompt 注入。
- 基础测试矩阵与人工验收流程。

### 不做

- Mac App Store 分发。
- 自动更新。
- 多用户账号系统。
- 云同步。
- 团队权限管理。
- 完整学习计划系统。
- SpeechSuper 首版真实接入。
- Ollama 首版完整适配。

## 3. MVP 路线图

| 阶段 | 目标 | 主要交付 |
| --- | --- | --- |
| MVP 1 | 基础工程与文本批改 | 桌面应用壳、设置、本地配置、DeepSeek 批改、结果页 |
| MVP 2 | 媒体处理 | 文件导入、FFmpeg sidecar、WAV 转码、音频播放器 |
| MVP 3 | 语音评估与播放同步 | Azure 发音评估、逐词时间戳、停顿、低分词、点击跳转 |
| MVP 4 | 教师个性化 RAG | 教师案例录入、SQLite、JSON 向量存储、Embedding、Prompt 注入 |
| MVP 5 | 稳定化与改进 | 测试补齐、错误体验、性能检查、架构改进、发布前验收 |

当前状态：MVP 4 教师个性化 RAG 已全部完成（SQLite CRUD、智谱 embedding-3、cosine similarity Top-K、RAG Prompt 注入）。MVP 5 稳定化进行中，原有任务 R-401~R-403、R-405~R-406 已通过自动化验证，R-404 真实 Azure 桌面 UI 人工验收 deferred；附加改进任务 R-501~R-508 已完成，详见 `docs/development/11-mvp5-improvements.md`。

## 4. 功能模块

详细开发文档位于 `docs/development/`：

- [开发文档索引](docs/development/README.md)
- [00-roadmap.md](docs/development/00-roadmap.md)
- [01-project-foundation.md](docs/development/01-project-foundation.md)
- [02-app-shell-theme.md](docs/development/02-app-shell-theme.md)
- [03-settings-config.md](docs/development/03-settings-config.md)
- [04-deepseek-grading.md](docs/development/04-deepseek-grading.md)
- [05-media-processing.md](docs/development/05-media-processing.md)
- [06-azure-speech-assessment.md](docs/development/06-azure-speech-assessment.md)
- [07-transcript-playback-sync.md](docs/development/07-transcript-playback-sync.md)
- [08-teacher-rag.md](docs/development/08-teacher-rag.md)
- [09-testing-acceptance.md](docs/development/09-testing-acceptance.md)
- [10-assessor-ui-redesign.md](docs/development/10-assessor-ui-redesign.md)
- [11-mvp5-improvements.md](docs/development/11-mvp5-improvements.md)

## 5. 推荐实施顺序

1. 建立基础工程、目录结构、Tauri command 调用约定。
2. 实现应用壳、主题系统和设置页。
3. 实现 DeepSeek 文本批改闭环。
4. 接入 FFmpeg sidecar 和媒体转码。
5. 接入 Azure Pronunciation Assessment。
6. 实现 transcript 渲染和播放器同步。
7. 实现教师 RAG 案例库和 Prompt 注入。
8. 补齐测试、错误边界和人工验收清单。

## 6. 全局接口约定

首版 Tauri commands 以业务能力命名，前端不直接访问本地文件系统、系统进程和密钥存储。

```ts
type AppConfig = {
  theme: "theme-claude" | "theme-animal" | "theme-glass";
  deepseek: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model:
      | "deepseek-v4-flash"
      | "deepseek-v4-pro"
      | "deepseek-chat"
      | "deepseek-reasoner";
  };
  azure: {
    keyConfigured: boolean;
    region: string;
    language: string;
  };
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
```

当前默认 DeepSeek 模型为 `deepseek-v4-flash`，设置页主推 `deepseek-v4-flash` 和 `deepseek-v4-pro`。旧模型值 `deepseek-chat`、`deepseek-reasoner` 仅用于兼容既有本地配置。

DeepSeek 配置校验已升级为真实 `/models` 连通性探测，返回当前模型是否可用、服务是否可达和可用模型列表。该探测只在 Rust command 层读取本地密钥，前端不接触真实 API Key。

## 7. 全局验收标准

- 应用可在目标 macOS 设备启动。
- 设置保存后重启仍可恢复。
- 缺少 API Key 或服务错误时页面不崩溃，并给出可理解提示。
- 文本批改返回结构化分数和建议。
- 媒体文件可转码为 `WAV 16kHz 16bit mono PCM`。
- Azure 返回结果能正确标注逐词评分和停顿。
- 播放器点击单词可跳转，播放中高亮当前词。
- MVP 3 当前以微软文档一致性、SDK 调用形态和 mock 自动化验证作为收口标准。
- 教师案例新增后能参与相似案例检索和 Prompt 注入。

## 8. 全局工程约束

- 禁止批量删除文件或目录。
- 不使用 `del /s`、`rd /s`、`rmdir /s`、`Remove-Item -Recurse`、`rm -rf`。
- 如需删除文件，只能一次删除一个明确路径的文件。
- 如果需要批量删除文件，停止操作并让用户手动删除。
- API Key 不写入前端源码和日志。
- 本地路径、转码日志和 API 错误信息不得泄露密钥。
- 首版以可维护的模块边界优先，不提前做复杂插件化。
