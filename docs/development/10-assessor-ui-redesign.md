# 10 UI 固化：Assessor 工作台

## 文档目标

本文件固化 `ielts-speaking-test-copilot` 当前代码中的 UI 实现，用于后续开发保持界面、布局和交互一致。

UI 冲突处理规则固定为：当前代码实现优先，本文档记录实现快照。后续任何 UI 改动都必须同步更新本文件，并在相关开发文档中保留本文件作为 UI 索引。

当前 UI 事实源：

- `src/app/App.tsx`
- `src/components/workspace/`
- `src/app/workspaceTypes.ts`
- `src/app/workspaceUtils.ts`
- `src/styles/global.css`
- `src/features/settings/SettingsPage.tsx`
- `src/app/App.test.tsx`

## 产品界面定位

应用是一个 macOS 风格的本地 IELTS Speaking 工作台。首屏直接呈现可操作的批改工作区，不做介绍页或营销页。

核心界面气质：

- 桌面应用感。
- macOS 菜单栏、窗口和状态栏隐喻。
- 左侧历史记录与教师案例库入口。
- 中央双栏工作区：左侧输入/导入，右侧批改报告。
- 三套主题可即时预览和保存。
- 适合长期批改、复盘、训练的高密度工作界面。

## 顶层结构

根容器：

- 使用 `h-screen w-screen overflow-hidden` 占满视口。
- 根据配置设置 `theme-claude`、`theme-animal`、`theme-glass`。
- 工作台背景使用派生类：`assessor-theme-claude`、`assessor-theme-animal`、`assessor-theme-glass`。
- 字体和字号通过 `typography` 配置派生 class 控制。

页面结构：

- 顶部为 `mac-menu-bar`，高度 32px。
- 中央为居中的 `app-window`，宽度 `w-full max-w-6xl`，高度 `h-full max-h-[820px]`。
- `app-window` 内部包含：
  - 44px `window-titlebar`。
  - 主体区，左侧 `finder-sidebar` + 右侧 workspace。
  - 24px `window-statusbar`。

响应式行为：

- `finder-sidebar` 在 `lg` 以下隐藏。
- Workspace 在窄屏为单列，在 `min-[1180px]` 后变为 12 列网格。
- 左栏占 5 列，右栏占 7 列。
- 顶部菜单长文本截断，避免横向溢出。

## 顶部菜单栏

`mac-menu-bar` 左侧包含：

- Apple 图标按钮，打开应用菜单。
- `IELTS Assessor` 菜单标题。
- `文件` 菜单。
- `主题切换` 菜单。

`IELTS Assessor` 菜单项：

- `偏好设置...`，快捷提示 `⌘,`。
- `关于 IELTS Assessor`。

`文件` 菜单项：

- `新建批改会话 (重置)`。
- `导入音视频`，快捷提示 `drag & drop`。

`主题切换` 菜单项：

- `Claude 优雅主题`。
- `动物森友会主题`。
- `液态玻璃暗色主题`。
- 当前主题右侧显示 `●`。

`mac-menu-bar` 右侧包含：

- `local@ielts-copilot`，在较窄视口隐藏。
- Wi-Fi 图标。
- 电池图标。
- 设置图标按钮。
- 帮助图标按钮。
- 当前时间，使用 24 小时制，15 秒刷新一次。

菜单视觉：

- 字号 12px。
- 高度紧凑。
- 背景和 hover 状态随主题变化。
- `theme-glass` 使用深色半透明和 blur。
- `theme-animal` 使用暖色背景和更厚边框。

## 应用窗口

窗口标题栏：

- 高度 44px。
- 左侧为红黄绿窗口控制点。
- 中间标题为 `IELTS Speaking Examiner - 雅思口语提分大师`。
- 标题左侧显示 `GraduationCap` 图标。
- 右侧保留 `w-14` 空位平衡布局。

窗口控制点逻辑：

- 红点：清空当前会话。
- 黄点：打开设置。
- 绿点：打开帮助。

底部状态栏：

- 高度 24px。
- 左侧显示本地服务状态圆点和状态文案。
- 本地服务成功时显示 `大模型测评引擎已就绪`。
- 本地服务未连接时显示 `本地服务未连接` 或 `检查本地服务`。
- 右侧显示 `主题: {themeLabel}` 和 `记录: {records.length}`。

## 左侧历史栏

历史栏 class 为 `finder-sidebar`，仅桌面宽度显示。

顶部：

- 标题 `历史批改记录`。
- 左侧 `History` 图标。
- 右侧显示当前记录数量。

固定入口：

- `教师案例库`。
- 副标题 `SQLite CRUD 基础`。
- 图标为 `Database`。
- 点击后右侧 workspace 切换为 `CorpusPage`。

