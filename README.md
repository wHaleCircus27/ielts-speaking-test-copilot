# 雅思口语智能批改助手

个人专用的 macOS 本地雅思口语批改与训练工具。项目使用 Tauri 2、React 18、Vite、Tailwind CSS 和 Rust command 层，首版目标是完成文本批改、媒体转码、Azure 发音评估、播放同步与教师案例 RAG 的本地闭环。

## 当前进展

- MVP 1 基础工程、设置、主题和 DeepSeek 文本批改链路已完成并通过自动化验证；DeepSeek 已接入 `deepseek-v4-flash` / `deepseek-v4-pro`，默认模型为 `deepseek-v4-flash`。
- 设置页已提供 DeepSeek `/models` 连通性测试，返回可用模型列表和当前模型可用状态，不回显或记录 API Key。
- MVP 2 已完成媒体导入与 FFmpeg/afconvert 转码基础链路。
- MVP 3 已代码收口：按微软文档接入 Azure Speech SDK continuous mode 长音频发音评估、逐词 transcript、停顿标注、低分词、点击跳转和播放高亮。
- MVP 3 当前验收依据为微软文档结构一致性和 mock 自动化验证；真实 Azure API Key、region、token 与 30 秒以上长音频验证已并入 RH-405，作为 RC 阻断门槛。
- MVP 4 已接入教师案例库、智谱 `embedding-3` 1024 维向量重建、本地 SQLite f32 BLOB 向量存储、配置化阈值、query cache、诊断搜索预览和 RAG Prompt 注入准备层；真实智谱 1024 维基准可用本地 benchmark 脚本补充。
- MVP 5 稳定化附加改进 R-501~R-508 已完成：工作台拆分、自定义 hooks、Rust 模块拆分、并行 Rust 测试、Vite chunk 拆分和 lazy 页面加载均已落地。
- 第 12 章教师案例库 RAG 改进 Phase 1~4 已完成；当前进入 [发布加固与可交付闭环迭代](docs/development/13-release-hardening.md)，发布结论为 No-Go，待真实桌面、安全、媒体可靠性、CI、安装包和真实服务验收闭环后进入 RC。

详细计划见：

- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
- [PRD-ielts-speaking-test-copilot.md](PRD-ielts-speaking-test-copilot.md)
- [docs/development/README.md](docs/development/README.md)

## 本地开发

本项目统一使用 `pnpm` 管理前端依赖和脚本。

常用命令：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm mvp4:verify
pnpm zhipu:embedding-benchmark
cd src-tauri && cargo test
```

前端开发服务：

```bash
pnpm dev --host 127.0.0.1
```

Tauri 开发模式：

```bash
pnpm tauri dev
```

## 媒体转码

媒体模块会将 MP4、MP3、M4A、WAV 转码为 `WAV 16kHz 16bit mono PCM`。

FFmpeg 查找顺序：

1. `FFMPEG_PATH` 环境变量。
2. `src-tauri/binaries/ffmpeg`。
3. `src-tauri/binaries/ffmpeg-aarch64-apple-darwin`。
4. `./binaries/ffmpeg`。
5. `./binaries/ffmpeg-aarch64-apple-darwin`。
6. 系统 `ffmpeg`。
7. macOS 开发环境中，如 FFmpeg 缺失，则使用系统 `afconvert` 作为后备转码器。

首版不提交真实 FFmpeg 二进制到仓库。

## 测试资源

`test-resource/` 是本项目约定的本地测试资源目录，用于放置人工验收或本地调试用的音频、视频、压缩包等样本文件。

- 该目录不属于产品运行数据。
- 该目录不属于发布资产。
- 该目录已加入 `.gitignore`，不应提交到仓库。
- 如需共享测试样本，应在文档中说明来源、用途和文件格式，不直接提交大体积或版权不明的媒体文件。

## Azure 真实 Key 本地预检

拿到 Azure Speech Key 后，可以先执行本地预检，验证 region 可签发短期 Speech token，并确认长音频 WAV 样本符合 Azure 评估输入格式。

推荐把 Key 放在本地忽略目录：

```bash
printf '%s' '<Azure Speech Key>' > test-resource/azureSpeechKey.txt
pnpm azure:speech-preflight -- --region eastasia --language en-US
```

如果本地文件包含多条带标签 Key，也可以显式指定文件；脚本会选取第一条可用 Key，且不会打印 Key：

```bash
pnpm azure:speech-preflight -- --key-file test-resource/azureApikey.txt --region eastasia --language en-US
```

也可以使用环境变量，避免创建文件：

```bash
AZURE_SPEECH_KEY='<Azure Speech Key>' pnpm azure:speech-preflight -- --region eastasia --language en-US
```

预检默认检查：

- `test-resource/speakTest-afconvert-16k-mono.wav`
- `test-resource/speakTest-nvidia-asr.wav`

这两个样本应为 `16kHz / mono / 16-bit PCM`，且时长超过 30 秒。预检输出只包含 region、language、HTTP 状态、token 是否非空和音频格式摘要，不打印 Azure Key 或短期 token。

## 安全约束

- API Key 不写入前端源码。
- 前端只显示密钥是否已配置，不回显完整密钥。
- DeepSeek 连通性测试和智谱 Embedding 验证只读取本地已保存配置或 `test-resource/` 中的本地测试 Key，不将 Key 写入仓库、日志或测试输出。
- Azure Speech 真实 Key 验证只读取本地 `test-resource/azureSpeechKey.txt`、显式 `--key-file` 或 `AZURE_SPEECH_KEY` 环境变量，不将 Key 或短期 token 写入仓库、日志或测试输出。
- 本地路径、转码日志和 API 错误信息不得泄露密钥。
- 不执行批量删除文件或目录操作。
