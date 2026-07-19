# 雅思口语智能批改助手

个人专用的 macOS 本地雅思口语批改与训练工具。项目使用 Tauri 2、React 18、Vite、Tailwind CSS 和 Rust command 层，首版目标是完成文本批改、媒体转码、Azure 发音评估、播放同步与教师案例 RAG 的本地闭环。

## 当前进展

- MVP 1 基础工程、设置、主题和 DeepSeek 文本批改链路已完成并通过自动化验证；DeepSeek 已接入 `deepseek-v4-flash` / `deepseek-v4-pro`，默认模型为 `deepseek-v4-flash`。
- 设置页已提供 DeepSeek `/models` 连通性测试，返回可用模型列表和当前模型可用状态，不回显或记录 API Key。
- MVP 2 已完成媒体导入与 macOS 系统媒体工具转码链路；发布路径只执行固定的 `/usr/bin/afconvert` 和 `/usr/bin/afinfo`。
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
pnpm verify
pnpm security:pnpm
pnpm acceptance:safety-test
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

媒体模块使用 `/usr/bin/afconvert` 将 MP4、MP3、M4A、WAV 转为 `WAV 16kHz 16bit mono PCM`，并使用 `/usr/bin/afinfo -x -r` 校验输入与输出。发布构建不读取 `FFMPEG_PATH`、当前工作目录或 `PATH` 中的同名工具。

生成文件先写入 partial，校验并同步成功后才发布到 `$APPDATA/generated-media/<uuid>.wav`。应用只向前端开放该目录的 WAV；单个输出、总目录容量、转码时长和媒体时长均有固定上限。容量只通过逐条删除历史记录释放，不会静默淘汰历史拥有的媒体。

## 测试资源

`test-resource/` 是本项目约定的本地测试资源目录，用于放置人工验收或本地调试用的音频、视频、压缩包等样本文件。

- 该目录不属于产品运行数据。
- 该目录不属于发布资产。
- 该目录已加入 `.gitignore`，不应提交到仓库。
- 如需共享测试样本，应在文档中说明来源、用途和文件格式，不直接提交大体积或版权不明的媒体文件。

## 真实服务验收

DeepSeek、Azure 和智谱的真实服务检查不属于 `pnpm verify`，也不会在 CI 中读取凭据。先运行 `pnpm acceptance:dry-run` 验证脚本安全边界，再按照 [真实服务验收说明](docs/release/REAL_SERVICE_ACCEPTANCE.md) 在目标 macOS 账户执行。

验收脚本优先使用显式环境变量，其次只读与当前官方 endpoint/region 绑定的 macOS Keychain payload，最后读取已忽略目录中的本地凭据；路径和 endpoint override 不作为命令行参数，避免被 shell 或 `pnpm` 回显。输出及本地 evidence 只包含白名单状态、耗时、输入类型和计数，不包含 Key、Token、原文、Transcript、向量、响应 body 或本地路径。

## 安全约束

- API Key 不写入前端源码或普通配置文件；桌面端使用 macOS Keychain generic password。
- 前端只显示密钥是否已配置，不回显完整密钥。
- schema v2 配置中的兼容 Key 字段只能为 `null`；旧明文迁移在 Keychain 写入和回读验证成功后才原子替换配置。
- 三项云服务默认关闭，启用前必须接受当前云服务数据流说明；后端对每个请求再次执行 enabled、disclosure 和凭据绑定检查。
- 公开错误只保留稳定 code、message、可选 status 和受限 request ID，不包含上游 body、URL、输入原文或底层错误详情。
- 媒体与历史只支持逐条删除；自动清理仅处理 partial 和未被历史引用的受控 WAV。
