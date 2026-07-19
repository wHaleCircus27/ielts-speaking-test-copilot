import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Database,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/Field";
import {
  createTeacherCase,
  deleteTeacherCase,
  diagnoseTeacherCaseSearch,
  listTeacherCases,
  rebuildTeacherCaseEmbedding,
  updateTeacherCase,
} from "../../lib/corpus";
import type {
  TeacherCase,
  TeacherCaseInput,
  TeacherCaseSearchDiagnostics,
} from "../../types/corpus";
import type { AppError } from "../../types/errors";

const emptyTeacherCaseInput: TeacherCaseInput = {
  originalText: "",
  revisedText: "",
  teacherComment: "",
  scoringPreference: "",
};

export function CorpusPage() {
  const [teacherCases, setTeacherCases] = useState<TeacherCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [formInput, setFormInput] = useState<TeacherCaseInput>(
    emptyTeacherCaseInput,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [rebuildingCaseId, setRebuildingCaseId] = useState<string | null>(null);
  const [queueRebuildRunning, setQueueRebuildRunning] = useState(false);
  const [queueRebuildProgress, setQueueRebuildProgress] = useState({
    total: 0,
    done: 0,
    failures: 0,
  });
  const [searchPreviewQuery, setSearchPreviewQuery] = useState("");
  const [searchPreviewDiagnostics, setSearchPreviewDiagnostics] =
    useState<TeacherCaseSearchDiagnostics | null>(null);
  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false);
  const [searchPreviewSearched, setSearchPreviewSearched] = useState(false);
  const [searchPreviewError, setSearchPreviewError] = useState<AppError | null>(
    null,
  );
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCase = useMemo(
    () =>
      teacherCases.find((teacherCase) => teacherCase.id === selectedCaseId) ??
      null,
    [selectedCaseId, teacherCases],
  );
  const rebuildQueueCases = useMemo(
    () =>
      teacherCases.filter(
        (teacherCase) => teacherCase.embeddingStatus !== "ready",
      ),
    [teacherCases],
  );
  const canSave =
    formInput.originalText.trim().length > 0 &&
    formInput.revisedText.trim().length > 0 &&
    formInput.teacherComment.trim().length > 0 &&
    !saving;

  useEffect(() => {
    void refreshTeacherCases();
    // Initial hydration runs once; later refreshes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTeacherCases() {
    setLoading(true);
    setError(null);
    try {
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      if (
        selectedCaseId &&
        !nextTeacherCases.some(
          (teacherCase) => teacherCase.id === selectedCaseId,
        )
      ) {
        setSelectedCaseId(null);
        setFormInput(emptyTeacherCaseInput);
      }
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setLoading(false);
    }
  }

  function startNewCase() {
    setSelectedCaseId(null);
    setFormInput(emptyTeacherCaseInput);
    setNotice(null);
    setError(null);
  }

  function editTeacherCase(teacherCase: TeacherCase) {
    setSelectedCaseId(teacherCase.id);
    setFormInput({
      originalText: teacherCase.originalText,
      revisedText: teacherCase.revisedText,
      teacherComment: teacherCase.teacherComment,
      scoringPreference: teacherCase.scoringPreference ?? "",
    });
    setNotice(null);
    setError(null);
  }

  async function saveTeacherCase() {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const savedTeacherCase = selectedCaseId
        ? await updateTeacherCase(selectedCaseId, normalizeInput(formInput))
        : await createTeacherCase(normalizeInput(formInput));
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      setSelectedCaseId(savedTeacherCase.id);
      setFormInput({
        originalText: savedTeacherCase.originalText,
        revisedText: savedTeacherCase.revisedText,
        teacherComment: savedTeacherCase.teacherComment,
        scoringPreference: savedTeacherCase.scoringPreference ?? "",
      });
      setNotice(formatSaveNotice(Boolean(selectedCaseId), savedTeacherCase));
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setSaving(false);
    }
  }

  async function removeTeacherCase(teacherCaseId: string) {
    setDeletingCaseId(teacherCaseId);
    setError(null);
    setNotice(null);
    try {
      await deleteTeacherCase(teacherCaseId);
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      if (teacherCaseId === selectedCaseId) {
        setSelectedCaseId(null);
        setFormInput(emptyTeacherCaseInput);
      }
      setNotice("教师案例已删除。");
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setDeletingCaseId(null);
    }
  }

  async function rebuildEmbedding(teacherCaseId: string) {
    setRebuildingCaseId(teacherCaseId);
    setError(null);
    setNotice(null);
    try {
      await rebuildTeacherCaseEmbedding(teacherCaseId);
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      setNotice("教师案例 Embedding 已重建。");
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setRebuildingCaseId(null);
    }
  }

  async function rebuildPendingAndFailedEmbeddings() {
    const targetCases = teacherCases.filter(
      (teacherCase) => teacherCase.embeddingStatus !== "ready",
    );
    if (!targetCases.length || queueRebuildRunning) {
      return;
    }

    setQueueRebuildRunning(true);
    setQueueRebuildProgress({
      total: targetCases.length,
      done: 0,
      failures: 0,
    });
    setError(null);
    setNotice(null);
    let failureCount = 0;

    for (const [index, teacherCase] of targetCases.entries()) {
      try {
        await rebuildTeacherCaseEmbedding(teacherCase.id);
      } catch {
        failureCount += 1;
      } finally {
        setQueueRebuildProgress({
          total: targetCases.length,
          done: index + 1,
          failures: failureCount,
        });
      }
    }

    try {
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      setNotice(
        failureCount
          ? `pending/failed 重建队列完成：${targetCases.length - failureCount}/${targetCases.length} 条成功，${failureCount} 条失败。`
          : `pending/failed 重建队列完成：${targetCases.length} 条成功。`,
      );
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setQueueRebuildRunning(false);
    }
  }

  async function previewSearchTeacherCases() {
    const normalizedQuery = searchPreviewQuery.trim();
    if (!normalizedQuery || searchPreviewLoading) {
      return;
    }

    setSearchPreviewLoading(true);
    setSearchPreviewSearched(false);
    setSearchPreviewError(null);
    setSearchPreviewDiagnostics(null);
    try {
      setSearchPreviewDiagnostics(
        await diagnoseTeacherCaseSearch(normalizedQuery, 3),
      );
      setSearchPreviewSearched(true);
    } catch (caught) {
      setSearchPreviewError(caught as AppError);
    } finally {
      setSearchPreviewLoading(false);
    }
  }

  function updateFormField(field: keyof TeacherCaseInput, value: string) {
    setFormInput((currentInput) => ({
      ...currentInput,
      [field]: value,
    }));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">教师案例库</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              MVP 4 当前提供 SQLite 本地案例管理、智谱 embedding-3
              向量重建、Top-K 检索和 RAG Prompt 注入准备层。
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={startNewCase}
            disabled={saving}
          >
            <Plus size={16} className="mr-2" />
            新案例
          </Button>
        </div>

        <div className="grid gap-4">
          <Field label="学生原始文本">
            <textarea
              aria-label="学生原始文本"
              value={formInput.originalText}
              onChange={(event) =>
                updateFormField("originalText", event.target.value)
              }
              rows={5}
              className="min-h-[120px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="粘贴学生原始口语回答或 transcript..."
            />
          </Field>

          <Field label="教师修改后文本">
            <textarea
              aria-label="教师修改后文本"
              value={formInput.revisedText}
              onChange={(event) =>
                updateFormField("revisedText", event.target.value)
              }
              rows={5}
              className="min-h-[120px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="记录教师改写后的高分表达..."
            />
          </Field>

          <Field label="教师评语">
            <textarea
              aria-label="教师评语"
              value={formInput.teacherComment}
              onChange={(event) =>
                updateFormField("teacherComment", event.target.value)
              }
              rows={4}
              className="min-h-[96px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="记录教师批改习惯、常见提醒和提分重点..."
            />
          </Field>

          <Field
            label="打分偏好"
            hint="可选。后续 RAG 会用它辅助还原教师个人评分偏好。"
          >
            <TextInput
              value={formInput.scoringPreference ?? ""}
              onChange={(event) =>
                updateFormField("scoringPreference", event.target.value)
              }
              placeholder="例如：更重视自然连接、低容忍重复表达"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={() => void saveTeacherCase()}
              disabled={!canSave}
            >
              {saving ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <Save size={16} className="mr-2" />
              )}
              {selectedCase ? "保存修改" : "保存案例"}
            </Button>
            {selectedCase ? (
              <Button
                type="button"
                variant="ghost"
                onClick={startNewCase}
                disabled={saving}
              >
                <X size={16} className="mr-2" />
                退出编辑
              </Button>
            ) : null}
          </div>

          {notice ? (
            <div className="rounded-app border border-primary/30 bg-primary/10 p-3 text-sm leading-6 text-primary-strong">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-app border border-danger/30 bg-danger/10 p-4 text-sm leading-6 text-danger">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={16} />
                教师案例库操作失败
              </div>
              <p className="mt-1">{error.message}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <aside className="grid h-fit gap-6">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Database size={18} className="text-primary" />
              本地案例
            </h3>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void rebuildPendingAndFailedEmbeddings()}
                disabled={
                  !rebuildQueueCases.length ||
                  queueRebuildRunning ||
                  Boolean(rebuildingCaseId) ||
                  loading
                }
              >
                {queueRebuildRunning ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={16} className="mr-2" />
                )}
                重建 pending/failed
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void refreshTeacherCases()}
                disabled={loading}
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
                <span className="sr-only">刷新案例</span>
              </Button>
            </div>
          </div>

          {queueRebuildRunning ? (
            <div className="mb-4 rounded-app border border-primary/20 bg-primary/10 p-3 text-xs leading-5 text-primary-strong">
              重建队列 {queueRebuildProgress.done}/{queueRebuildProgress.total}
              ，失败 {queueRebuildProgress.failures}。
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              读取教师案例...
            </div>
          ) : teacherCases.length ? (
            <div className="grid gap-3">
              {teacherCases.map((teacherCase) => (
                <article
                  key={teacherCase.id}
                  className={`rounded-app border p-4 text-sm transition ${
                    teacherCase.id === selectedCaseId
                      ? "border-primary bg-primary/10"
                      : "border-border bg-elevated/35"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4
                        className="truncate font-semibold"
                        title={teacherCase.originalText}
                      >
                        {teacherCase.originalText}
                      </h4>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                        {teacherCase.teacherComment}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-elevated px-2 py-1 text-[10px] font-semibold uppercase text-muted">
                      {teacherCase.embeddingStatus}
                    </span>
                  </div>

                  {teacherCase.embeddingStatus === "failed" &&
                  teacherCase.embeddingError ? (
                    <div className="mt-3 rounded-md border border-danger/20 bg-danger/10 p-2 text-xs leading-5 text-danger">
                      {teacherCase.embeddingError}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => editTeacherCase(teacherCase)}
                    >
                      <Edit3 size={14} className="mr-2" />
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void rebuildEmbedding(teacherCase.id)}
                      disabled={
                        rebuildingCaseId === teacherCase.id ||
                        queueRebuildRunning
                      }
                    >
                      {rebuildingCaseId === teacherCase.id ? (
                        <Loader2 size={14} className="mr-2 animate-spin" />
                      ) : (
                        <RefreshCw size={14} className="mr-2" />
                      )}
                      重建 Embedding
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void removeTeacherCase(teacherCase.id)}
                      disabled={deletingCaseId === teacherCase.id}
                    >
                      {deletingCaseId === teacherCase.id ? (
                        <Loader2 size={14} className="mr-2 animate-spin" />
                      ) : (
                        <Trash2 size={14} className="mr-2" />
                      )}
                      删除
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-app border border-dashed border-border bg-elevated/35 p-6 text-center text-sm leading-6 text-muted">
              还没有教师案例。保存第一条案例后，会在这里显示本地 SQLite 记录。
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Search size={18} className="text-primary" />
              搜索预览
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              输入题目或学生回答，查看当前阈值下会被注入评分 Prompt 的 Top-K
              案例。
            </p>
          </div>

          <div className="grid gap-3">
            <textarea
              aria-label="教师案例搜索预览"
              value={searchPreviewQuery}
              onChange={(event) => {
                setSearchPreviewQuery(event.target.value);
                setSearchPreviewSearched(false);
                setSearchPreviewDiagnostics(null);
              }}
              rows={4}
              className="min-h-[96px] resize-y rounded-app border border-border bg-surface px-3 py-2 text-sm leading-6 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="粘贴当前题目和学生回答..."
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void previewSearchTeacherCases()}
              disabled={!searchPreviewQuery.trim() || searchPreviewLoading}
            >
              {searchPreviewLoading ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <Search size={16} className="mr-2" />
              )}
              检索 Top-K
            </Button>

            {searchPreviewError ? (
              <div className="rounded-app border border-danger/30 bg-danger/10 p-3 text-xs leading-5 text-danger">
                {searchPreviewError.message}
              </div>
            ) : null}

            {searchPreviewDiagnostics ? (
              <div className="rounded-app border border-border bg-elevated/35 p-3 text-[11px] leading-5 text-muted">
                阈值 {formatSimilarityScore(searchPreviewDiagnostics.threshold)}{" "}
                ·{" "}
                {formatEmbeddingSource(
                  searchPreviewDiagnostics.embeddingSource,
                )}{" "}
                · 候选 {searchPreviewDiagnostics.readyCandidateCount} · 命中{" "}
                {searchPreviewDiagnostics.matchedCount} · 低于阈值{" "}
                {searchPreviewDiagnostics.belowThresholdCount} ·{" "}
                {searchPreviewDiagnostics.durationMs}ms
              </div>
            ) : null}

            {searchPreviewDiagnostics?.included.length ? (
              <div className="grid gap-2">
                {searchPreviewDiagnostics.included.map((match) => (
                  <article
                    key={match.case.id}
                    className="rounded-app border border-border bg-elevated/35 p-3 text-xs leading-5"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h4 className="line-clamp-1 font-semibold">
                        {match.case.originalText}
                      </h4>
                      <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary-strong">
                        {formatSimilarityScore(match.score)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-muted">
                      {match.case.teacherComment}
                    </p>
                  </article>
                ))}
              </div>
            ) : searchPreviewSearched &&
              !searchPreviewLoading &&
              searchPreviewQuery.trim() &&
              !searchPreviewError ? (
              <div className="rounded-app border border-dashed border-border bg-elevated/35 p-4 text-center text-xs leading-5 text-muted">
                暂无达到相似度阈值的案例。
              </div>
            ) : null}

            {searchPreviewDiagnostics?.nearMisses.length ? (
              <div className="grid gap-2">
                <h4 className="text-xs font-semibold text-muted">
                  低于阈值的 near misses
                </h4>
                {searchPreviewDiagnostics.nearMisses.map((match) => (
                  <article
                    key={match.case.id}
                    className="rounded-app border border-border bg-surface/70 p-3 text-xs leading-5"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h5 className="line-clamp-1 font-semibold">
                        {match.case.originalText}
                      </h5>
                      <span className="shrink-0 rounded bg-elevated px-2 py-0.5 font-mono text-[10px] font-bold text-muted">
                        {formatSimilarityScore(match.score)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-muted">
                      {match.case.teacherComment}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function formatSaveNotice(isUpdate: boolean, teacherCase: TeacherCase) {
  if (teacherCase.embeddingStatus === "ready") {
    return isUpdate
      ? "教师案例已更新，Embedding 已自动重建。"
      : "教师案例已保存，Embedding 已自动生成。";
  }
  if (teacherCase.embeddingStatus === "failed") {
    return isUpdate
      ? "教师案例已更新，但 Embedding 自动重建失败。"
      : "教师案例已保存，但 Embedding 自动生成失败。";
  }
  return isUpdate
    ? "教师案例已更新，Embedding 状态为 pending。"
    : "教师案例已保存，Embedding 状态为 pending。";
}

function formatSimilarityScore(score: number) {
  if (!Number.isFinite(score)) {
    return "--";
  }
  return score.toFixed(2);
}

function formatEmbeddingSource(
  source: TeacherCaseSearchDiagnostics["embeddingSource"],
) {
  return source === "cache" ? "缓存命中" : "网络请求";
}

function normalizeInput(input: TeacherCaseInput): TeacherCaseInput {
  return {
    originalText: input.originalText.trim(),
    revisedText: input.revisedText.trim(),
    teacherComment: input.teacherComment.trim(),
    scoringPreference: input.scoringPreference?.trim() || undefined,
  };
}
