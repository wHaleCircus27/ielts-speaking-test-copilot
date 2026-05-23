
---

# 雅思口语智能批改助手 (MacOS 个人版) - 产品需求文档 (PRD)

## 1. 文档概述
*   **产品定位**：个人专用的 macOS 本地雅思口语批改与个性化训练工具。
*   **运行环境**：macOS (Apple Silicon M4 芯片独占优化)。
*   **核心调整**：
    *   放弃公开发行与 Mac App Store 上架约束，允许本地打包 FFmpeg 静态二进制文件。
    *   针对 M4 芯片的强劲性能，优化本地媒体转码与 UI 渲染效率。
    *   深度适配 **DeepSeek API**（如 `deepseek-chat` 或 `deepseek-reasoner`），设计高鲁棒性的 Prompt 机制。

---

## 2. 架构设计与技术栈
*   **前端**：React 18 + Vite + Tailwind CSS
*   **跨平台框架**：Tauri 2.0 (Rust) - 相比 Electron 拥有更低内存占用，并原生支持 macOS M4 硬件加速。
*   **音视频处理**：本地嵌入 `ffmpeg` (ARM64 架构静态编译版) 作为 Tauri Sidecar。
*   **本地向量库**：`sqlite-vec`（通过 Rust 本地调用，存储教师历史批改数据）。
*   **LLM 引擎**：以 DeepSeek API 为主，兼容本地 Ollama 部署。

---

## 3. 界面与主题系统 (UI/UX)
应用需在设置中提供三套主题一键切换，采用 **Tailwind CSS Variables** 动态注入，保证组件不因样式改变而产生功能冲突。

```
├── [全局样式文件] (定义三套 Theme Token: 颜色、圆角、边框、字体)
│   ├── Theme: Claude (暖卡其、有衬线体、学院风)
│   ├── Theme: Animal Crossing (大圆角、粗边框、马卡龙绿/黄、活泼字体)
│   └── Theme: Liquid Glass (Tauri Vibrancy 窗口透明、高斯模糊、流光溢彩渐变)
```

### 3.1 三套主题细节设计

| 主题标识 | 风格定位 | 核心 Tailwind 变量与样式定义 |
| :--- | :--- | :--- |
| `theme-claude` | 纸质学术风 | 背景：`#FBF0E7`，主文字：`#191919` (系统默认衬线体)，按钮无圆角或极小圆角，强调边框线感。 |
| `theme-animal` | 动森海岛风 | 背景：`#F6F2E5`，主色：`#79BD8F`，卡片带 `border-4 border-[#5E4B3C]` 粗边框，圆角 `rounded-2xl`，使用卡通非对称阴影。 |
| `theme-glass` | 液态玻璃风 | 启用 Tauri 窗口 `vibrancy` 效果。背景：`bg-white/10 backdrop-blur-md`，卡片带细微白色半透明边框（`border-white/20`），配合多重彩色阴影（Box-shadow）模拟玻璃折射。 |

---

## 4. 功能需求明细 (Features)

### 4.1 媒体处理模块 (Media Processing)
由于应用仅在 M4 设备上私有运行，无需考虑兼容性，采用本地强制转码策略：
*   **静默转码流程**：
    1.  用户拖入任意 MP4 / MP3 / M4A / WAV。
    2.  Rust 后端启动内置的 `ffmpeg` 进程，将媒体文件转换为标准格式：**`WAV (16kHz, 16bit, Mono, PCM)`**。
    3.  转码完成后，输出路径送往语音解析 API，同时在 UI 显示波形图。
*   **音频切片与播放同步**：
    *   前端解析 API 返回的逐字时间戳（Word-level timestamps），点击 UI 中的任意单词，音频播放器跳转至对应秒（`currentTime`）并高亮显示当前发音单词。

### 4.2 语音评估模块 (Speech Evaluation)
*   **服务对接**：集成 **Azure Speech SDK**（发音评估模式）或 **SpeechSuper API**。
*   **数据解析与呈现**：
    *   **发音准确度/流利度/韵律自然度（Prosody）**：提取 API 返回的 `PronunciationAssessmentResult`，其中 Prosody 按 Azure 官方解释覆盖重音、语调、语速、节奏和自然度。
    *   **词汇/语法/话题内容**：基于 DeepSeek 对 transcript、题目和教师案例库做 IELTS 文本维度判断，输出词汇、语法、话题内容和综合批语；不声明为 Azure Speech SDK 直接返回字段。
    *   **停顿高亮**：在文本中自动插入 `[Pause: X.Xs]`，若停顿超过 2 秒，标记为红色。
    *   **发音纠错**：对发音得分低于 60（百分制）的单词标记下划线，鼠标悬浮显示音素级别的错误分析（如：元音发音不饱满）。

