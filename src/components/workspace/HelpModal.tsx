import { BookOpen, X } from "lucide-react";
import type { ReferenceTheme } from "../../app/workspaceTypes";
import { getAccentButtonClass, getCardClass } from "../../app/workspaceUtils";

export function HelpModal({ currentTheme, onClose }: { currentTheme: ReferenceTheme; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2147483001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className={`${getCardClass(currentTheme)} relative max-w-md p-6 text-xs`}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted hover:text-text" aria-label="关闭帮助">
          <X size={18} />
        </button>
        <h3 className="mb-3 flex items-center gap-1 text-sm font-bold tracking-tight">
          <BookOpen size={16} />
          <span>雅思口语提分大师批改小手册</span>
        </h3>
        <div className="space-y-3 text-left leading-relaxed opacity-90">
          <p>本界面严格采用参考项目的 macOS 工作台结构：菜单栏、历史侧栏、双栏工作区、报告 tabs 和底部状态栏。</p>
          <p>文件菜单可新建会话或导入音视频，主题切换可在 Claude、动物森友会和液态玻璃之间即时预览。</p>
          <p>当前可用链路包括 DeepSeek 文本批改、媒体转码和 Azure Speech SDK 长音频发音评估；真实 Azure Key 验证暂缓到人工验收阶段。</p>
        </div>
        <div className="mt-5 flex justify-end border-t border-current/10 pt-3">
          <button type="button" onClick={onClose} className={`rounded px-3.5 py-1.5 text-xs font-semibold ${getAccentButtonClass(currentTheme)}`}>
            理解了，开始练习
          </button>
        </div>
      </div>
    </div>
  );
}
