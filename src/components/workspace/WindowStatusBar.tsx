export function WindowStatusBar({
  serviceReady,
  serviceLabel,
  themeLabel,
  recordCount,
}: {
  serviceReady: boolean;
  serviceLabel: string;
  themeLabel: string;
  recordCount: number;
}) {
  return (
    <footer className="window-statusbar">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`size-1.5 rounded-full ${serviceReady ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span className="truncate">{serviceLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span>主题: {themeLabel}</span>
        <span>记录: {recordCount}</span>
      </div>
    </footer>
  );
}
