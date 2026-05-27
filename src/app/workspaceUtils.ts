import { buildTranscriptTokens, getTranscriptText, lowAccuracyThreshold } from "../lib/transcript";
import type { FontPreference, FontSizePreference, ThemeId } from "../types/config";
import type { GradeResult } from "../types/grading";
import type { SpeechAssessmentResult } from "../types/speech";
import type { CorrectionCategory, ReferenceTheme, ResultTab, TranscriptChunk, WorkspaceResult } from "./workspaceTypes";

export const recordsStorageKey = "ielts_copilot_correction_records";

export function getReferenceTheme(theme: ThemeId): ReferenceTheme {
  if (theme === "theme-animal") {
    return "animal-crossing";
  }
  if (theme === "theme-glass") {
    return "liquid-glass";
  }
  return "claude";
}

export function getReferenceThemeClass(theme: ThemeId) {
  if (theme === "theme-animal") {
    return "assessor-theme-animal";
  }
  if (theme === "theme-glass") {
    return "assessor-theme-glass";
  }
  return "assessor-theme-claude";
}

export function getTypographyClass(font: FontPreference, fontSize: FontSizePreference) {
  return `typography-font-${font} typography-size-${fontSize}`;
}

export function getThemeLabel(theme: ThemeId) {
  if (theme === "theme-animal") {
    return "动物森友会";
  }
  if (theme === "theme-glass") {
    return "液态玻璃";
  }
  return "Claude";
}

export function getAccentButtonClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:opacity-90";
  }
  if (theme === "animal-crossing") {
    return "rounded-xl border-b-4 border-[#358E61] bg-[#57C491] font-bold text-white hover:bg-[#45B27F]";
  }
  return "rounded-full bg-[#F27D26] font-semibold text-white transition hover:brightness-110";
}

export function getSecondaryButtonClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "border border-white/10 bg-white/5 text-white hover:bg-white/10";
  }
  if (theme === "animal-crossing") {
    return "rounded-xl border-b-2 border-[#C6BBA3] bg-[#EFE8D3] font-semibold text-[#5C4D3C] hover:bg-[#E5DCC5]";
  }
  return "rounded-full border border-[#E8E8E6] bg-white text-[#5C5C5C] hover:bg-[#F7F7F5] hover:text-[#1D1D1F]";
}

export function getCardClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md";
  }
  if (theme === "animal-crossing") {
    return "rounded-2xl border-2 border-[#E9E4CE] bg-[#FCF9ED]";
  }
  return "rounded-xl border border-[#E8E8E6] bg-white shadow-xs";
}

export function getScoreData(result: WorkspaceResult | null, activeTab: ResultTab) {
  if (!result) {
    return null;
  }
  if (activeTab === "fluency") {
    return result.fluencyScore;
  }
  if (activeTab === "lexical") {
    return result.lexicalScore;
  }
  if (activeTab === "grammar") {
    return result.grammarScore;
  }
  if (activeTab === "pronunciation") {
    return result.pronunciationScore;
  }
  return null;
}

export function mapGradeResultToWorkspaceResult(result: GradeResult, transcriptText: string): WorkspaceResult {
  const transcript = splitTextIntoTranscript(transcriptText);
  return {
    overallScore: result.overall_band,
    fluencyScore: {
      score: result.sub_scores.FC,
      feedback: result.personal_style_comment,
      strengths: ["表达主线能够被理解", "回答内容可继续扩展为更完整段落"],
      improvements: ["增加自然连接词", "减少重复并补充具体例子"],
    },
    lexicalScore: {
      score: result.sub_scores.LR,
      feedback: result.vocabulary_corrections.length
        ? "模型识别到可替换的词汇与表达，建议优先整理为个人高频替换表。"
        : "当前词汇错误较少，但仍可继续升级搭配和地道表达。",
      strengths: ["核心意思表达清楚", "词汇基本符合题目语境"],
      improvements: result.vocabulary_corrections.map((correction) => `${correction.original} -> ${correction.suggested}`).slice(0, 3),
    },
    grammarScore: {
      score: result.sub_scores.GRA,
      feedback: "请结合句级修正复盘语法准确性，重点检查时态、单复数和从句结构。",
      strengths: ["基础句意完整", "有重构为复杂句的空间"],
      improvements: ["检查主谓一致", "将简单句合并为更自然的复合句"],
    },
    pronunciationScore: {
      score: result.sub_scores.PR,
      feedback: "当前文本批改无法直接评估真实发音；该分值来自模型对文本表现的结构化估计。",
      strengths: ["文本节奏可支持口头表达", "内容块适合按意群朗读"],
      improvements: ["接入音频评估后复盘重音和连读", "按 transcript 分句练习停顿"],
    },
    keyCorrections: result.vocabulary_corrections.map((correction) => ({
      original: correction.original,
      improved: correction.suggested,
      reason: correction.reason,
      category: "vocabulary",
    })),
    generalFeedback: result.personal_style_comment,
    modelAnswer: result.reconstructed_essay,
    transcript,
  };
}

