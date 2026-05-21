import { useState } from "react";
import { AlertCircle, BookOpen, ClipboardCheck, Copy, FileText, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, SelectInput, TextInput } from "../../components/Field";
import { gradeSpeaking } from "../../lib/grading";
import type { PublicAppConfig } from "../../types/config";
import type { AppError } from "../../types/errors";
import type { GradeResult, SpeakingPart } from "../../types/grading";

type GradingPageProps = {
  config: PublicAppConfig;
  serviceReady: boolean;
};

const partOptions: Array<{ value: SpeakingPart; label: string }> = [
  { value: "part1", label: "Part 1" },
  { value: "part2", label: "Part 2" },
  { value: "part3", label: "Part 3" },
];

const scoreLabels: Array<{ key: keyof GradeResult["sub_scores"]; label: string }> = [
  { key: "FC", label: "Fluency & Coherence" },
  { key: "LR", label: "Lexical Resource" },
  { key: "GRA", label: "Grammar Range & Accuracy" },
  { key: "PR", label: "Pronunciation" },
];

export function GradingPage({ config, serviceReady }: GradingPageProps) {
  const [part, setPart] = useState<SpeakingPart>("part2");
  const [question, setQuestion] = useState("Describe a happy event in your childhood");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const answerLength = answer.trim().length;
  const canSubmit = serviceReady && config.deepseek.apiKeyConfigured && answerLength >= 20 && !grading;

  async function submitGrade() {
    if (!canSubmit) {
      return;
    }

    setGrading(true);
    setError(null);

    try {
      const nextResult = await gradeSpeaking({
        text: answer,
        part,
        question: question.trim() || undefined,
        ragExamples: [],
      });
      setResult(nextResult);
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setGrading(false);
    }
  }

  function resetForm() {
    setPart("part2");
    setQuestion("");
    setAnswer("");
    setResult(null);
    setError(null);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid gap-6">
        <Card>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">文本批改</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                输入雅思口语题目与回答，DeepSeek 会返回结构化评分、词汇建议和重构示范。
              </p>
            </div>
            <span className="rounded-app border border-border bg-elevated px-3 py-1.5 text-xs font-semibold text-muted">
              {config.deepseek.model}
            </span>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="考试部分">
                <SelectInput value={part} onChange={(event) => setPart(event.target.value as SpeakingPart)}>
                  {partOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="题目" hint="可留空；提供题目能让评分更贴近 IELTS 语境。">
                <TextInput value={question} onChange={(event) => setQuestion(event.target.value)} />
              </Field>
            </div>

            <label className="grid gap-2 text-sm text-text">
              <span className="font-medium">学生回答文本</span>
              <textarea
                aria-label="学生回答文本"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={13}
                className="min-h-[300px] resize-y rounded-app border border-border bg-surface px-4 py-3 text-sm leading-7 text-text outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="Paste the IELTS Speaking transcript here..."
              />
              <span className="text-xs text-muted">当前长度：{answerLength} 字符；至少 20 字符后可提交。</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" onClick={submitGrade} disabled={!canSubmit}>
                <Sparkles size={16} className="mr-2" />
                {grading ? "批改生成中" : "生成批改报告"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={grading}>
                <RefreshCw size={16} className="mr-2" />
                重置
              </Button>
            </div>

            <ReadinessNotice
              answerLength={answerLength}
              apiKeyConfigured={config.deepseek.apiKeyConfigured}
              serviceReady={serviceReady}
            />

            {error ? (
              <div className="rounded-app border border-danger/30 bg-danger/10 p-4 text-sm leading-6 text-danger">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle size={16} />
                  批改失败
                </div>
                <p className="mt-1">{error.message}</p>
              </div>
            ) : null}
          </div>
        </Card>

        <ResultPanel result={result} />
      </section>

      <aside className="grid h-fit gap-6">
        <Card>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardCheck size={18} className="text-primary" />
            MVP 1 状态
          </h3>
          <dl className="mt-4 grid gap-3 text-sm">
            <StatusRow label="本地服务" ok={serviceReady} okText="已连接" failText="未连接" />
            <StatusRow
              label="DeepSeek Key"
              ok={config.deepseek.apiKeyConfigured}
              okText="已配置"
              failText="未配置"
            />
            <StatusRow label="Base URL" ok={Boolean(config.deepseek.baseUrl)} okText={config.deepseek.baseUrl} failText="空" />
          </dl>
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <FileText size={18} className="text-primary" />
            后续链路
          </h3>
          <p className="mt-3 text-sm leading-6 text-muted">
            音频导入和 FFmpeg 转码已移到媒体页。完成转码后，后续 MVP 会把 WAV 送入 Azure Pronunciation Assessment 并生成逐词 transcript。
          </p>
        </Card>
      </aside>
    </div>
  );
}

function ReadinessNotice({
  answerLength,
  apiKeyConfigured,
  serviceReady,
}: {
  answerLength: number;
  apiKeyConfigured: boolean;
  serviceReady: boolean;
}) {
  const messages = [
    !serviceReady ? "本地 Tauri 服务未连接。" : null,
    !apiKeyConfigured ? "请先在设置页保存 DeepSeek API Key。" : null,
    answerLength > 0 && answerLength < 20 ? "回答文本过短，至少需要 20 字符。" : null,
  ].filter(Boolean);

  if (!messages.length) {
    return null;
  }

  return (
    <div className="rounded-app border border-accent/40 bg-accent/10 p-4 text-sm leading-6 text-text">
      {messages.join(" ")}
    </div>
  );
}

function ResultPanel({ result }: { result: GradeResult | null }) {
  if (!result) {
    return (
      <Card>
        <div className="grid min-h-[240px] place-items-center rounded-app border border-dashed border-border bg-elevated/35 p-8 text-center">
          <div>
            <BookOpen className="mx-auto text-muted" size={34} />
            <h3 className="mt-4 text-lg font-semibold">等待批改结果</h3>
            <p className="mt-2 max-w-[520px] text-sm leading-6 text-muted">
              提交后这里会展示 DeepSeek 返回的真实结构化结果；不会再混入静态示例分数或伪报告。
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">批改报告</h2>
          <p className="mt-1 text-sm text-muted">DeepSeek 返回的结构化评分结果</p>
        </div>
        <div className="rounded-app border border-primary/30 bg-primary/10 px-4 py-2 text-center">
          <span className="block text-xs font-semibold text-primary-strong">Overall Band</span>
          <strong className="text-3xl leading-tight">{result.overall_band.toFixed(1)}</strong>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {scoreLabels.map((item) => (
          <div key={item.key} className="rounded-app border border-border bg-elevated/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{item.label}</h3>
              <span className="rounded-md bg-primary px-2 py-1 font-mono text-sm font-semibold text-white">
                {result.sub_scores[item.key].toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-muted">教师风格综合评语</h3>
        <p className="mt-2 rounded-app border border-border bg-surface p-4 text-sm leading-7">
          {result.personal_style_comment}
        </p>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-muted">词汇纠错与替换建议</h3>
        {result.vocabulary_corrections.length ? (
          <div className="mt-3 grid gap-3">
            {result.vocabulary_corrections.map((item) => (
              <article key={`${item.original}-${item.suggested}`} className="rounded-app border border-border bg-surface p-4 text-sm leading-6">
                <div>
                  <strong>{item.original}</strong>
                  <span className="mx-2 text-primary">→</span>
                  <strong>{item.suggested}</strong>
                </div>
                <p className="mt-1 text-muted">{item.reason}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-app border border-border bg-elevated/35 p-4 text-sm text-muted">
            模型未返回词汇纠错项。
          </p>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-muted">高分重构示范</h3>
          <Button type="button" variant="ghost" onClick={() => void copyText(result.reconstructed_essay)}>
            <Copy size={15} className="mr-2" />
            复制
          </Button>
        </div>
        <p className="whitespace-pre-wrap rounded-app border border-border bg-surface p-4 text-sm leading-7">
          {result.reconstructed_essay}
        </p>
      </section>
    </Card>
  );
}

function StatusRow({
  failText,
  label,
  ok,
  okText,
}: {
  failText: string;
  label: string;
  ok: boolean;
  okText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-semibold ${ok ? "text-primary-strong" : "text-danger"}`}>{ok ? okText : failText}</dd>
    </div>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}
