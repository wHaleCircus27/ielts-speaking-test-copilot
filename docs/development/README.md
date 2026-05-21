# 开发文档索引

## 目标

本目录用于承接 `DEVELOPMENT_PLAN.md` 的细颗粒度开发计划。每份文档对应一个功能模块，任务拆分控制在 1-2 天可完成、可验收的范围。

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
- 任何功能都必须有明确失败状态。
- 不批量删除文件或目录。