空状态：

- 显示 `HardDrive` 图标。
- 文案 `暂无历史口语作业`。
- 辅助文案 `录入文本批改后会保存记录`。

记录项：

- 媒体记录使用 `FileAudio` 图标。
- 文本记录使用 `FileText` 图标。
- 显示作业标题、日期和 `B x.x` 分数。
- active 状态使用 `history-row-active-*` 主题类。
- hover 后显示单条删除按钮 `Trash2`，不提供批量删除入口。

底部：

- 固定按钮 `新口语作业批改`。
- 图标为 `Plus`。
- 点击后重置当前工作台。

## Workspace 左栏

左栏标题为 `作业导入与文本批改`。

模式切换：

- 使用 segmented control 视觉。
- 可选项为 `音视频录传` 和 `手工手写文本`。
- 当前模式使用主题主按钮样式。

公共字段：

- `作业标题 (可选)`，placeholder 为 `例如: Part 2 科技对生活的影响`。
- `考试部分`，选项为 `Part 1`、`Part 2`、`Part 3`。
- `题目`。
- 默认考试部分为 `Part 2`。
- 默认题目为 `Describe a happy event in your childhood`。

左栏卡片：

- 使用当前主题的 card class。
- 最小高度 340px。
- 桌面宽度下填满左栏可用高度。

## 音视频录传模式

上传区：

- class 为 `workspace-file-dropzone`。
- 视觉为圆角、2px dashed border、居中图标和文案。
- 主文案：`拖拽音频或视频文件至此处`。
- 辅助文案：`支持 MP4, MP3, M4A, WAV；转码为 16kHz 16bit mono PCM`。
- 按钮：`手动浏览文件`。

拖拽状态：

- 上传卡片内覆盖半透明提示层。
- 显示 `Upload` 图标。
- 文案 `释放文件导入到工作区`。
- 边框使用 indigo 强调色。

已选文件状态：

- 使用绿色低透明背景。
- 视频文件显示 `FileVideo`，音频文件显示 `FileAudio`。
- 显示文件名、文件大小和 `格式可转码` 或 `格式不支持`。
- 右侧按钮 `清空`。
- 下方按钮 `更换文件`。

转码和评估状态：

- 转码成功后显示状态块 `转码完成`。
- 显示输出路径和格式：`WAV / 16000 Hz / 1 channel / pcm_s16le`。
- Azure 成功后显示 `Azure 语音评估完成`，并展示 Pronunciation 和 Accuracy。
- 普通 notice 使用低对比信息块。
- 错误使用红色错误块。

媒体模式主按钮：

- 默认文案 `开始 AI 作业批改`。
- 转码中显示 `转码中...`。
- 已有转码结果并等待 Azure 时显示 `Azure 发音评估中...`。
- 无文件、格式不支持、web preview、文件检查中时禁用并显示解释文案。
- Web preview 文案为 `网页预览只能读取文件信息；真实转码请使用 Tauri 桌面端。`。

## 手工手写文本模式

文本输入：

- label 为 `写入您的雅思答题脚本`。
- textarea placeholder 为 `复制粘贴或手写录入您的答题原稿内容...`。
- class 为 `workspace-textarea`。
- 最小高度 128px。
- 禁止 resize。
- 底部显示 `当前长度：{answerLength} 字符；至少 20 字符后可提交。`。

文本模式主按钮：

- 默认文案 `开始 DeepSeek 文本批改`。
- loading 文案 `考官 AI 精审分析中...`。
- 图标为 `Sparkles`。
- 提交条件：本地服务已连接、DeepSeek Key 已配置、文本至少 20 字符、当前不在 loading。
- 禁用说明分别为 `本地服务未连接。`、`请先配置 DeepSeek Key。`、`请输入至少 20 字符。`。

## Workspace 右栏

右栏标题：

- `口语批改工作区 - {displayedTitle}`。
- 无记录时 `displayedTitle` 为 `雅思口语作业批改`。

空状态：

- 标题 `等待上传雅思口语作业`。
- 描述文案说明左侧菜单会沉淀真实批改档案，媒体会完成 WAV 转码和 Azure 长音频发音评估，文本会展示四项评分、词汇修正和高分重构。
- 三张 guide card：
  - `1. 媒体转码`，`输出 16kHz 单声道 WAV。`
  - `2. Azure 发音评估`，`逐词评分与停顿。`
  - `3. 播放同步`，`点击词跳转音频。`

转码后但无报告时：

- 可显示 `转码 WAV 播放器`。
- 播放的是 FFmpeg 输出的标准 WAV 文件。
- 包含播放/暂停按钮、当前时间、range 进度条、总时长和隐藏 audio 元素。

