# 开发文档索引

## 目标

本目录用于承接 `DEVELOPMENT_PLAN.md` 的细颗粒度开发计划。每份文档对应一个功能模块，任务拆分控制在 1-2 天可完成、可验收的范围。

## 当前状态

- MVP 1~4 全部功能已完成并通过自动化验证。
- MVP 5 稳定化进行中：R-401~R-403、R-405~R-406 已完成；R-404 手动验收 deferred。
- MVP 5 附加改进任务 R-501~R-508 已规划，详见 [11-mvp5-improvements.md](11-mvp5-improvements.md)。
- 当前自动化验证记录：`pnpm typecheck`、`pnpm test`、`pnpm build`、`cd src-tauri && cargo test -- --test-threads=1` 均通过。
- 当前真实服务 CLI 预检：使用本地测试资源验证 Azure Speech token/WAV 样本和 DeepSeek `/models`、JSON mode，输出未包含 API Key 或短期 token。
- 当前 deferred 人工验收：Tauri 桌面 UI 中配置真实 Azure Speech Key 后，用 30 秒以上 WAV 验证 continuous pronunciation assessment、点击跳转和播放高亮。
- UI 固化文档：[10-assessor-ui-redesign.md](10-assessor-ui-redesign.md)。UI 规范以当前代码实现为准，后续 UI 改动需同步更新该文档。

## 推荐阅读顺序

1. [00-roadmap.md](00-roadmap.md)
2. [01-project-foundation.md](01-project-foundation.md)
3. [02-app-shell-theme.md](02-app-shell-theme.md)
4. [03-settings-config.md](03-settings-config.md)
5. [04-deepseek-grading.md](04-deepseek-grading.md)
6. [05-media-processing.md](05-media-processing.md)
7. [06-azure-speech-assessment.md](06-azure-speech-assessment.md)
8. [07-transcript-playback-sync.md](07-transcript-playback-sync.md)
9. [08-teacher-rag.md](08-teacher-rag.md)
10. [09-testing-acceptance.md](09-testing-acceptance.md)
11. [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md)
12. [11-mvp5-improvements.md](11-mvp5-improvements.md)

## 模块依赖

```mermaid
flowchart TD
  A["01 基础工程"] --> B["02 应用壳与主题"]
  A --> C["03 设置与配置"]
  C --> D["04 DeepSeek 批改"]
  A --> E["05 媒体处理"]
  C --> F["06 Azure 语音评估"]
  E --> F
  F --> G["07 Transcript 与播放同步"]
  D --> H["08 教师 RAG"]
  C --> H
  H --> D
  D --> I["09 测试与验收"]
  G --> I
  B --> J["10 UI 固化"]
  D --> J
  E --> J
  F --> J
  G --> J
  H --> J
```

## 文档模板

每份功能文档应包含：

- 目标
- 不做什么
- 用户流程
- 技术设计
- 数据结构
- 任务拆分
- 验收标准
- 测试建议
- 风险与后续扩展

## 执行原则

- 先保证单机个人使用链路稳定，再扩展复杂能力。
- 外部服务统一由 Rust 后端命令层调用。
- 前端只处理交互、展示和本地状态，不直接持有敏感密钥。
- Azure Speech 例外：Rust 后端只签发短期 token，前端 SDK 使用 token 做 continuous recognition，仍不持有 Azure Key。
- 任何功能都必须有明确失败状态。
- 不批量删除文件或目录。
- UI 设计冲突时以当前代码实现为准，并同步更新 `10-assessor-ui-redesign.md`。

## 测试资源目录

- `test-resource/` 是本项目约定的本地测试资源目录，用于放置人工验收或本地调试用的媒体样本、压缩包和临时输入文件。
- `test-resource/` 不属于产品运行数据，也不属于发布资产。
- `test-resource/` 已加入 `.gitignore`，默认不提交到仓库。
- 开发文档、测试记录或人工验收说明可以引用该目录中的样本用途，但不要提交大体积或版权不明的测试媒体文件。