### 4.3 教师个性化 RAG 模块 (Personalized RAG)
为实现“模仿个人批改习惯”，在本地构建检索链路：
*   **数据灌入**：
    *   提供本地“语料录入”页面。教师导入：**「学生口语文本」+「个人修改意见」+「打分维度偏好」**。
    *   调用 DeepSeek 的 Embedding API 将上述文本转化为向量，存入本地 `sqlite-vec` 数据库。
*   **动态检索与组装**：
    *   开始批改新作业时，计算当前作业文本的 Embedding。
    *   检索本地数据库，找出**最相似的 2-3 个历史批改案例**。
    *   将这些案例格式化为 XML 标签（如 `<example>`），作为 Few-Shot（少样本提示词）注入到 DeepSeek 的 System Prompt 中。

### 4.4 DeepSeek 批改生成模块 (DeepSeek Grading)
*   **API 配置**：支持填入自定义 DeepSeek API Key 及 Base URL（可走第三方中转或官方 API）。
*   **模型选择**：
    *   `deepseek-chat` (deepseek-v4-flash)：适合快速生成常规的纠错与段落重构。
    *   `deepseek-reasoner` (deepseek-v4-pro)：适合深度逻辑分析、雅思考官思维模拟（推理链输出）。
*   **Prompt 鲁棒性与格式化约束**：
    *   强制模型返回 JSON 格式（使用 DeepSeek 的 `response_format: { type: "json_object" }` 参数）。
    *   **JSON Schema 结构约定**：
        ```json
        {
          "overall_band": 6.5,
          "sub_scores": { "FC": 6.5, "LR": 6.0, "GRA": 7.0, "PR": 6.5 },
          "personal_style_comment": "教师语气风格的综合评语...",
          "vocabulary_corrections": [
            { "original": "bad", "suggested": "detrimental", "reason": "词汇级别过低" }
          ],
          "reconstructed_essay": "重构后的高分示范..."
        }
        ```

---

## 5. 实现难点与应对方案 (Implementation Challenges)

### 难点 1：Tauri 2.0 中 FFmpeg 的静态打包与调用
*   **问题**：由于是 macOS M4 (ARM64) 独占，Intel 二进制无法直接高效运行，且本地容易遇到权限拦截。
*   **方案**：
    1.  从官方源下载针对 `aarch64-apple-darwin` 的静态 FFmpeg 编译版本。
    2.  将其放入 Tauri 项目的 `src-tauri/binaries` 目录中，并在 `tauri.conf.json` 中配置为 `sidecar`。
    3.  通过 Rust 的 `tauri_plugin_shell::ShellExt` 启动 ffmpeg，参数硬编码为 `-i {input} -ar 16000 -ac 1 -c:a pcm_s16le {output}.wav`。

### 难点 2：毛玻璃主题与 React 组件重渲染性能
*   **问题**：当切换到“液态玻璃”主题时，Tauri 会开启 `vibrancy` 效果。此时若频繁拖动进度条高亮单词，会导致大量的 DOM 重绘，产生卡顿。
*   **方案**：
    1.  单词高亮功能避免使用会导致 React 全局重新 Render 的 State，改用 `useRef` 直接操作 DOM Class 或使用 CSS 自定义属性（CSS Custom Properties）进行硬件加速渲染。
    2.  在切换至 `theme-glass` 主题时，降低不必要的高斯模糊半径（如 `backdrop-blur` 限制在 `12px` 以内）。

### 难点 3：DeepSeek 结构化输出异常处理
*   **问题**：即使开启了 JSON Mode，DeepSeek 偶尔在输出超长文本或复杂推理时仍可能混入 Markdown 标记（如 ` ```json ` ），导致前端 `JSON.parse` 报错。
*   **方案**：
    *   前端在接收到 API 响应后，编写正则清洗函数，剥离可能包裹在 JSON 外侧的 Markdown 标记。
    *   在 System Prompt 中加入极端约束：“DO NOT wrap the response in markdown blocks. Output raw JSON only.”

### 难点 4：RAG 上下文越界（Token 溢出）
*   **问题**：若教师上传的历史修改案例极长，且新作业文本本身也偏长，检索出的多个 Example 会导致 Context 迅速膨胀，增加 DeepSeek 响应延迟。
*   **方案**：
    *   在存入本地向量库前，对历史批改记录进行结构化清洗，仅提取核心的“原始文本”、“修改后文本”和“教师评语”，剔除冗余修饰，确保单个 Example 控制在 500 Token 以内。
