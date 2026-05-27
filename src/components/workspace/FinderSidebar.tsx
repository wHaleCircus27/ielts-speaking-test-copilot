import { Database, FileAudio, FileText, HardDrive, History, Plus, Trash2 } from "lucide-react";
import type { CorrectionRecord, ReferenceTheme } from "../../app/workspaceTypes";

export function FinderSidebar({
  records,
  activeRecordId,
  currentTheme,
  corpusOpen,
  onSelectRecord,
  onDeleteRecord,
  onNewSession,
  onOpenCorpus,
}: {
  records: CorrectionRecord[];
  activeRecordId: string | null;
  currentTheme: ReferenceTheme;
  corpusOpen: boolean;
  onSelectRecord: (recordId: string) => void;
  onDeleteRecord: (recordId: string, event: React.MouseEvent) => void;
  onNewSession: () => void;
  onOpenCorpus: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col justify-between p-3">
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1 opacity-70">
          <div className="flex items-center gap-1.5">
            <History size={14} />
            <span className="text-xs font-bold uppercase tracking-tight">历史批改记录</span>
          </div>
          <span className="rounded bg-current/10 px-1.5 py-0.5 font-mono text-[10px]">{records.length}</span>
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={onOpenCorpus}
            className={`history-row group ${corpusOpen ? `history-row-active history-row-active-${currentTheme}` : ""}`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <Database size={14} className="mt-0.5 shrink-0 opacity-70" />
              <div className="min-w-0 flex-1 text-left leading-snug">
                <p className="truncate text-[11px] font-semibold">教师案例库</p>
                <p className="mt-0.5 text-[10px] opacity-50">SQLite CRUD 基础</p>
              </div>
            </div>
          </button>

          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-1 px-4 py-8 text-center text-[10px] opacity-40">
              <HardDrive size={24} className="mb-1 stroke-1" />
              <span>暂无历史口语作业</span>
              <span>录入文本批改后会保存记录</span>
            </div>
          ) : (
            records.map((record) => {
              const selected = record.id === activeRecordId;
              const isMedia = record.fileName !== "Typed Input";
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => onSelectRecord(record.id)}
                  className={`history-row group ${selected ? `history-row-active history-row-active-${currentTheme}` : ""}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0 opacity-70">
                      {isMedia ? <FileAudio size={14} /> : <FileText size={14} />}
                    </div>
                    <div className="min-w-0 flex-1 text-left leading-snug">
                      <p className="truncate text-[11px] font-semibold" title={record.title}>
                        {record.title}
                      </p>
                      <p className="mt-0.5 text-[10px] opacity-50">{record.date}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-current/10 px-1 py-0.5 font-mono text-[10px] font-bold">
                      B {record.result.overallScore.toFixed(1)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => onDeleteRecord(record.id, event)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          onDeleteRecord(record.id, event as unknown as React.MouseEvent);
                        }
                      }}
                      className="rounded p-0.5 text-red-500 opacity-0 transition-all hover:bg-red-500/10 group-hover:opacity-100"
                      title="删除记录"
                    >
                      <Trash2 size={12} />
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-3 shrink-0 border-t border-current/10 pt-3">
        <button type="button" onClick={onNewSession} className="new-session-button">
          <Plus size={14} />
          <span>新口语作业批改</span>
        </button>
      </div>
    </div>
  );
}
