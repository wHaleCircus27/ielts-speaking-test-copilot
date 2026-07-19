import { useEffect, useRef, useState } from "react";
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
import type {
  AddCorrectionRecordInput,
  RagUsageInfo,
} from "../app/workspaceTypes";
import { mapGradeResultToWorkspaceResult } from "../app/workspaceUtils";

type TextGradingInput = {
  answer: string;
  part: SpeakingPart;
  question: string;
  title: string;
  fileName: string;
};

export type GradingSubmissionOutcome =
  { status: "succeeded" } | { status: "failed" } | { status: "canceled" };

export function useGradingWorkflow({
  config,
  serviceReady,
  onAddRecord,
}: {
  config: PublicAppConfig;
  serviceReady: boolean;
  onAddRecord: (input: AddCorrectionRecordInput) => unknown;
}) {
  const [loading, setLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<AppError | null>(null);
  const gradingOperationGeneration = useRef(0);
  const disclosureAccepted =
    config.disclosure.acceptedVersion === config.disclosure.latestVersion;

  useEffect(() => {
    return () => {
      gradingOperationGeneration.current += 1;
    };
  }, []);

  async function loadRagContextForGrading(
    question: string,
    answer: string,
  ): Promise<{
    ragExamples: RagPromptExample[];
    ragUsage: RagUsageInfo;
  }> {
    if (
      !config.zhipu.enabled ||
      config.zhipu.credentialStatus !== "configured" ||
      !disclosureAccepted
    ) {
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
      const matches = await searchTeacherCases(
        buildTeacherCaseSearchQuery(question, answer),
        3,
      );
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

  async function submitTextForGrading(
    input: TextGradingInput,
  ): Promise<GradingSubmissionOutcome> {
    const deepSeekReady =
      config.deepseek.enabled &&
      config.deepseek.credentialStatus === "configured" &&
      disclosureAccepted;
    if (!deepSeekReady || !serviceReady) {
      setWorkspaceError({
        code: "GRADING_NOT_READY",
        message: !serviceReady
          ? "本地 Tauri 服务未连接。"
          : !disclosureAccepted
            ? "请先在设置中接受云服务数据说明。"
            : !config.deepseek.enabled
              ? "请先在设置中启用 DeepSeek。"
              : "请先在设置中保存与当前 endpoint 匹配的 DeepSeek API Key。",
      });
      return { status: "failed" };
    }

    const operationGeneration = ++gradingOperationGeneration.current;
    setLoading(true);
    setWorkspaceError(null);
    try {
      const { ragExamples, ragUsage } = await loadRagContextForGrading(
        input.question,
        input.answer,
      );
      if (operationGeneration !== gradingOperationGeneration.current) {
        return { status: "canceled" };
      }
      const gradeResult = await gradeSpeaking({
        text: input.answer,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples,
      });
      if (operationGeneration !== gradingOperationGeneration.current) {
        return { status: "canceled" };
      }
      onAddRecord({
        title: input.title,
        fileName: input.fileName,
        result: mapGradeResultToWorkspaceResult(
          gradeResult,
          input.answer,
          ragUsage,
        ),
      });
      return { status: "succeeded" };
    } catch (error) {
      if (operationGeneration !== gradingOperationGeneration.current) {
        return { status: "canceled" };
      }
      setWorkspaceError(normalizeGradingError(error));
      return { status: "failed" };
    } finally {
      if (operationGeneration === gradingOperationGeneration.current) {
        setLoading(false);
      }
    }
  }

  function cancelPendingGrading() {
    gradingOperationGeneration.current += 1;
    setLoading(false);
    setWorkspaceError(null);
  }

  return {
    loading,
    workspaceError,
    setWorkspaceError,
    submitTextForGrading,
    cancelPendingGrading,
  };
}

function normalizeGradingError(error: unknown): AppError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return error as AppError;
  }

  return {
    code: "GRADING_FAILED",
    message: "批改未完成，请检查服务配置后重试。输入内容已保留。",
  };
}
