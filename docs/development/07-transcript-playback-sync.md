# 07 Transcript 与播放同步

## 目标

基于 Azure 返回的逐词时间戳和评分，渲染可交互 transcript，实现停顿标注、低分词标注、音素错误 hover 和播放器同步。

## 不做什么

- 不做完整字幕编辑器。
- 不做手动修正时间戳。
- 不做多轨音频播放。

## 用户流程

1. 用户完成语音评估。
2. 页面展示逐词 transcript。
3. 低分单词以下划线提示。
4. 停顿超过 2 秒的位置显示红色 `[Pause: X.Xs]`。
5. 用户点击单词，播放器跳转到对应时间。
6. 播放时当前词高亮。

## 技术设计

- Transcript 渲染使用 word token 列表。
- 停顿由当前词结束时间和下一个词开始时间计算。
- 当前播放时间通过播放器 `timeupdate` 驱动。
- 高频高亮避免写入 React 全局 state。
- 主工作台使用 `ref` 保存 DOM 节点映射，通过 `transcript-word-active` class 切换高亮。
- glass 主题下避免大面积 backdrop repaint。
- 停顿阈值固定为 `2000ms`，低分词阈值固定为 `< 60`。
- 词级 transcript、pause token、tooltip、点击跳转、当前词高亮和报告 selector 的 UI 规范见 [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md)，以当前代码实现为准。

## 数据结构

```ts
type TranscriptToken =
  | {
      type: "word";
      id: string;
      text: string;
      startMs: number;
      endMs: number;
      accuracyScore?: number;
      phonemeErrors?: string[];
    }
  | {
      type: "pause";
      id: string;
      durationMs: number;
      severe: boolean;
    };
```

## 任务拆分

- P-001：将 `SpeechAssessmentResult.words` 转换为 transcript tokens。已完成：`src/lib/transcript.ts`。
- P-002：实现停顿计算，超过 2 秒标记 `severe`。已完成。
- P-003：实现 transcript 渲染组件。已完成：主工作台和媒体页均渲染 word/pause token。
- P-004：实现低分词下划线样式。已完成。
- P-005：实现 hover 音素错误 tooltip。已完成：低分音素写入按钮 `title`。
- P-006：实现点击单词跳转播放器。已完成：主工作台和媒体页均支持。
- P-007：实现播放中当前词高亮。已完成：主工作台支持当前词 class 高亮。
- P-008：优化 glass 主题下高频高亮性能。已完成基础 class 切换；长 transcript 虚拟化后续再做。

## 当前实现进展

- 新增 `TranscriptToken` 类型和 `buildTranscriptTokens`、`findCurrentWordToken`、`getTranscriptText` 工具。
- 主工作台报告区优先展示词级 transcript；旧文本批改记录仍兼容句级 transcript。
- 低于 60 分的词显示红色下划线。
- 相邻词间隔超过 2 秒插入红色 `[Pause: X.Xs]`。
- 点击 word 跳转到 `startMs / 1000` 并播放。
- 播放时当前 word 添加 `transcript-word-active` class。
- 当前 mock 验收使用 Azure detailed JSON 映射后的词级结果，不依赖真实 Azure Key。

## 验收标准

- 逐词文本按顺序展示。
- 停顿超过 2 秒显示红色。
- 分数低于 60 的单词有下划线。
- hover 可看到音素错误信息。
- 点击单词后播放器跳转到正确时间。
- 播放中当前词高亮平滑。
- 综合批语面板优先展示词级 transcript；无词级 token 时回退到句级时间戳列表，展示规则与 UI 固化文档一致。

## 测试建议

- 单元测试：停顿 token 生成。已覆盖。
- 单元测试：当前时间查找当前词。已覆盖。
- 单元测试：低分词样式条件。已覆盖。
- 手动测试：快速拖动进度条、连续点击词、切换主题后播放。

## 当前验证记录

- `pnpm test` 已覆盖 transcript token 生成、Azure 词序排序、超过 2 秒停顿、低分词音素 tooltip、当前词查找、媒体页和主工作台评估后渲染。
- 真实长音频下的人工播放同步验收继续 deferred；后续拿到真实 Azure Speech Key 后，用 30 秒以上 WAV 补验 continuous pronunciation assessment、点击跳转和播放高亮。

## 风险与后续扩展

- 长 transcript 可能导致 DOM 节点较多，后续可做虚拟化。
- 如果 Azure 时间戳存在偏移，需要后续提供校准能力。
