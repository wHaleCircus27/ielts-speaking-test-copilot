import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Database, Edit3, Loader2, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/Field";
import {
  createTeacherCase,
  deleteTeacherCase,
  listTeacherCases,
  updateTeacherCase,
} from "../../lib/corpus";
import type { TeacherCase, TeacherCaseInput } from "../../types/corpus";
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
  const [formInput, setFormInput] = useState<TeacherCaseInput>(emptyTeacherCaseInput);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCase = useMemo(
    () => teacherCases.find((teacherCase) => teacherCase.id === selectedCaseId) ?? null,
    [selectedCaseId, teacherCases],
  );
  const canSave =
    formInput.originalText.trim().length > 0 &&
    formInput.revisedText.trim().length > 0 &&
    formInput.teacherComment.trim().length > 0 &&
    !saving;

  useEffect(() => {
    void refreshTeacherCases();
  }, []);

  async function refreshTeacherCases() {
    setLoading(true);
    setError(null);
    try {
      const nextTeacherCases = await listTeacherCases();
      setTeacherCases(nextTeacherCases);
      if (selectedCaseId && !nextTeacherCases.some((teacherCase) => teacherCase.id === selectedCaseId)) {
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
      setNotice(selectedCaseId ? "教师案例已更新，Embedding 状态已重置为 pending。" : "教师案例已保存。");
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
              MVP 4 第一阶段提供 SQLite 本地案例增删改查；Embedding、Top-K 检索和 Prompt 注入保留为后续能力。
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={startNewCase} disabled={saving}>
            <Plus size={16} className="mr-2" />
            新案例
          </Button>
        </div>

        <div className="grid gap-4">
          <Field label="学生原始文本">
            <textarea
              aria-label="学生原始文本"
              value={formInput.originalText}
              onChange={(event) => updateFormField("originalText", event.target.value)}
              rows={5}
              className="min-h-[120px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="粘贴学生原始口语回答或 transcript..."
            />
          </Field>

          <Field label="教师修改后文本">
            <textarea
              aria-label="教师修改后文本"
              value={formInput.revisedText}
              onChange={(event) => updateFormField("revisedText", event.target.value)}
              rows={5}
              className="min-h-[120px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="记录教师改写后的高分表达..."
            />
          </Field>

          <Field label="教师评语">
            <textarea
              aria-label="教师评语"
              value={formInput.teacherComment}
              onChange={(event) => updateFormField("teacherComment", event.target.value)}
              rows={4}
              className="min-h-[96px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="记录教师批改习惯、常见提醒和提分重点..."
            />
          </Field>

          <Field label="打分偏好" hint="可选。后续 RAG 会用它辅助还原教师个人评分偏好。">
            <TextInput
              value={formInput.scoringPreference ?? ""}
              onChange={(event) => updateFormField("scoringPreference", event.target.value)}
              placeholder="例如：更重视自然连接、低容忍重复表达"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" onClick={() => void saveTeacherCase()} disabled={!canSave}>
              {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
              {selectedCase ? "保存修改" : "保存案例"}
            </Button>
            {selectedCase ? (
              <Button type="button" variant="ghost" onClick={startNewCase} disabled={saving}>
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
            <Button type="button" variant="ghost" onClick={() => void refreshTeacherCases()} disabled={loading}>
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              <span className="sr-only">刷新案例</span>
            </Button>
          </div>

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
                      <h4 className="truncate font-semibold" title={teacherCase.originalText}>
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

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => editTeacherCase(teacherCase)}>
                      <Edit3 size={14} className="mr-2" />
                      编辑
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
      </aside>
    </div>
  );
}

function normalizeInput(input: TeacherCaseInput): TeacherCaseInput {
  return {
    originalText: input.originalText.trim(),
    revisedText: input.revisedText.trim(),
    teacherComment: input.teacherComment.trim(),
    scoringPreference: input.scoringPreference?.trim() || undefined,
  };
}
