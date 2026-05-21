# 02 应用壳与主题系统

## 目标

实现稳定的桌面应用壳、导航布局和三套主题，使后续功能页面共享一致的视觉和交互基础。

## 不做什么

- 不做营销落地页。
- 不做复杂动效系统。
- 不在本阶段实现完整 glass vibrancy 原生效果，只预留配置和样式边界。

## 用户流程

1. 用户打开应用进入批改页。
2. 用户通过侧边导航切换批改、媒体、语料、设置。
3. 用户在设置页切换主题。
4. 应用立即应用主题，并在重启后恢复。

## 技术设计

- 使用 CSS variables 定义主题 token。
- 根节点设置主题 class：`theme-claude`、`theme-animal`、`theme-glass`。
- Tailwind 使用 token 映射颜色、边框、圆角和阴影。
- 主题值由配置模块持久化。
- glass 主题将模糊半径控制在 12px 内，避免重绘成本过高。

## 数据结构

```ts
type ThemeId = "theme-claude" | "theme-animal" | "theme-glass";

type ThemeOption = {
  id: ThemeId;
  label: string;
  description: string;
};
```

## 任务拆分

- T-001：实现应用主布局：侧边导航、顶部状态区、内容区域。
- T-002：定义三套主题 CSS variables。
- T-003：配置 Tailwind token 映射。
- T-004：实现主题切换控件。
- T-005：将主题写入 `AppConfig`。
- T-006：实现基础组件样式：Button、Input、Card、Tabs、Tooltip。
- T-007：检查三套主题下文本可读性和布局稳定性。

## 验收标准

- 三套主题可切换。
- 切换主题不导致页面布局错位。
- 主要按钮、输入框、卡片在三套主题中都清晰可读。
- `theme-glass` 不使用过高模糊半径。

## 测试建议

- 单元测试：主题状态读取和写入。
- 视觉检查：桌面窗口和窄宽度窗口。
- 手动测试：快速切换主题 20 次无明显异常。

## 风险与后续扩展

- glass 主题与 Tauri vibrancy 需要后续在真实 macOS 设备上验证性能。
- 动森风格容易影响信息密度，功能页应保持可扫描性，不使用过多装饰。