## 报告区

评分摘要：

- 顶部 card 显示 Band 方块。
- 方块内显示 `Band` 和 `overallScore.toFixed(1)`。
- 标题 `雅思口语专家评分`。
- 副文案 `由 {config.deepseek.model} 大模型精细评估`。

结果选择器：

- 当前实现不是横向 tabs，而是右上角 `result-selector` 下拉选择器。
- trigger 显示当前选择项和 `ChevronDown`。
- 支持 hover 延迟打开和 click 切换。
- 下拉菜单 role 为 `listbox`，选项 role 为 `option`。
- active trigger 和 active option 使用主题类：
  - `result-tab-active-claude`
  - `result-tab-active-animal-crossing`
  - `result-tab-active-liquid-glass`
  - `result-selector-option-active-*`

选择项：

- `综合批语`
- `流利度 ({score})`
- `词汇 ({score})`
- `语法 ({score})`
- `发音 ({score})`
- `病句修正 ({count})`

## 综合批语面板

内容顺序：

1. `总评与复盘建议`
2. transcript 区域
3. `考官推荐高分示范回答`

Transcript 区域：

- 有词级 token 时标题为 `逐词 transcript 与播放同步 (点击单词跳转)`。
- 无词级 token 但有句级 transcript 时标题为 `逐字还原语料及句级时间戳跳转 (点击跳转音频)`。
- 句级 transcript 每行显示时间戳和文本，点击行跳转音频位置。

高分示范回答：

- 绿色低透明背景。
- 使用 serif、italic 风格。
- 内容外层加英文双引号。

## Transcript 词级交互

词级面板 class 使用圆角、边框和低透明背景，最大高度 220px，可滚动。

Word token：

- 渲染为 button。
- 点击后跳转到 `startMs / 1000` 并播放。
- tooltip 使用 `Accuracy: x.x` 和低分音素信息。
- hover 时使用低透明背景。

Pause token：

- 显示为 `[Pause: X.Xs]`。
- 使用红色低透明背景和红色文字。

低分词：

- 当 `accuracyScore < lowAccuracyThreshold` 时显示红色文字和红色下划线。
- 下划线使用 `decoration-2` 和 `underline-offset-4`。

播放高亮：

- 当前播放词通过 `transcript-word-active` class 高亮。
- 高亮切换由 DOM ref class 操作完成，避免高频播放时间写入全局 React state。

## 四项评分面板

四项评分复用 `CriterionPanel`。

面板顶部：

- 左侧为评分项名称：
  - `Fluency & Coherence (流利度与连贯性)`
  - `Lexical Resource (词汇丰富度)`
  - `Grammatical Range (语法多样性与准确性)`
  - `Pronunciation (发音)`
- 右侧 badge 显示 `分值: {score}`。

内容：

- `标准评语`
- 两列卡片：
  - `突出亮点`
  - `改进方向`

视觉：

- 亮点卡使用绿色低透明背景。
- 改进卡使用琥珀色低透明背景。
- 列表使用 `list-disc`。

## 病句修正面板

标题：

- `病句修正及高分重构`
- 计数 badge：`解析: {corrections.length} 处`

空状态：

- `AI Examiner 暂未挑出明显词法或语法问题。`

修正卡结构：

- 分类 badge。
- 原句块。
- 箭头。
- 高分重构句块。
- 提分原因。

分类 badge：

- `语法偏误`
- `词汇升级`
- `逻辑断流`
- `发音讹误`

原句和重构：

- 原句 label：`您的口语答复 Draft`。
- 重构 label：`考官级高级示范`。
- 桌面下原句和重构使用 12 列网格横向展示。
- 窄屏下单列展示，箭头旋转为纵向。

原因：

- 使用 `CornerDownRight` 图标。
- 前缀为 `名师答疑/提分点: `。

## 音频播放器

播放器出现位置：

- 转码后无报告的空状态 card 下方显示 `转码 WAV 播放器`。
- 有报告时显示 `口语练习音频播放器`。

播放器结构：

- 圆形播放/暂停按钮。
- 当前播放时间。
- range 进度条。
- 总时长。
- 隐藏 `audio` 元素。

交互：

- 点击 play 开始播放。
- 点击 pause 暂停。
- 拖动 range 更新 audio `currentTime`。
- `timeupdate` 更新当前时间并驱动 transcript 高亮。
- 播放结束后 `isPlaying` 置为 false。

## 设置弹窗

设置弹窗由 `SettingsPage` 实现。

外层：

- 页面遮罩为 `fixed inset-0`、`bg-black/60`、`backdrop-blur-sm`。
- 窗口 class 为 `settings-modal-window settings-modal-window-{referenceTheme}`。
- 宽度 `min(92vw, 980px)`。
- 高度 `min(80vh, 640px)`。
- 最小高度 560px。