export function mapSpeechAssessmentToWorkspaceResult(
  result: SpeechAssessmentResult,
  transcriptGradeResult?: GradeResult | null,
): WorkspaceResult {
  const transcriptText = getTranscriptText(result);
  const transcript = splitTextIntoTranscript(transcriptText);
  const transcriptTokens = buildTranscriptTokens(result.words);
  const pronunciationScore = normalizeAzureScoreToBand(result.overall.pronunciationScore);
  const fluencyScore = normalizeAzureScoreToBand(result.overall.fluencyScore);
  const textWorkspaceResult = transcriptGradeResult
    ? mapGradeResultToWorkspaceResult(transcriptGradeResult, transcriptText)
    : null;
  const lowAccuracyWords = result.words
    .filter((word) => word.accuracyScore !== undefined && word.accuracyScore < lowAccuracyThreshold)
    .slice(0, 8);
  const pronunciationCorrections = lowAccuracyWords.map((word) => ({
    original: word.word,
    improved: word.word,
    reason: `Azure 逐词 Accuracy 为 ${formatOptionalScore(word.accuracyScore)}，建议点击 transcript 回听并跟读。`,
    category: "pronunciation" as const,
  }));
  const speechFeedback = "Azure 已基于转码后的 WAV 完成长音频发音评估。Pronunciation、Fluency 和 Prosody 来自真实音频；Vocabulary、Grammar 和 Topic 由 DeepSeek 基于 transcript、题目和教师案例判断。";

  return {
    overallScore: textWorkspaceResult?.overallScore ?? pronunciationScore,
    fluencyScore: {
      score: fluencyScore,
      feedback: `Azure 长音频评估已完成。Fluency 原始分：${formatOptionalScore(result.overall.fluencyScore)}。`,
      strengths: textWorkspaceResult
        ? ["已基于真实音频生成逐词时间戳", ...textWorkspaceResult.fluencyScore.strengths.slice(0, 1)]
        : ["已基于真实音频生成逐词时间戳", "可结合播放器回听具体停顿和连读"],
      improvements: textWorkspaceResult
        ? ["优先复盘红色停顿标注", ...textWorkspaceResult.fluencyScore.improvements.slice(0, 1)]
        : ["优先复盘红色停顿标注", "对低分词进行跟读和重录"],
    },
    lexicalScore: textWorkspaceResult?.lexicalScore ?? {
      score: 0,
      feedback: "DeepSeek 文本维度暂不可用；Azure Speech 不直接返回 vocabulary 评分。",
      strengths: ["已保留 transcript，可稍后补跑 DeepSeek 文本评分"],
      improvements: ["配置 DeepSeek Key 后可评估词汇范围、准确性和话题贴合度"],
    },
    grammarScore: textWorkspaceResult?.grammarScore ?? {
      score: 0,
      feedback: "DeepSeek 文本维度暂不可用；Azure Speech 不直接返回 grammar 或 topic 内容评分。",
      strengths: ["已保留 transcript，可稍后补跑 DeepSeek 文本评分"],
      improvements: ["配置 DeepSeek Key 后可评估语法准确度、句式范围和内容展开"],
    },
    pronunciationScore: {
      score: pronunciationScore,
      feedback: [
        `Pronunciation 原始分：${formatOptionalScore(result.overall.pronunciationScore)}。`,
        `Accuracy：${formatOptionalScore(result.overall.accuracyScore)}；Fluency：${formatOptionalScore(result.overall.fluencyScore)}；Prosody 韵律/语调自然度：${formatOptionalScore(result.overall.prosodyScore)}。`,
      ].join("\n"),
      strengths: ["已完成长音频 continuous assessment", "逐词评分、音素提示和时间戳可用于精听复盘"],
      improvements: lowAccuracyWords.length
        ? lowAccuracyWords.map((word) => `${word.word}: ${formatOptionalScore(word.accuracyScore)}`)
        : ["未发现明显低于 60 分的单词", "继续关注重音、语调、语速和节奏自然度"],
    },
    keyCorrections: [
      ...(textWorkspaceResult?.keyCorrections ?? []),
      ...pronunciationCorrections,
    ].slice(0, 12),
    generalFeedback: textWorkspaceResult
      ? `${textWorkspaceResult.generalFeedback}\n\n${speechFeedback}`
      : "Azure 已基于转码后的 WAV 完成长音频发音评估。请在 transcript 中点击低分词或停顿标记附近回听；DeepSeek 文本维度暂不可用，因此词汇、语法和话题内容未生成结构化批语。",
    modelAnswer: textWorkspaceResult?.modelAnswer ?? (transcriptText || "Azure 未返回完整 transcript。"),
    transcript,
    transcriptTokens,
    speechAssessment: result,
  };
}

