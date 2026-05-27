import { useEffect, useState } from "react";
import type { CorrectionRecord, WorkspaceResult } from "../app/workspaceTypes";
import { formatDuration, formatRecordDate, recordsStorageKey } from "../app/workspaceUtils";

export function useSessionHistory() {
  const [records, setRecords] = useState<CorrectionRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const activeRecord = records.find((record) => record.id === activeRecordId) ?? null;

  useEffect(() => {
    const storedRecords = window.localStorage.getItem(recordsStorageKey);
    if (storedRecords) {
      try {
        const parsedRecords = JSON.parse(storedRecords) as CorrectionRecord[];
        const realRecords = parsedRecords.filter((record) => record.id !== "demo-assignment-technology");
        setRecords(realRecords);
        setActiveRecordId(realRecords[0]?.id ?? null);
        if (realRecords.length) {
          window.localStorage.setItem(recordsStorageKey, JSON.stringify(realRecords));
        } else {
          window.localStorage.removeItem(recordsStorageKey);
        }
        return;
      } catch {
        window.localStorage.removeItem(recordsStorageKey);
      }
    }

    setRecords([]);
    setActiveRecordId(null);
  }, []);

  function persistRecords(nextRecords: CorrectionRecord[]) {
    setRecords(nextRecords);
    if (nextRecords.length) {
      window.localStorage.setItem(recordsStorageKey, JSON.stringify(nextRecords));
    } else {
      window.localStorage.removeItem(recordsStorageKey);
    }
  }

  function addRecord(title: string, fileName: string, result: WorkspaceResult) {
    const now = new Date();
    const newRecord: CorrectionRecord = {
      id: `record-${Date.now()}`,
      title: title || "口语自主练习作业",
      date: formatRecordDate(now),
      fileName,
      duration: result.speechAssessment ? formatDuration(result.speechAssessment.durationMs / 1000) : "00:45",
      transcript: result.transcript,
      result,
    };
    const nextRecords = [newRecord, ...records];
    persistRecords(nextRecords);
    setActiveRecordId(newRecord.id);
  }

  function deleteRecord(recordId: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm("确认要删除这条雅思口语评测记录吗？此操作无法撤销。")) {
      return;
    }

    const nextRecords = records.filter((record) => record.id !== recordId);
    persistRecords(nextRecords);
    if (activeRecordId === recordId) {
      setActiveRecordId(nextRecords[0]?.id ?? null);
    }
  }

  return {
    records,
    activeRecord,
    activeRecordId,
    setActiveRecordId,
    addRecord,
    deleteRecord,
  };
}
