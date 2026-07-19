import { useEffect, useRef, useState } from "react";
import type {
  AddCorrectionRecordInput,
  CorrectionRecord,
} from "../app/workspaceTypes";
import {
  formatDuration,
  formatRecordDate,
  isTauriRuntimeAvailable,
  recordsStorageKey,
} from "../app/workspaceUtils";
import {
  deleteGeneratedMediaFile,
  reconcileGeneratedMedia,
} from "../lib/media";
import type { AppError } from "../types/errors";

function normalizeStoredCorrectionRecord(
  storedValue: unknown,
): CorrectionRecord | null {
  if (typeof storedValue !== "object" || storedValue === null) {
    return null;
  }

  const candidateRecord = storedValue as Partial<CorrectionRecord>;
  if (
    typeof candidateRecord.id !== "string" ||
    typeof candidateRecord.title !== "string" ||
    typeof candidateRecord.date !== "string" ||
    typeof candidateRecord.fileName !== "string" ||
    typeof candidateRecord.duration !== "string" ||
    !Array.isArray(candidateRecord.transcript) ||
    typeof candidateRecord.result !== "object" ||
    candidateRecord.result === null
  ) {
    return null;
  }

  const normalizedRecord = { ...candidateRecord } as CorrectionRecord;
  if (
    typeof candidateRecord.audioPath === "string" &&
    candidateRecord.audioPath.trim()
  ) {
    normalizedRecord.audioPath = candidateRecord.audioPath.trim();
  } else {
    delete normalizedRecord.audioPath;
  }
  return normalizedRecord;
}

export function normalizeStoredCorrectionRecords(
  storedValue: unknown,
): CorrectionRecord[] {
  return normalizeStoredCorrectionRecordCollection(storedValue).records;
}

function normalizeStoredCorrectionRecordCollection(storedValue: unknown): {
  records: CorrectionRecord[];
  hasInvalidRecords: boolean;
} {
  if (!Array.isArray(storedValue)) {
    return { records: [], hasInvalidRecords: true };
  }

  const records: CorrectionRecord[] = [];
  let hasInvalidRecords = false;
  for (const storedRecord of storedValue) {
    const normalizedRecord = normalizeStoredCorrectionRecord(storedRecord);
    if (!normalizedRecord) {
      hasInvalidRecords = true;
      continue;
    }
    if (normalizedRecord.id !== "demo-assignment-technology") {
      records.push(normalizedRecord);
    }
  }
  return { records, hasInvalidRecords };
}

