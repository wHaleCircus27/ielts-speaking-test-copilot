# 03 设置与本地配置

## 目标

实现应用配置读写，支持 DeepSeek、Azure、主题等设置，并确保密钥不进入前端源码和普通日志。

## 不做什么

- 不做云端配置同步。
- 不做多账号配置。
- 不做完整密钥轮换系统。

## 用户流程

1. 用户进入设置页。
2. 填写 DeepSeek API Key、Base URL、模型。
3. 填写 Azure key、region、language。
4. 选择主题。
5. 保存配置。
6. 重启应用后配置仍然可用。

## 技术设计

- 配置读写由 Rust command 完成。
- 前端显示密钥是否已配置，不回显完整密钥。
- 密钥优先写入系统安全存储；如果首版暂未接入 keychain，则写入本地配置文件并限制日志输出。
- `AppConfig` 分为前端可见配置和后端私密配置。
- 所有 API 调用从 Rust 后端读取真实密钥。

## 数据结构

```ts
type PublicAppConfig = {
  theme: "theme-claude" | "theme-animal" | "theme-glass";
  deepseek: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: "deepseek-chat" | "deepseek-reasoner";
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
  azure: {
    key?: string;
    region: string;
    language: string;
  };
};
```

## Tauri commands

- `get_app_config() -> PublicAppConfig`
- `save_app_config(input: SaveAppConfigInput) -> PublicAppConfig`
- `clear_deepseek_key() -> PublicAppConfig`
- `clear_azure_key() -> PublicAppConfig`

## 任务拆分

- C-001：设计配置文件路径和 Rust 配置结构。
- C-002：实现 `get_app_config`。
- C-003：实现 `save_app_config`。
- C-004：实现设置页表单。
- C-005：实现密钥已配置状态和清除按钮。
- C-006：实现保存成功、失败和校验提示。
- C-007：统一日志脱敏。

## 验收标准

- 配置保存后重启仍可读取。
- 前端不显示完整 API Key。
- 清除密钥后相关功能提示需要重新配置。
- 无 DeepSeek Key 时不能发起批改，并显示明确错误。
- 无 Azure Key 时不能发起语音评估，并显示明确错误。

## 测试建议

- 单元测试：配置序列化、反序列化、默认值。
- 集成测试：保存后读取一致。
- 手动测试：密钥保存、清除、重启恢复。

## 风险与后续扩展

- 本地配置文件需避免误提交；后续可引入 macOS Keychain。
- 第三方中转 Base URL 可能有不同接口兼容性，DeepSeek 调用层要保留错误诊断信息。

