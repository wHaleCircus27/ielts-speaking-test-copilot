# 雅思口语智能批改助手

个人专用的 macOS 本地雅思口语批改与训练工具。项目使用 Tauri 2、React 18、Vite、Tailwind CSS 和 Rust command 层，首版目标是完成文本批改、媒体转码、Azure 发音评估、播放同步与教师案例 RAG 的本地闭环。

## 当前进展

- MVP 1 基础工程、设置、主题和 DeepSeek 文本批改链路已进入收口阶段；DeepSeek 已接入 `deepseek-v4-flash` / `deepseek-v4-pro`，默认模型为 `deepseek-v4-flash`。
- 设置页已提供 DeepSeek `/models` 连通性测试，返回可用模型列表和当前模型可用状态，不回显或记录 API Key。
- MVP 2 已完成媒体导入与 FFmpeg/afconvert 转码基础链路。
- MVP 3 已代码收口：按微软文档接入 Azure Speech SDK continuous mode 长音频发音评估、逐词 transcript、停顿标注、低分词、点击跳转和播放高亮。
- MVP 3 当前验收依据为微软文档结构一致性和 mock 自动化验证；真实 Azure API Key、region、token 与 30 秒以上长音频验证已暂缓到后续人工验收。
- MVP 4 已接入教师案例库、智谱 `embedding-3` 向量重建、本地 SQLite JSON 向量存储、Top-K 检索和 RAG Prompt 注入准备层；真实智谱 Key 验证待提供 Key 后补充。

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
4. 系统 `ffmpeg`。
5. macOS 开发环境中，如 FFmpeg 缺失，则使用系统 `afconvert` 作为后备转码器。

首版不提交真实 FFmpeg 二进制到仓库。

## 测试资源

`test-resource/` 是本项目约定的本地测试资源目录，用于放置人工验收或本地调试用的音频、视频、压缩包等样本文件。

- 该目录不属于产品运行数据。
- 该目录不属于发布资产。
- 该目录已加入 `.gitignore`，不应提交到仓库。
- 如需共享测试样本，应在文档中说明来源、用途和文件格式，不直接提交大体积或版权不明的媒体文件。

## 安全约束

- API Key 不写入前端源码。
- 前端只显示密钥是否已配置，不回显完整密钥。
- DeepSeek 连通性测试和智谱 Embedding 验证只读取本地已保存配置或 `test-resource/` 中的本地测试 Key，不将 Key 写入仓库、日志或测试输出。
- 本地路径、转码日志和 API 错误信息不得泄露密钥。
- 不执行批量删除文件或目录操作。