export function normalizeAzureScoreToBand(score: number | undefined) {
  if (score === undefined) {
    return 0;
  }

  return Number(Math.max(0, Math.min(9, (score / 100) * 9)).toFixed(1));
}

export function formatOptionalScore(score: number | undefined) {
  return score === undefined ? "--" : score.toFixed(1);
}

export function splitTextIntoTranscript(text: string): TranscriptChunk[] {
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks = sentences.length ? sentences : [text.trim()];
  return chunks.map((sentence, index) => ({
    timestamp: formatDuration(index * 7),
    seconds: index * 7,
    text: sentence,
  }));
}

export function getLocalFilePath(file: File) {
  return (file as File & { path?: string }).path ?? "";
}

export function getFileExtension(path: string) {
  const fileName = getFileNameFromPath(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension?.toLowerCase() ?? "";
}

export function isSupportedMediaExtension(extension: string) {
  return ["mp4", "mp3", "m4a", "wav"].includes(extension);
}

export function getFileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function isVideoPath(path: string) {
  return /\.(mp4|mov|m4v)$/i.test(path);
}

export function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function getSubcategoryName(activeTab: ResultTab) {
  if (activeTab === "fluency") {
    return "Fluency & Coherence (流利度与连贯性)";
  }
  if (activeTab === "lexical") {
    return "Lexical Resource (词汇丰富度)";
  }
  if (activeTab === "grammar") {
    return "Grammatical Range (语法多样性与准确性)";
  }
  if (activeTab === "pronunciation") {
    return "Pronunciation (发音)";
  }
  return "";
}

export function getScoreBadge(score: number) {
  if (score >= 7.5) {
    return "border border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
  }
  if (score >= 6) {
    return "border border-amber-500/20 bg-amber-500/10 text-amber-500";
  }
  return "border border-rose-500/20 bg-rose-500/10 text-rose-500";
}

export function getCorrectionBadge(category: CorrectionCategory) {
  if (category === "grammar") {
    return "border-red-500/20 bg-red-400/10 text-red-500";
  }
  if (category === "vocabulary") {
    return "border-indigo-500/20 bg-indigo-400/10 text-indigo-500";
  }
  if (category === "coherence") {
    return "border-amber-500/20 bg-amber-400/10 text-amber-500";
  }
  return "border-cyan-500/20 bg-cyan-400/10 text-cyan-500";
}

export function getCorrectionLabel(category: CorrectionCategory) {
  if (category === "grammar") {
    return "语法偏误";
  }
  if (category === "vocabulary") {
    return "词汇升级";
  }
  if (category === "coherence") {
    return "逻辑断流";
  }
  return "发音讹误";
}

export function formatRecordDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function formatDuration(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, "0");
  const seconds = `${safeSeconds % 60}`.padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function isTauriRuntimeAvailable() {
  return "__TAURI_INTERNALS__" in window;
}
