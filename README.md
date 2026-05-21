# 雅思口语智能批改助手

个人专用的 macOS 本地雅思口语批改与训练工具。项目使用 Tauri 2、React 18、Vite、Tailwind CSS 和 Rust command 层，首版目标是完成文本批改、媒体转码、Azure 发音评估、播放同步与教师案例 RAG 的本地闭环。

## 当前进展

- MVP 1 基础工程、设置、主题和 DeepSeek 文本批改链路已进入收口阶段。
- MVP 2 已启动媒体导入与 FFmpeg 转码能力。
- Azure Pronunciation Assessment、逐词 transcript 同步和教师 RAG 仍在后续 MVP 范围内。

详细计划见：

- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
- [PRD-ielts-speaking-test-copilot.md](PRD-ielts-speaking-test-copilot.md)
- [docs/development/README.md](docs/development/README.md)

## 本地开发

当前 shell 环境可能没有全局 `npm`，可直接使用项目本地依赖和 Codex 内置 Node 运行命令。

常用命令：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
cd src-tauri && cargo test
```

前端开发服务：

```bash
node node_modules/vite/bin/vite.js --host 127.0.0.1
```

Tauri 开发模式：

```bash
npm run tauri dev
```

## 媒体转码

媒体模块会将 MP4、MP3、M4A、WAV 转码为 `WAV 16kHz 16bit mono PCM`。

FFmpeg 查找顺序：

1. `FFMPEG_PATH` 环境变量。
2. `src-tauri/binaries/ffmpeg`。
3. `src-tauri/binaries/ffmpeg-aarch64-apple-darwin`。
4. 系统 `ffmpeg`。

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
- 本地路径、转码日志和 API 错误信息不得泄露密钥。
- 不执行批量删除文件或目录操作。
