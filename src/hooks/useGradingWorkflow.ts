import { useState } from "react";
import {
  buildTeacherCaseSearchQuery,
  mapTeacherCaseMatchesToRagExamples,
  mapTeacherCaseMatchesToRagReferences,
  searchTeacherCases,
} from "../lib/corpus";
import { gradeSpeaking } from "../lib/grading";
import type { PublicAppConfig } from "../types/config";
import type { AppError } from "../types/errors";
import type { RagPromptExample, SpeakingPart } from "../types/grading";
import type { RagUsageInfo, WorkspaceResult } from "../app/workspaceTypes";
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

  async function loadRagContextForGrading(question: string, answer: string): Promise<{
    ragExamples: RagPromptExample[];
    ragUsage: RagUsageInfo;
  }> {
    if (!config.zhipu.apiKeyConfigured) {
      return {
        ragExamples: [],
        ragUsage: {
          status: "notConfigured",
          message: "未配置智谱 API Key，本次评分未使用教师案例库。",
          references: [],
        },
      };
    }

    try {
      const matches = await searchTeacherCases(buildTeacherCaseSearchQuery(question, answer), 3);
      return {
        ragExamples: mapTeacherCaseMatchesToRagExamples(matches),
        ragUsage: {
          status: matches.length ? "matched" : "none",
          message: matches.length
            ? `已引用 ${matches.length} 条教师案例。`
            : "案例库没有达到相似度阈值的匹配项。",
          references: mapTeacherCaseMatchesToRagReferences(matches),
        },
      };
    } catch {
      return {
        ragExamples: [],
        ragUsage: {
          status: "failed",
          message: "教师案例检索失败，本次评分未使用案例库。",
          references: [],
        },
      };
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
      const { ragExamples, ragUsage } = await loadRagContextForGrading(input.question, input.answer);
      const gradeResult = await gradeSpeaking({
        text: input.answer,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples,
      });
      onAddRecord(input.title, input.fileName, mapGradeResultToWorkspaceResult(gradeResult, input.answer, ragUsage));
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