export function useSessionHistory() {
  const [records, setRecords] = useState<CorrectionRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<AppError | null>(null);
  const recordsRef = useRef<CorrectionRecord[]>([]);
  const historyWritableRef = useRef(true);
  const activeRecord =
    records.find((record) => record.id === activeRecordId) ?? null;

  useEffect(() => {
    let storedRecords: string | null;
    try {
      storedRecords = window.localStorage.getItem(recordsStorageKey);
    } catch {
      historyWritableRef.current = false;
      setHistoryError({
        code: "HISTORY_READ_FAILED",
        message: "历史记录暂时无法读取；为保护已有音频，本次未执行媒体清理。",
      });
      return;
    }
    if (storedRecords) {
      let parsedRecords: unknown;
      try {
        parsedRecords = JSON.parse(storedRecords);
      } catch {
        historyWritableRef.current = false;
        recordsRef.current = [];
        setRecords([]);
        setActiveRecordId(null);
        setHistoryError({
          code: "HISTORY_DATA_INVALID",
          message:
            "历史记录数据无法解析；原数据已保留，并已停止媒体清理。请先检查备份。",
        });
        return;
      }

      const normalizedCollection =
        normalizeStoredCorrectionRecordCollection(parsedRecords);
      const realRecords = normalizedCollection.records;
      recordsRef.current = realRecords;
      setRecords(realRecords);
      setActiveRecordId(realRecords[0]?.id ?? null);
      if (normalizedCollection.hasInvalidRecords) {
        historyWritableRef.current = false;
        setHistoryError({
          code: "HISTORY_STRUCTURE_INVALID",
          message:
            "部分历史记录结构异常；原数据已保留，并已停止媒体清理。请先检查备份。",
        });
        return;
      }
      historyWritableRef.current = true;
      try {
        if (realRecords.length) {
          window.localStorage.setItem(
            recordsStorageKey,
            JSON.stringify(realRecords),
          );
        } else {
          window.localStorage.removeItem(recordsStorageKey);
        }
      } catch {
        historyWritableRef.current = false;
        setHistoryError({
          code: "HISTORY_NORMALIZE_FAILED",
          message:
            "历史记录已读取，但规范化结果无法保存；原数据未覆盖，并已停止媒体清理。",
        });
        return;
      }
      reconcileOwnedAudioFiles(realRecords, setHistoryError);
      return;
    }

    historyWritableRef.current = true;
    recordsRef.current = [];
    setRecords([]);
    setActiveRecordId(null);
    reconcileOwnedAudioFiles([], setHistoryError);
  }, []);

  function persistRecords(nextRecords: CorrectionRecord[]) {
    if (!historyWritableRef.current) {
      throw new Error(
        "History storage is read-only until invalid data is recovered.",
      );
    }
    if (nextRecords.length) {
      window.localStorage.setItem(
        recordsStorageKey,
        JSON.stringify(nextRecords),
      );
    } else {
      window.localStorage.removeItem(recordsStorageKey);
    }
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
  }

  function addRecord({
    title,
    fileName,
    result,
    audioPath,
  }: AddCorrectionRecordInput) {
    const now = new Date();
    const newRecord: CorrectionRecord = {
      id: `record-${window.crypto.randomUUID()}`,
      title: title || "口语自主练习作业",
      date: formatRecordDate(now),
      fileName,
      duration: result.speechAssessment
        ? formatDuration(result.speechAssessment.durationMs / 1000)
        : "00:45",
      transcript: result.transcript,
      result,
      ...(audioPath?.trim() ? { audioPath: audioPath.trim() } : {}),
    };
    const nextRecords = [newRecord, ...recordsRef.current];
    persistRecords(nextRecords);
    setActiveRecordId(newRecord.id);
    return newRecord;
  }

  async function deleteRecord(recordId: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm("确认要删除这条雅思口语评测记录吗？此操作无法撤销。")) {
      return;
    }

    const recordsBeforeDelete = recordsRef.current;
    const recordToDelete = recordsBeforeDelete.find(
      (record) => record.id === recordId,
    );
    if (!recordToDelete) {
      return;
    }

    const previousActiveRecordId = activeRecordId;
    const deletedRecordIndex = recordsBeforeDelete.findIndex(
      (record) => record.id === recordId,
    );
    const nextRecords = recordsBeforeDelete.filter(
      (record) => record.id !== recordId,
    );
    setHistoryError(null);
    try {
      persistRecords(nextRecords);
      if (activeRecordId === recordId) {
        setActiveRecordId(nextRecords[0]?.id ?? null);
      }
      if (recordToDelete.audioPath && isTauriRuntimeAvailable()) {
        await deleteGeneratedMediaFile(recordToDelete.audioPath);
      }
    } catch {
      if (!recordsRef.current.some((record) => record.id === recordId)) {
        const restoredRecords = [...recordsRef.current];
        restoredRecords.splice(
          Math.min(deletedRecordIndex, restoredRecords.length),
          0,
          recordToDelete,
        );
        try {
          persistRecords(restoredRecords);
        } catch {
          // The stable error below avoids exposing local paths or storage details.
        }
      }
      setActiveRecordId(previousActiveRecordId);
      setHistoryError({
        code: "HISTORY_DELETE_FAILED",
        message: "历史记录或其音频未能删除，原记录已保留。请重试。",
      });
    }
  }

  return {
    records,
    activeRecord,
    activeRecordId,
    historyError,
    setActiveRecordId,
    addRecord,
    deleteRecord,
  };
}

function reconcileOwnedAudioFiles(
  records: CorrectionRecord[],
  setHistoryError: React.Dispatch<React.SetStateAction<AppError | null>>,
) {
  if (!isTauriRuntimeAvailable()) {
    return;
  }

  const ownedAudioPaths = records.flatMap((record) =>
    record.audioPath ? [record.audioPath] : [],
  );
  void reconcileGeneratedMedia(ownedAudioPaths).catch(() => {
    setHistoryError({
      code: "MEDIA_RECONCILE_FAILED",
      message: "生成媒体目录检查失败。新媒体任务可能暂时不可用，请重启后重试。",
    });
  });
}
