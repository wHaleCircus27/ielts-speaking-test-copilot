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
- 当前播放时间通过 `requestAnimationFrame` 或节流后的 `timeupdate` 驱动。
- 高频高亮避免写入 React 全局 state。
- 使用 `ref` 保存 DOM 节点映射，通过 class 切换高亮。
- glass 主题下避免大面积 backdrop repaint。

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

- P-001：将 `SpeechAssessmentResult.words` 转换为 transcript tokens。
- P-002：实现停顿计算，超过 2 秒标记 `severe`。
- P-003：实现 transcript 渲染组件。
- P-004：实现低分词下划线样式。
- P-005：实现 hover 音素错误 tooltip。
- P-006：实现点击单词跳转播放器。
- P-007：实现播放中当前词高亮。
- P-008：优化 glass 主题下高频高亮性能。

## 验收标准

- 逐词文本按顺序展示。
- 停顿超过 2 秒显示红色。
- 分数低于 60 的单词有下划线。
- hover 可看到音素错误信息。
- 点击单词后播放器跳转到正确时间。
- 播放中当前词高亮平滑。

## 测试建议

- 单元测试：停顿 token 生成。
- 单元测试：当前时间查找当前词。
- 单元测试：低分词样式条件。
- 手动测试：快速拖动进度条、连续点击词、切换主题后播放。

## 风险与后续扩展

- 长 transcript 可能导致 DOM 节点较多，后续可做虚拟化。
- 如果 Azure 时间戳存在偏移，需要后续提供校准能力。

