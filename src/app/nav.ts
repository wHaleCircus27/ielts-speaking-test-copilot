export type AppPage = "grading" | "media" | "corpus" | "settings";

export const navItems: Array<{
  id: AppPage;
  label: string;
  description: string;
}> = [
  {
    id: "grading",
    label: "批改",
    description: "文本评分与修改建议",
  },
  {
    id: "media",
    label: "媒体",
    description: "音频导入与转码",
  },
  {
    id: "corpus",
    label: "语料",
    description: "教师案例与检索",
  },
  {
    id: "settings",
    label: "设置",
    description: "密钥、模型与主题",
  },
];