窗口控制：

- 左上角红色关闭按钮，文案 title 为 `关闭`。

左侧 tab：

- `外观主题`
- `字体与字号`
- `AI 引擎模型`

底部版本文案：

- `v1.2.0 Mac OS Style`

外观主题页：

- 标题 `🎨 外观主题设置`。
- 主题卡：
  - `Claude (古典雅致)`，描述 `温润沙色，极简沙龙感觉`。
  - `动森 (自然田园)`，描述 `松绿色调，治愈感叶形`。
  - `液态玻璃 (赛博暗色)`，描述 `微光冷色，晶莹磨砂霓虹`。
- 切换后调用 preview，使主界面即时预览主题。

字体与字号页：

- 标题 `🔤 字体与字级设置`。
- 字体选项：
  - `system`
  - `serif`
  - `space`
  - `mono`
- 字号选项：
  - `small`
  - `medium`
  - `large`

AI 引擎模型页：

- 标题 `🤖 AI 口语批改引擎`。
- 包含 DeepSeek、智谱 Embedding、Azure Speech 配置。
- DeepSeek 模型主推：
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`
- 支持 DeepSeek `/models` 连接测试。
- 支持清除 DeepSeek、智谱和 Azure Key。
- Key 输入框不回显已保存密钥，只显示配置状态。

## 帮助弹窗

帮助弹窗由 `HelpModal` 实现。

外层：

- `fixed inset-0` 遮罩。
- 背景 `bg-black/60`。
- `backdrop-blur-sm`。

窗口：

- 使用当前主题的 card class。
- 最大宽度 `max-w-md`。
- 右上角 `X` 关闭按钮。

标题：

- `雅思口语提分大师批改小手册`
- 左侧 `BookOpen` 图标。

正文说明：

- 当前界面采用 macOS 工作台结构。
- 文件菜单可新建会话或导入音视频。
- 主题可在 Claude、动物森友会、液态玻璃之间即时预览。
- 当前链路包含 DeepSeek 文本批改、媒体转码、Azure Speech SDK 长音频发音评估。
- 真实 Azure Key 验证暂缓到人工验收阶段。

确认按钮：

- `理解了，开始练习`

## 主题规范

Claude 主题：

- 根 class：`theme-claude`。
- 工作台背景 class：`assessor-theme-claude`。
- 背景接近白色：`rgb(253 253 252)`。
- 主色为橙色。
- 窗口边框细、阴影克制。

动物森友会主题：

- 根 class：`theme-animal`。
- 工作台背景 class：`assessor-theme-animal`。
- 背景使用浅绿色点阵。
- app window 使用 4px 边框、24px 圆角、暖色纸面背景。
- 按钮有更厚底边和轻微拟物风格。

液态玻璃主题：

- 根 class：`theme-glass`。
- 工作台背景 class：`assessor-theme-glass`。
- 背景为深色，并带紫色和青色径向光。
- app window 使用半透明深色背景、blur、强阴影。
- 主按钮和新建按钮使用紫到青色渐变。

## 响应式验收

桌面宽度：

- 显示左侧历史栏。
- Workspace 左右双栏。
- 报告 selector 位于评分摘要右侧。
- 右栏报告内容可独立滚动。

窄屏：

- 隐藏左侧历史栏。
- Workspace 单列展示。
- 顶部菜单文字截断。
- 修正卡从横向改为纵向。
- 页面不得出现横向滚动。

## 验收清单

- 打开应用后直接看到工作台。
- 顶部菜单栏、窗口标题栏、底部状态栏完整。
- `IELTS Assessor`、`文件`、`主题切换` 菜单项与代码一致。
- 窗口红黄绿控制点分别执行清空、设置、帮助。
- 左侧历史栏包含 `教师案例库`、记录列表、空状态和 `新口语作业批改`。
- 媒体模式支持拖拽、手动浏览、清空、更换文件、转码状态、Azure 状态和错误状态。
- 文本模式显示字数限制，DeepSeek Key 缺失时按钮禁用并提示。
- 右侧空状态 guide card 为媒体转码、Azure 发音评估、播放同步。
- 报告区使用 result selector 下拉选择器，而不是横向 tabs。
- 综合批语、词级 transcript、四项评分、病句修正和播放器交互均按本文档展示。
- 设置弹窗包含外观主题、字体与字号、AI 引擎模型三个 tab。
- 帮助弹窗标题和确认按钮与代码一致。
- 三套主题下菜单、窗口、历史 active、按钮、selector active 有明确视觉差异。
- 桌面和窄屏均无横向滚动。
