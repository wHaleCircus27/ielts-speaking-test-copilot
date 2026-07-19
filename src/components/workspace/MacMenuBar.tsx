import type { PropsWithChildren } from "react";
import { Apple, Battery, HelpCircle, Settings, Wifi } from "lucide-react";
import type { ThemeId } from "../../types/config";
import type { MenuId } from "../../app/workspaceTypes";

export function MacMenuBar({
  activeMenu,
  menuClock,
  previewTheme,
  onOpenMenu,
  onOpenSettings,
  onOpenHelp,
  onReset,
  onImportMedia,
  onSwitchTheme,
}: {
  activeMenu: MenuId | null;
  menuClock: string;
  previewTheme: ThemeId;
  onOpenMenu: (menuId: MenuId, event: React.MouseEvent) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onReset: () => void;
  onImportMedia: () => void;
  onSwitchTheme: (theme: ThemeId) => void;
}) {
  return (
    <div className="mac-menu-bar">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <button
          type="button"
          onClick={(event) => onOpenMenu("app", event)}
          className="mac-menu-trigger"
          aria-label="打开应用菜单"
        >
          <Apple size={15} />
        </button>

        <div className="relative">
          <button
            type="button"
            onMouseDown={(event) => onOpenMenu("app", event)}
            onClick={(event) => onOpenMenu("app", event)}
            className="mac-menu-title"
          >
            IELTS Assessor
          </button>
          {activeMenu === "app" ? (
            <MenuPanel className="left-0">
              <MenuButton
                onClick={onOpenSettings}
                label="偏好设置..."
                shortcut="⌘,"
              />
              <MenuDivider />
              <MenuButton onClick={onOpenHelp} label="关于 IELTS Assessor" />
            </MenuPanel>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onMouseDown={(event) => onOpenMenu("file", event)}
            onClick={(event) => onOpenMenu("file", event)}
            className="mac-menu-trigger"
          >
            文件
          </button>
          {activeMenu === "file" ? (
            <MenuPanel className="left-0 w-56">
              <MenuButton onClick={onReset} label="新建批改会话 (重置)" />
              <MenuDivider />
              <MenuButton
                onClick={onImportMedia}
                label="导入音视频"
                shortcut="drag & drop"
              />
            </MenuPanel>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onMouseDown={(event) => onOpenMenu("themes", event)}
            onClick={(event) => onOpenMenu("themes", event)}
            className="mac-menu-trigger"
          >
            主题切换
          </button>
          {activeMenu === "themes" ? (
            <MenuPanel className="left-0 w-56">
              <button
                type="button"
                data-theme-id="theme-claude"
                onClick={() => onSwitchTheme("theme-claude")}
                className="menu-item"
              >
                <span>Claude 优雅主题</span>
                {previewTheme === "theme-claude" ? (
                  <span className="text-[10px] opacity-55">●</span>
                ) : null}
              </button>
              <button
                type="button"
                data-theme-id="theme-animal"
                onClick={() => onSwitchTheme("theme-animal")}
                className="menu-item"
              >
                <span>动物森友会主题</span>
                {previewTheme === "theme-animal" ? (
                  <span className="text-[10px] opacity-55">●</span>
                ) : null}
              </button>
              <button
                type="button"
                data-theme-id="theme-glass"
                onClick={() => onSwitchTheme("theme-glass")}
                className="menu-item"
              >
                <span>液态玻璃暗色主题</span>
                {previewTheme === "theme-glass" ? (
                  <span className="text-[10px] opacity-55">●</span>
                ) : null}
              </button>
            </MenuPanel>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="hidden max-w-[180px] truncate font-mono text-[11px] opacity-60 md:inline">
          local@ielts-copilot
        </span>
        <Wifi size={14} className="opacity-75" />
        <Battery size={15} className="opacity-75" />
        <button
          type="button"
          onClick={onOpenSettings}
          className="mac-menu-icon"
          aria-label="打开设置"
        >
          <Settings size={14} />
        </button>
        <button
          type="button"
          onClick={onOpenHelp}
          className="mac-menu-icon"
          aria-label="打开帮助"
        >
          <HelpCircle size={14} />
        </button>
        <span className="tabular-nums font-semibold">
          {menuClock || "08:15"}
        </span>
      </div>
    </div>
  );
}

function MenuPanel({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`menu-panel absolute top-7 z-50 flex w-48 flex-col py-1 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  shortcut,
}: {
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  function runMenuAction(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onClick();
  }

  return (
    <button
      type="button"
      data-theme-id={
        label.includes("Claude")
          ? "theme-claude"
          : label.includes("动物")
            ? "theme-animal"
            : label.includes("液态")
              ? "theme-glass"
              : undefined
      }
      onClick={runMenuAction}
      className="menu-item"
    >
      <span>{label}</span>
      {shortcut ? (
        <span className="text-[10px] opacity-55">{shortcut}</span>
      ) : null}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-b border-current/10" />;
}
