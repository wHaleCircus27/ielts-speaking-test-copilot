import { useState } from "react";
import { mapTeacherCaseMatchesToRagExamples, searchTeacherCases } from "../lib/corpus";
import { gradeSpeaking } from "../lib/grading";
import type { PublicAppConfig } from "../types/config";
import type { AppError } from "../types/errors";
import type { SpeakingPart } from "../types/grading";
import type { WorkspaceResult } from "../app/workspaceTypes";
import { mapGradeResultToWorkspaceResult } from "../app/workspaceUtils";

type TextGradingInput = {
  answer: string;
  part: SpeakingPart;
  question: string;
  title: string;
  fileName: string;
};

export function useGradingWorkflow({
  config,
  serviceReady,
  onAddRecord,
  onAfterTextRecordAdded,
}: {
  config: PublicAppConfig;
  serviceReady: boolean;
  onAddRecord: (title: string, fileName: string, result: WorkspaceResult) => void;
  onAfterTextRecordAdded: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<AppError | null>(null);

  async function loadRagExamplesForGrading(answer: string) {
    if (!config.zhipu.apiKeyConfigured) {
      return [];
    }

    try {
      const matches = await searchTeacherCases(answer, 3);
      return mapTeacherCaseMatchesToRagExamples(matches);
    } catch {
      return [];
    }
  }

  async function submitTextForGrading(input: TextGradingInput) {
    if (!config.deepseek.apiKeyConfigured || !serviceReady) {
      setWorkspaceError({
        code: "GRADING_NOT_READY",
        message: !serviceReady ? "本地 Tauri 服务未连接。" : "请先在设置中保存 DeepSeek API Key。",
      });
      return;
    }

    setLoading(true);
    setWorkspaceError(null);
    try {
      const ragExamples = await loadRagExamplesForGrading(input.answer);
      const gradeResult = await gradeSpeaking({
        text: input.answer,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples,
      });
      onAddRecord(input.title, input.fileName, mapGradeResultToWorkspaceResult(gradeResult, input.answer));
      onAfterTextRecordAdded();
    } catch (error) {
      setWorkspaceError(error as AppError);
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    workspaceError,
    setWorkspaceError,
    submitTextForGrading,
  };
}
