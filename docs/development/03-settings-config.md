# 03 设置与本地配置

## 目标

实现应用配置读写，支持 DeepSeek、智谱 Embedding、Azure、主题等设置，并确保密钥不进入前端源码和普通日志。

## 不做什么

- 不做云端配置同步。
- 不做多账号配置。
- 不做完整密钥轮换系统。

## 用户流程

1. 用户进入设置页。
2. 填写 DeepSeek API Key、Base URL、模型。
3. 填写智谱 API Key、Base URL、Embedding 模型和向量维度。
4. 填写 Azure Speech key、region、language。
5. 选择主题。
6. 保存配置。
7. 可点击 DeepSeek 连接测试，应用使用已保存配置请求 `/models` 并展示可用模型。
8. 重启应用后配置仍然可用。

## 技术设计

- 配置读写由 Rust command 完成。
- 前端显示密钥是否已配置，不回显完整密钥。
- 密钥优先写入系统安全存储；如果首版暂未接入 keychain，则写入本地配置文件并限制日志输出。
- `AppConfig` 分为前端可见配置和后端私密配置。
- 所有 API 调用从 Rust 后端读取真实密钥。
- DeepSeek 默认模型为 `deepseek-v4-flash`，设置页主推 `deepseek-v4-flash` 与 `deepseek-v4-pro`。
- 已保存的旧模型值 `deepseek-chat`、`deepseek-reasoner` 继续可被反序列化，避免旧本地配置读取失败。
- `validate_deepseek_config` 会执行真实 `/models` 连通性探测，返回 `serviceReachable` 和 `availableModels`。
- 智谱默认 Base URL 为 `https://open.bigmodel.cn/api/paas/v4`，Embedding 模型为 `embedding-3`，固定维度为 `2048`。
- 智谱维度限制为 `2048`，Key 仅保存在本地配置并由 Rust command 层读取。
- 读取旧本地配置时会将历史维度归一为 `2048`；SQLite `teacher_case_embeddings.dimensions` 保留历史维度记录，检索只使用 provider、model 和当前 `2048` 维度匹配的向量，旧 `1024` 向量需重建后参与检索。
- Azure Speech 配置只用于短期 Speech token 签发和真实音频评估；Vocabulary、Grammar、Topic 统一由 DeepSeek 基于 transcript、题目和 RAG 案例判断。
- 设置弹窗 UI 以 [10-assessor-ui-redesign.md](10-assessor-ui-redesign.md) 为准；当前实现包含 `外观主题`、`字体与字号`、`AI 引擎模型` 三个 tab，并在 AI tab 管理 DeepSeek、智谱和 Azure 配置。

## 数据结构

```ts
type PublicAppConfig = {
  theme: "theme-claude" | "theme-animal" | "theme-glass";
  deepseek: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model:
      | "deepseek-v4-flash"
      | "deepseek-v4-pro"
      | "deepseek-chat"
      | "deepseek-reasoner";
  };
  zhipu: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: string;
    dimensions: 2048;
  };
  azure: {
    keyConfigured: boolean;
    region: string;
    language: string;
  };
};

type SaveAppConfigInput = {
  theme: PublicAppConfig["theme"];
  deepseek: {
    apiKey?: string;
    baseUrl: string;
    model: PublicAppConfig["deepseek"]["model"];
  };
  zhipu: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    dimensions: PublicAppConfig["zhipu"]["dimensions"];
  };
  azure: {
    key?: string;
    region: string;
    language: string;
  };
};

type ConfigValidationResult = {
  ok: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  serviceReachable: boolean;
  availableModels: string[];
  message: string;
};
```

## Tauri commands

- `get_app_config() -> PublicAppConfig`
- `save_app_config(input: SaveAppConfigInput) -> PublicAppConfig`
- `clear_deepseek_key() -> PublicAppConfig`
- `clear_zhipu_key() -> PublicAppConfig`
- `clear_azure_key() -> PublicAppConfig`
- `validate_deepseek_config() -> ConfigValidationResult`

## 任务拆分

- C-001：设计配置文件路径和 Rust 配置结构。
- C-002：实现 `get_app_config`。
- C-003：实现 `save_app_config`。
- C-004：实现设置页表单。
- C-005：实现密钥已配置状态和清除按钮。
- C-006：实现保存成功、失败和校验提示。
- C-007：统一日志脱敏。
- C-008：实现 DeepSeek `/models` 连通性测试和可用模型列表展示。
- C-009：实现智谱 Embedding 配置保存、清除和旧配置默认值兼容。

## 验收标准

- 配置保存后重启仍可读取。
- 前端不显示完整 API Key。
- 清除密钥后相关功能提示需要重新配置。
- DeepSeek 连接测试不输出或记录 API Key。
- DeepSeek 连接测试成功时展示 `deepseek-v4-flash`、`deepseek-v4-pro` 等服务返回模型。
- 设置弹窗不回显已保存 Key，只显示配置状态；视觉和交互与 UI 固化文档一致。
- 无 DeepSeek Key 时不能发起批改，并显示明确错误。
- 无智谱 Key 时教师案例向量重建和 RAG 检索给出明确错误，普通批改不受影响。
- 无 Azure Key 时不能发起语音评估，并显示明确错误。
- 无 DeepSeek Key 时媒体链路仍可完成 Azure Speech 发音报告，并提示文本维度暂不可用。

## 测试建议

- 单元测试：配置序列化、反序列化、默认值。
- 单元测试：缺少 `zhipu` 的旧配置可自动补默认配置。
- 集成测试：保存后读取一致。
- 手动测试：密钥保存、清除、重启恢复、DeepSeek 连接测试成功和失败路径、智谱 Key 配置后 Embedding 重建。

## 当前验证记录

- `pnpm typecheck` 通过。
- `pnpm test` 通过：7 个测试文件，27 个测试。
- `cd src-tauri && cargo test` 通过：31 个 Rust 测试。
- `pnpm build` 通过。
- 使用 `test-resource/deepseekApiKey.txt` 本地测试 Key 验证 `/models` 返回 `deepseek-v4-flash`、`deepseek-v4-pro`，并验证 `deepseek-v4-flash` `/chat/completions` 返回 JSON。测试输出未包含 API Key。

## 风险与后续扩展

- 本地配置文件需避免误提交；后续可引入 macOS Keychain。
- 第三方中转 Base URL 可能有不同接口兼容性，DeepSeek 调用层要保留错误诊断信息。
