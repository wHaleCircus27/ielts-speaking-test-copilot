import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ClipboardCheck,
  Copy,
  Edit3,
  FilePenLine,
  History,
  Mic,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { gradeSpeaking } from "../../lib/grading";
import type { PublicAppConfig } from "../../types/config";
import type { AppError } from "../../types/errors";
import type { GradeResult, SpeakingPart } from "../../types/grading";

type GradingPageProps = {
  config: PublicAppConfig;
  serviceReady: boolean;
};

const targetScores = ["5.5", "6.0", "6.5", "7.0", "7.5", "8.0"];

const examples = [
  { name: "Leo C...", topic: "Happy E...", score: "6.0" },
  { name: "Sherr...", topic: "Electroni...", score: "7.5" },
  { name: "Kevin ...", topic: "Environ...", score: "5.5" },
];

const transcript = [
  {
    time: "0:00",
    text: "Well, when I was like... maybe seven years old, there was a very happy event.",
    active: true,
  },
  {
    time: "0:07",
    text: "My parents, they got me a first bicycle for my birthday present.",
  },
  {
    time: "0:15",
    text: "I was wanting a bicycle for very long time, but it was expensive, you know?",
  },
  {
    time: "0:24",
    text: "On that morning, I woke up and see a big box in the living room.",
  },
];

const initialAnswer = transcript.map((line) => line.text).join("\n");

const gradeCards = [
  {
    title: "流利度与连贯性 (Fluency)",
    score: "6.0",
    text: "流利度良好，能够保持连贯的表达，但在第0s「Well, when I was like...」和第24s处存在明显的语言重复与自我修正。",
    featured: true,
  },
  {
    title: "词汇丰富度 (Vocabulary)",
    score: "6.5",
    text: "词汇使用满足家庭/童年的常见话题，能够准确使用 bicycle、birthday present、living room 等词汇。",
  },
  {
    title: "语法多样度与准确性",
    score: "5.5",
    text: "存在多次明显语法结构错误，尤其是时态不一致问题，例如 I was wanting 与 I woke up and see。",
  },
  {
    title: "发音表现 (Pronunciation)",
    score: "6.0",
    text: "大部分发音清晰可辨，部分辅音连缀和重音位置需要加强，语调偏平，缺少自然情绪起伏。",
  },
];

const bars = Array.from({ length: 42 }, (_, index) => {
  const shape = Math.sin(index * 0.42) * 12 + Math.cos(index * 0.17) * 8 + 28;
  return Math.max(10, Math.round(shape));
});

const glassTranscript = [
  { time: "0:15", text: "I was wanting a bicycle for very long time, but it was expensive, you know?" },
  { time: "0:24", text: "On that morning, I woke up and see a big box in the living room.", active: true },
  { time: "0:31", text: "It was shiny blue. I cannot ride it first, I keep falling down onto the grass." },
  { time: "0:40", text: "But my father, he was holding my back of the seat, and tell me: keep moving, keep moving." },
  { time: "0:51", text: "Finally, I can ride it alone. I felt like I was flying. It was really a beautiful memory." },
  { time: "1:02", text: "So yes, this is the happiest event in my childhood." },
];

const syntaxDiagnosis = [
  {
    original: "My parents, they got me a first bicycle for my birthday present.",
    improved: "My parents bought me my very first bicycle as a birthday present.",
    note: "在主语后增加复指代词 they 让口语中稍显赘余；got me a first 表达不如 bought me my very first 更符合英语地道表达习惯。",
    mode: "bright",
  },
  {
    original: "I was wanting a bicycle for very long time.",
    improved: "I had been wanting a bicycle for a very long time.",
    note: "过去某一事件之前一直有想要的愿望，使用过去完成进行时更能展示高级语法多样性。",
    mode: "bright",
  },
  {
    original: "I woke up and see a big box in the living room.",
    improved: "I woke up and saw a large box in the living room.",
    note: "动词平行结构需保持过去时；用 large 替代频繁使用的 big 能提升学术词汇区分。",
    mode: "dark",
  },
  {
    original: "It was shiny blue. I cannot ride it first, I keep falling down onto the grass.",
    improved: "It was a shiny blue bike. At first, I couldn't ride it, and I kept falling onto the grass.",
    note: "表示过去发生的事件应使用过去时；此外用 At first 代替 first，避免语句听起来像折扣式口语。",
    mode: "bright",
  },
];

export function GradingPage({ config, serviceReady }: GradingPageProps) {
  const [selectedScore, setSelectedScore] = useState("6.5");
  const [part, setPart] = useState<SpeakingPart>("part2");
  const [studentName, setStudentName] = useState("王同学 (Alex)");
  const [topic, setTopic] = useState("Describe a happy event in your childhood");
  const [answer, setAnswer] = useState(initialAnswer);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<AppError | null>(null);

  const canSubmit = serviceReady && config.deepseek.apiKeyConfigured && answer.trim().length >= 20;

  async function submitGrade() {
    setGrading(true);
    setGradeError(null);

    try {
      const result = await gradeSpeaking({
        text: answer,
        part,
        question: topic,
        ragExamples: [],
      });
      setGradeResult(result);
    } catch (error) {
      setGradeError(error as AppError);
    } finally {
      setGrading(false);
    }
  }

  function resetWork() {
    setSelectedScore("6.5");
    setPart("part2");
    setStudentName("王同学 (Alex)");
    setTopic("Describe a happy event in your childhood");
    setAnswer(initialAnswer);
    setGradeResult(null);
    setGradeError(null);
  }

  if (config.theme === "theme-glass") {
    return (
      <GlassGradingPage
        answer={answer}
        canSubmit={canSubmit}
        gradeError={gradeError}
        gradeResult={gradeResult}
        grading={grading}
        onAnswerChange={setAnswer}
        onReset={resetWork}
        onSubmit={submitGrade}
        targetScore={Number(selectedScore)}
      />
    );
  }

  return (
    <main className="mx-auto max-w-[1340px] px-6 py-6">
      <div className="grid gap-6 xl:grid-cols-[300px_minmax(430px,1fr)_430px]">
        <aside className="grid content-start gap-5">
          <Panel className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <SectionTitle icon={<History size={16} />}>历史批阅档案 (1)</SectionTitle>
              <button className="text-[12px] text-muted">清空</button>
            </div>
            <button className="w-full rounded-app border-2 border-primary bg-surface p-3 text-left shadow-[0_3px_0_rgb(var(--color-primary-strong)/0.35)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-bold">LeoChen (小陈同学)</p>
                  <p className="mt-1 truncate text-[11px] uppercase text-muted">
                    Describe a happy event in yo...
                  </p>
                </div>
                <span className="island-badge rounded-md border border-accent/50 bg-accent/20 px-2 py-1 text-[14px] font-bold text-text">
                  6.0分
                </span>
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-muted">
                <span>时长：68s</span>
                <span>2026/5/20 23:47</span>
              </div>
            </button>
          </Panel>

        </aside>

        <Panel className="p-6">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <SectionTitle icon={<WandSparkles size={20} />}>
              <span className="text-[20px]">作业导入配置</span>
            </SectionTitle>
            <span className="rounded-md border border-border bg-elevated px-3 py-2 font-mono text-[13px] font-bold text-muted">
              NookSpeak v1.2
            </span>
          </div>

          <div className="grid gap-4">
            <div className="grid grid-cols-[1fr_1fr] gap-4 max-md:grid-cols-1">
              <label className="grid gap-2">
                <span className="text-[13px] font-semibold text-muted">学生姓名 / 编号</span>
                <input
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  className="h-10 rounded-app border border-border bg-surface px-3 text-[15px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <div className="grid gap-2">
                <span className="text-[13px] font-semibold text-muted">
                  目标雅思分数 (TARGET SCORE)
                </span>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {targetScores.map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setSelectedScore(score)}
                      className={`h-9 min-w-11 rounded-md border px-2 font-mono text-[13px] font-bold ${
                        selectedScore === score
                          ? "island-score-selected border-primary bg-primary text-white"
                          : "border-border bg-surface text-muted"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-[13px] font-semibold text-muted">雅思口语话题 / 考题 (IELTS TOPIC)</span>
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="h-11 rounded-app border border-border bg-surface px-3 text-[15px] text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-[13px] font-semibold text-muted">考试部分 (SPEAKING PART)</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["part1", "Part 1"],
                  ["part2", "Part 2"],
                  ["part3", "Part 3"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPart(value as SpeakingPart)}
                    className={`h-9 rounded-md border text-[13px] font-bold ${
                      part === value
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface text-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 grid min-h-[174px] place-items-center rounded-app border-2 border-dashed border-border bg-surface/75 p-6 text-center">
              <div>
                <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full border border-border bg-elevated text-muted">
                  <Upload size={22} />
                </div>
                <p className="text-[16px] font-medium">
                  拖拽音频文件到此处，或
                  <button className="ml-1 font-bold text-primary-strong underline underline-offset-2">
                    浏览本地文件
                  </button>
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  支持 mp3, wav, m4a, webm 等主流语言多媒体格式
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="text-[12px] text-muted">- 或者 -</span>
                  <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-muted">
                    <Mic size={15} className="text-danger" />
                    立即现场录音
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-border pt-4">
              <SectionTitle icon={<ClipboardCheck size={16} />}>内置优质测试范例 (免上传直接体验)</SectionTitle>
              <div className="mt-3 grid grid-cols-3 gap-3 max-md:grid-cols-1">
                {examples.map((example, index) => (
                  <button
                    key={example.name}
                    className={`rounded-lg border bg-surface px-3 py-3 text-left ${
                      index === 0 ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex justify-between gap-2 text-[13px] font-bold">
                      <span>{example.name}</span>
                      <span>{example.score} 分</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted">{example.topic}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-1 grid grid-cols-[1fr_100px] gap-3 max-sm:grid-cols-1">
              <button
                type="button"
                onClick={submitGrade}
                disabled={!canSubmit || grading}
                className="island-primary-button inline-flex h-12 items-center justify-center gap-2 rounded-app bg-primary px-5 text-[15px] font-bold text-white shadow-sm disabled:opacity-60"
              >
                <Sparkles size={18} className="text-accent" />
                {grading ? "批改生成中..." : "生成高精确度转写与批改报告"}
              </button>
              <button
                type="button"
                onClick={resetWork}
                className="h-12 rounded-app border border-border bg-surface px-4 text-[14px] font-bold text-muted"
              >
                重置作业
              </button>
            </div>
            {gradeError ? (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] leading-6 text-danger">
                {gradeError.message}
              </div>
            ) : null}
            {!config.deepseek.apiKeyConfigured ? (
              <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-[13px] leading-6 text-text">
                请先在设置页保存 DeepSeek API Key。当前不会发起批改请求。
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel className="p-6">
          <AudioPanel />
          <TranscriptPanel answer={answer} onAnswerChange={setAnswer} />
        </Panel>
      </div>

      <section className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="max-xl:hidden" />
        <ReportPanel result={gradeResult} targetScore={Number(selectedScore)} />
      </section>
    </main>
  );
}

function GlassGradingPage({
  canSubmit,
  gradeError,
  gradeResult,
  grading,
  onReset,
  onSubmit,
  targetScore,
}: {
  answer: string;
  canSubmit: boolean;
  gradeError: AppError | null;
  gradeResult: GradeResult | null;
  grading: boolean;
  onAnswerChange: (value: string) => void;
  onReset: () => void;
  onSubmit: () => void;
  targetScore: number;
}) {
  const [tab, setTab] = useState<"grades" | "syntax" | "report">("report");
  const overall = gradeResult?.overall_band ?? 6.0;

  return (
    <main className="mx-auto grid min-w-0 max-w-[1480px] gap-7 overflow-hidden px-5 py-7 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="grid min-w-0 content-start gap-6">
        <section className="glass-panel rounded-app p-5">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <SectionTitle icon={<History size={16} />}>历史档案 (1)</SectionTitle>
            <div className="flex items-center gap-3 text-[12px]">
              <button className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 font-bold text-accent">
                + 录入
              </button>
              <button className="font-bold text-danger">清空</button>
            </div>
          </div>
          <button className="glass-blue-glow w-full rounded-xl border border-primary bg-primary/10 p-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold text-text">LeoChen (小陈同学)</p>
                <p className="mt-1 truncate text-[11px] uppercase text-muted">
                  Describe a happy event in y...
                </p>
              </div>
              <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[13px] font-bold text-amber-400">
                6.0分
              </span>
            </div>
            <div className="mt-4 flex justify-between font-mono text-[11px] text-muted">
              <span>时长：68s</span>
              <span>2026/5/20 23:47</span>
            </div>
          </button>
        </section>

        <section className="glass-panel rounded-app p-5">
          <SectionTitle icon={<Sparkles size={18} />}>Mac 精确诊断指南</SectionTitle>
          <ul className="mt-4 grid gap-4 text-[13px] leading-6 text-muted">
            <li className="pl-4 before:-ml-4 before:mr-2 before:text-primary before:content-['•']">
              配合音轨滚动条，轻按句子或点击声纹轻松重现跟读。
            </li>
            <li className="pl-4 before:-ml-4 before:mr-2 before:text-primary before:content-['•']">
              使用句法诊断笔对中西表达偏误，直接在细格里实时编辑。
            </li>
            <li className="pl-4 before:-ml-4 before:mr-2 before:text-primary before:content-['•']">
              点击拷贝诊断文本，立即将精美的全版报告存入剪切板。
            </li>
          </ul>
        </section>
      </aside>

      <div className="grid min-w-0 gap-7">
        <section className="glass-panel rounded-app p-7">
          <GlassAudioDeck />
          <div className="mt-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <SectionTitle>英文跟读逐字段落文本</SectionTitle>
                <p className="mt-1 text-[12px] italic text-muted">
                  点击任何讲述字段，可以直接跳转至对应音频帧精准评测
                </p>
              </div>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 text-[13px] font-bold text-primary">
                <PencilLine size={16} />
                手动校订文本
              </button>
            </div>
            <GlassTranscriptDeck />
          </div>
          {gradeError ? (
            <div className="mt-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {gradeError.message}
            </div>
          ) : null}
        </section>

        <section className="glass-panel overflow-hidden rounded-app">
          <div className="grid grid-cols-3 text-[14px] font-bold text-muted max-md:grid-cols-1">
            <GlassTabButton active={tab === "grades"} onClick={() => setTab("grades")} icon={<BookOpen size={16} />}>
              雅思官方分项细则 (Analytical Grades)
            </GlassTabButton>
            <GlassTabButton active={tab === "syntax"} onClick={() => setTab("syntax")} icon={<ClipboardCheck size={16} />}>
              句式纠错与升格列表 (4)
            </GlassTabButton>
            <GlassTabButton active={tab === "report"} onClick={() => setTab("report")} icon={<Sparkles size={16} />}>
              名师评语与报告 (Report Card)
            </GlassTabButton>
          </div>

          {tab === "syntax" ? <GlassSyntaxPanel /> : null}
          {tab === "report" ? (
            <GlassReportPanel
              canSubmit={canSubmit}
              grading={grading}
              onReset={onReset}
              onSubmit={onSubmit}
              overall={overall}
              targetScore={targetScore}
            />
          ) : null}
          {tab === "grades" ? <GlassGradesPanel overall={overall} targetScore={targetScore} /> : null}
        </section>
      </div>
    </main>
  );
}

function GlassAudioDeck() {
  return (
    <div className="glass-soft rounded-app p-6">
      <div className="mb-7 flex items-center justify-between">
        <span className="font-mono text-[15px] font-bold text-muted">0:24 / 1:08</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] font-bold uppercase text-muted">
          0 SEEK READY
        </span>
      </div>
      <div className="flex h-[62px] min-w-0 items-end gap-1 overflow-hidden border-b border-white/10 pb-4">
        {Array.from({ length: 48 }, (_, index) => (
          <span
            key={index}
            className={`min-w-1 flex-1 rounded-md ${index < 18 ? "bg-primary" : "bg-white/[0.08]"}`}
            style={{ height: Math.max(9, Math.round(Math.sin(index * 0.42) * 18 + 28)) }}
          />
        ))}
      </div>
      <div className="mt-5 flex items-center gap-5">
        <button className="grid size-12 place-items-center rounded-full bg-primary text-white shadow-[0_0_28px_rgb(var(--color-primary)/0.35)]">
          <Play size={20} fill="currentColor" />
        </button>
        <button className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.08] text-muted">
          <RotateCcw size={17} />
        </button>
        <div className="flex flex-1 items-center justify-center gap-0">
          <div className="h-1 w-[44%] rounded-l-full bg-primary" />
          <span className="size-5 rounded-full bg-primary shadow-[0_0_22px_rgb(var(--color-primary)/0.5)]" />
          <div className="h-1 w-[32%] rounded-r-full bg-white/80" />
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase text-muted">
          <Volume2 size={16} className="text-primary" />
          AAC DECODING
        </div>
      </div>
    </div>
  );
}

function GlassTranscriptDeck() {
  const rows = [...glassTranscript, ...glassTranscript.slice(1), ...glassTranscript.slice(1, 5)];

  return (
    <div className="glass-soft glass-scrollbar max-h-[920px] overflow-y-auto rounded-app p-5">
      <div className="grid gap-4">
        {rows.map((line, index) => {
          const active = line.active || index === 6 || index === 11;
          return (
            <div
              key={`${line.time}-${index}`}
              className={`grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-3 rounded-2xl px-4 py-3 text-[15px] leading-7 ${
                active
                  ? "border-l-4 border-primary bg-primary/[0.12] font-bold text-text"
                  : index === rows.length - 2
                    ? "bg-white/[0.04] text-text"
                    : "text-zinc-300"
              }`}
            >
              <span
                className={`w-fit rounded-md px-2 py-0.5 font-mono text-[13px] font-bold ${
                  active ? "bg-primary/25 text-primary" : "bg-white/[0.06] text-muted"
                }`}
              >
                {line.time}
              </span>
              <span>{line.text}</span>
              {index === rows.length - 2 ? (
                <span className="justify-self-end rounded-md bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent">
                  播放 0
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlassTabButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-14 items-center justify-center gap-2 border-b border-r border-white/10 ${
        active ? "border-b-2 border-b-primary bg-white/[0.04] text-text" : "hover:bg-white/[0.04]"
      }`}
    >
      <span className="text-primary">{icon}</span>
      {children}
    </button>
  );
}

function GlassSyntaxPanel() {
  return (
    <div className="glass-scrollbar max-h-[980px] overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="font-bold uppercase tracking-wide text-muted">语法诊断与名师表达升格 (Syntax Diagnosis)</p>
          <p className="mt-1 text-[13px] italic text-muted">配合音频或锁定并改写考生表意含混的表达，输出具有学术色彩的进阶方案</p>
        </div>
        <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] px-4 font-bold text-primary">
          <Plus size={16} />
          新增诊断记录
        </button>
      </div>
      <div className="grid gap-6">
        {syntaxDiagnosis.map((item, index) => (
          <article
            key={item.original}
            className={`grid grid-cols-[42px_minmax(0,1fr)_74px] gap-4 rounded-[20px] p-6 ${
              item.mode === "dark"
                ? "border border-white/[0.12] bg-white/5"
                : "bg-white text-zinc-950"
            }`}
          >
            <span
              className={`grid size-8 place-items-center rounded-full text-[13px] font-bold ${
                item.mode === "dark" ? "bg-white/10 text-zinc-300" : "bg-zinc-800 text-white"
              }`}
            >
              {index + 1}
            </span>
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-5 max-lg:grid-cols-1">
                <GlassSyntaxBlock
                  label="学生病错原词句 (ORIGINAL)"
                  text={item.original}
                  tone="danger"
                  dark={item.mode === "dark"}
                />
                <GlassSyntaxBlock
                  label="地道金句升级 (ACADEMIC ALT)"
                  text={item.improved}
                  tone="success"
                  dark={item.mode === "dark"}
                />
              </div>
              <div
                className={`rounded-xl px-5 py-3 text-[14px] leading-6 ${
                  item.mode === "dark" ? "bg-white/[0.06] text-zinc-300" : "bg-zinc-50 text-zinc-400"
                }`}
              >
                <span className="font-bold text-primary">诊断细节解析：</span>
                {item.note}
              </div>
            </div>
            <div className="grid content-start gap-2">
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-zinc-800 px-3 text-[12px] font-bold text-white">
                <Edit3 size={14} />
                修改
              </button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-zinc-800 px-3 text-[12px] font-bold text-white">
                <Copy size={14} />
                复制
              </button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-danger/[0.12] px-3 text-danger">
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function GlassSyntaxBlock({
  dark,
  label,
  text,
  tone,
}: {
  dark: boolean;
  label: string;
  text: string;
  tone: "danger" | "success";
}) {
  const color = tone === "danger" ? "text-danger" : "text-accent";
  const bg =
    tone === "danger"
      ? dark
        ? "bg-danger/[0.12]"
        : "bg-danger/10"
      : dark
        ? "bg-accent/[0.12]"
        : "bg-accent/10";

  return (
    <div>
      <p className={`mb-2 text-[13px] font-black tracking-wide ${color}`}>{label}</p>
      <div className={`rounded-xl ${bg} px-5 py-3 font-mono text-[15px] font-bold italic leading-7 ${dark ? "text-white" : "text-zinc-100"}`}>
        "{text}"
      </div>
    </div>
  );
}

function GlassReportPanel({
  canSubmit,
  grading,
  onReset,
  onSubmit,
  overall,
  targetScore,
}: {
  canSubmit: boolean;
  grading: boolean;
  onReset: () => void;
  onSubmit: () => void;
  overall: number;
  targetScore: number;
}) {
  return (
    <div className="p-6">
      <div className="glass-soft rounded-app p-7">
        <div className="mb-7 flex items-center justify-between border-b border-white/10 pb-6">
          <SectionTitle icon={<Sparkles size={20} />}>
            <span className="text-[22px]">雅思考官报告制作台</span>
          </SectionTitle>
          <button
            type="button"
            onClick={canSubmit ? onSubmit : onReset}
            disabled={grading}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/10 px-4 text-[13px] font-bold text-zinc-200 disabled:opacity-50"
          >
            <RefreshCw size={16} />
            {grading ? "重新编译中" : "重新编译报告"}
          </button>
        </div>

        <div className="grid gap-4">
          <p className="text-[14px] font-bold uppercase text-muted">考官诊断个性化手写箴语 (Personal Notes)</p>
          <textarea
            className="min-h-[112px] resize-y rounded-2xl border border-white/10 bg-white/[0.07] px-5 py-4 text-[18px] font-bold leading-8 text-text outline-none focus:border-primary/60"
            defaultValue="口语流畅度展现良好。建议后续继续抓紧学术词似的高级替换运用（如用 robust 代替 strong），保证发音连贯性和饱满重音，稳固冲刺更高分数！加油！"
          />
          <p className="text-[12px] italic text-muted">*这些个性化考官寄语将会自动化变动并缀装在下方的学术诊断报告底栏处。</p>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-[14px] font-bold text-muted">
            反馈报告全文预览（包含了智能考级星级评定、病句时态解析、现场录像逐字稿）
          </p>
          <div className="glass-scrollbar relative max-h-[540px] overflow-auto rounded-2xl border border-white/10 bg-white/[0.06] p-5 font-mono text-[14px] font-bold leading-8 text-zinc-200">
            <GlassCopyRail />
            <pre className="min-w-full whitespace-pre-wrap pr-0 md:pr-44 xl:min-w-[900px]">{buildGlassReportText(overall, targetScore)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlassCopyRail() {
  return (
    <div className="pointer-events-none absolute right-4 top-4 grid gap-6">
      {[0, 1, 2].map((item) => (
        <button
          key={item}
          className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-bold text-white shadow-[0_12px_24px_rgb(var(--color-primary)/0.35)]"
        >
          <Copy size={16} />
          拷贝诊断文本
        </button>
      ))}
    </div>
  );
}

function GlassGradesPanel({ overall, targetScore }: { overall: number; targetScore: number }) {
  return (
    <div className="p-7">
      <div className="glass-soft rounded-app p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-[22px] font-black">Apple Core 雅思学术精算成绩</h3>
            <p className="mt-1 text-sm text-muted">以暗色玻璃仪表盘展示四项分数和目标线。</p>
          </div>
          <div className="font-mono text-lg font-black text-primary">
            {overall.toFixed(1)} / 9.0
          </div>
        </div>
        <div className="mt-6 h-2 rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (overall / targetScore) * 82)}%` }} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          {gradeCards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="font-bold">{card.title}</h4>
                <span className="rounded-md bg-primary/15 px-2 py-1 font-mono font-bold text-primary">{card.score}</span>
              </div>
              <p className="text-[13px] leading-6 text-muted">{card.text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildGlassReportText(overall: number, targetScore: number) {
  return `========================================
☑ Apple Academic IELTS Oral Feedback
========================================
👤 考生：LeoChen（小陈同学） | 🎯 目标分数：${targetScore.toFixed(1)}分
📝 答题话题：Describe a happy event in your childhood
⏱ 测评时间：2026/5/20 23:47

----------------------------------------
📊 Apple Core 雅思学术精算成绩 (Assessment)
----------------------------------------
⭐ 估算综合总成绩 (Overall Estimated Score): ${overall.toFixed(1)} / 9.0分

1. 流利度与自然连贯性 (Fluency & Coherence)：6.0 分
   【测评意见】：流利度良好，能够保持连贯的表达。但在第0s、24s和51s有明显的语言重复与自我修正。

2. 词汇多样性与同义替换 (Lexical Resource)：6.5 分
   【测评意见】：词汇使用满足家庭/童年的常见话题，但高级词汇、同义替换和情绪表达仍有提升空间。

3. 语法结构多样性与精准度 (Grammar Range & Accuracy)：5.5 分
   【测评意见】：存在多次明显语法结构错误，尤其是过去叙事中的时态一致性。

4. 发音表现 (Pronunciation)：6.0 分
   【测评意见】：多数发音清楚可辨，建议增强重音饱满度和连续表达的韵律感。`;
}

function TranscriptPanel({
  answer,
  onAnswerChange,
}: {
  answer: string;
  onAnswerChange: (value: string) => void;
}) {
  return (
    <div className="mt-5">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <SectionTitle>英语录文 (TRANSCRIPT)</SectionTitle>
                <p className="mt-1 text-[12px] text-muted">点击对应句子，支持音频进度头极速跳转定位</p>
              </div>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-muted">
                <PencilLine size={15} />
                手动校订文本
              </button>
            </div>

            <div className="max-h-[340px] overflow-y-auto rounded-app border border-border bg-surface p-4">
              <textarea
                value={answer}
                onChange={(event) => onAnswerChange(event.target.value)}
                rows={11}
                className="min-h-[270px] w-full resize-none rounded-app border-l-4 border-primary bg-primary/10 px-4 py-3 text-[15px] leading-7 text-text outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="在这里粘贴或校订学生的口语转写文本..."
              />
            </div>
          </div>
  );
}

function AudioPanel() {
  return (
    <div className="rounded-app border border-border bg-surface p-4 shadow-[0_8px_24px_rgb(var(--color-text)/0.04)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-[14px] font-semibold text-muted">0:03 / 1:08</span>
        <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] font-bold text-primary-strong">
          就绪 (SEEK READY)
        </span>
      </div>
      <div className="flex h-[58px] items-end gap-1 border-b border-border pb-3">
        {bars.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className={`w-1.5 rounded-full ${index < 4 ? "bg-primary" : "bg-elevated"}`}
            style={{ height }}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="flex size-10 items-center justify-center rounded-full border border-accent/60 bg-accent text-text shadow-sm">
          <Play size={18} fill="currentColor" />
        </button>
        <button className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted">
          <RotateCcw size={17} />
        </button>
        <div className="flex flex-1 items-center gap-2">
          <span className="size-4 rounded-full bg-primary" />
          <div className="h-1.5 flex-1 rounded-full bg-elevated">
            <div className="h-full w-[16%] rounded-full bg-primary-strong" />
          </div>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase text-muted">
          <Volume2 size={15} />
          System Audio
        </div>
      </div>
    </div>
  );
}

function ReportPanel({
  result,
  targetScore,
}: {
  result: GradeResult | null;
  targetScore: number;
}) {
  const readHashTab = () => {
    if (typeof window === "undefined") {
      return "grades";
    }

    if (window.location.hash === "#report-panel-syntax") {
      return "syntax";
    }

    if (window.location.hash === "#report-panel-report") {
      return "report";
    }

    return "grades";
  };
  const [activeTab, setActiveTab] = useState<"grades" | "syntax" | "report">(readHashTab);
  const overall = result?.overall_band ?? 6.0;
  const gap = Math.max(0, targetScore - overall);
  const cards = result
    ? [
        {
          title: "流利度与连贯性 (Fluency)",
          score: result.sub_scores.FC.toFixed(1),
          text: result.personal_style_comment,
          featured: true,
        },
        {
          title: "词汇丰富度 (Vocabulary)",
          score: result.sub_scores.LR.toFixed(1),
          text:
            result.vocabulary_corrections[0]?.reason ??
            "模型未返回单独词汇纠错原因，请参考重构示范。",
        },
        {
          title: "语法多样度与准确性",
          score: result.sub_scores.GRA.toFixed(1),
          text: result.reconstructed_essay,
        },
        {
          title: "发音表现 (Pronunciation)",
          score: result.sub_scores.PR.toFixed(1),
          text: "文本批改阶段暂未接入真实发音评分；该分项由模型基于转写文本进行保守估计。",
        },
      ]
    : gradeCards;
  const coreImprovementText =
    result?.reconstructed_essay ??
    "Leo Chen 的表现基本达到了 IELTS 6.0 的要求。他的主要瓶颈在于语法。第一，需要看重解决叙述过去发生的个人经历时，时态混乱和时态转换的稳定性。第二，词汇方面应当刻意积累形容事物、感觉和经历的二级词汇。第三，应该尝试使用一些长句/复合句来突破短句的组合，练习通过连词和副词来让逻辑转换更自然通顺。";

  async function copyCoreImprovementText() {
    await copyTextToClipboard(coreImprovementText);
  }

  useEffect(() => {
    function onHashChange() {
      setActiveTab(readHashTab());
    }

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <Panel className="overflow-hidden">
      <div className="relative z-[2147483001] grid grid-cols-3 border-b border-border text-[14px] max-md:grid-cols-1" role="tablist" aria-label="批改报告视图">
        <a
          href="#report-panel-grades"
          role="tab"
          aria-selected={activeTab === "grades"}
          data-testid="report-tab-grades"
          onClick={() => setActiveTab("grades")}
          className={`flex h-11 items-center justify-center gap-2 border-b-2 font-bold ${
            activeTab === "grades"
              ? "border-primary bg-surface text-text"
              : "border-transparent bg-elevated/60 text-muted"
          }`}
        >
          <BookOpen size={16} className="text-primary" />
          雅思官方分项细则 (Analytical Grades)
        </a>
        <a
          href="#report-panel-syntax"
          role="tab"
          aria-selected={activeTab === "syntax"}
          data-testid="report-tab-syntax"
          onClick={() => setActiveTab("syntax")}
          className={`flex h-11 items-center justify-center gap-2 border-l border-b-2 border-border ${
            activeTab === "syntax"
              ? "border-b-primary bg-surface font-bold text-text"
              : "border-b-transparent bg-elevated/60 text-muted"
          }`}
        >
          <FilePenLine size={16} className="text-primary" />
          句式纠错与升格列表 (4)
        </a>
        <a
          href="#report-panel-report"
          role="tab"
          aria-selected={activeTab === "report"}
          data-testid="report-tab-report"
          onClick={() => setActiveTab("report")}
          className={`flex h-11 items-center justify-center gap-2 border-l border-b-2 border-border ${
            activeTab === "report"
              ? "border-b-primary bg-surface font-bold text-text"
              : "border-b-transparent bg-elevated/60 text-muted"
          }`}
        >
          <Sparkles size={16} className="text-primary" />
          名师评语批语报告 (Report Card)
        </a>
      </div>

      {activeTab === "grades" ? (
      <div className="p-7 max-md:p-4" id="report-panel-grades" data-testid="report-panel-grades" role="tabpanel">
        <div className="rounded-app border border-border bg-surface p-5">
          <div className="grid grid-cols-[1fr_320px] items-center gap-6 max-lg:grid-cols-1">
            <div className="flex items-center gap-4">
              <div className="grid size-[72px] place-items-center rounded-full border-4 border-accent/70 bg-accent text-center shadow-[inset_0_-4px_0_rgb(210_149_22/0.55)]">
                <span className="text-[11px] font-bold uppercase text-text">Band</span>
                <strong className="-mt-2 text-[28px] leading-none text-text">
                  {overall.toFixed(1)}
                </strong>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[20px] font-bold">综合评估结果</h3>
                  <span className="rounded-full bg-elevated px-2 py-1 text-[12px] text-muted">
                    {result ? `距目标尚差${gap.toFixed(1)}分` : "等待生成真实批改"}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {result ? "DeepSeek 已返回结构化批改结果" : "评估模板：雅思官方最新Speaking考级评分准则"}
                </p>
              </div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-[14px] font-bold">
                <span>目标：{targetScore.toFixed(1)}</span>
                <span>当前估分：{overall.toFixed(1)} / 9.0</span>
              </div>
              <div className="relative h-2 rounded-full bg-elevated">
                <div className="h-full w-[68%] rounded-full bg-accent" />
                <div className="absolute left-[62%] top-[-5px] h-4 w-0.5 bg-danger" />
              </div>
              <p className="mt-2 text-right text-[11px] italic text-muted">
                红线标注为老师所设的目标分数线
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          {cards.map((card) => (
            <article
              key={card.title}
              className={`rounded-app border bg-surface p-5 ${
                card.featured ? "border-primary shadow-[0_0_0_1px_rgb(var(--color-primary)/0.35)]" : "border-border"
              }`}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-[14px] font-bold">{card.title}</h4>
                <span className="island-badge rounded-md border border-accent/50 bg-accent/20 px-2 py-1 font-mono text-[14px] font-bold text-text">
                  {card.score}
                </span>
              </div>
              <p className="line-clamp-4 text-[13px] leading-6 text-muted">{card.text}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-app border border-border bg-elevated/45 p-5">
          <SectionTitle icon={<BookOpen size={16} />}>
            流利度与连贯度 (Fluency & Coherence) - 专业批注对照
          </SectionTitle>
          <p className="mt-3 text-[13px] leading-6 text-muted">
            考核学生的表达语速、连贯性、语篇长度以及使用衔接词和逻辑连接的自然程度。评测是否存在犹豫、自我修正或重复多见动作。
          </p>
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-[13px] font-semibold text-text">
            标准与进阶建议：7分标准要求表达详尽且无明显费力，拥有自我修正，能熟练且没有错误地使用各类衔接手段。
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-muted">综合学术评价与核心改进规则</p>
            <button
              type="button"
              onClick={copyCoreImprovementText}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-elevated px-3 text-[13px] font-bold text-primary hover:border-primary"
            >
              <Copy size={15} />
              复制
            </button>
          </div>
          <div className="rounded-app border border-border bg-surface p-5 text-[15px] leading-8">
            {coreImprovementText}
          </div>
        </div>
        {result?.vocabulary_corrections.length ? (
          <div className="mt-6 rounded-app border border-border bg-surface p-5">
            <p className="mb-3 text-[13px] font-semibold text-muted">词汇纠错与替换建议</p>
            <div className="grid gap-3">
              {result.vocabulary_corrections.map((item) => (
                <div
                  key={`${item.original}-${item.suggested}`}
                  className="rounded-lg border border-border bg-surface p-3 text-[13px] leading-6"
                >
                  <strong>{item.original}</strong>
                  <span className="mx-2 text-primary">→</span>
                  <strong>{item.suggested}</strong>
                  <p className="mt-1 text-muted">{item.reason}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      {activeTab === "syntax" ? <NonGlassSyntaxPanel /> : null}
      {activeTab === "report" ? (
        <NonGlassTeacherReport overall={overall} targetScore={targetScore} />
      ) : null}
    </Panel>
  );
}

function NonGlassSyntaxPanel() {
  return (
    <div className="p-7 max-md:p-4" id="report-panel-syntax" data-testid="report-panel-syntax" role="tabpanel">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle icon={<FilePenLine size={17} />}>句式纠错与升格列表</SectionTitle>
          <p className="mt-1 text-[13px] text-muted">对学生原句、升格表达和诊断说明进行集中查看。</p>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-app border border-border bg-elevated px-4 text-sm font-bold text-primary">
          <Plus size={16} />
          新增诊断
        </button>
      </div>
      <div className="grid gap-4">
        {syntaxDiagnosis.map((item, index) => (
          <article key={item.original} className="rounded-app border border-border bg-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-elevated font-mono text-sm font-bold text-muted">
                {index + 1}
              </span>
              <div className="flex gap-2">
                <button className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-elevated px-2 text-xs font-bold text-muted">
                  <Edit3 size={13} />
                  修改
                </button>
                <button className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-elevated px-2 text-xs font-bold text-muted">
                  <Copy size={13} />
                  复制
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
              <div>
                <p className="mb-2 text-[13px] font-black tracking-wide text-danger">学生病错原词句 (ORIGINAL)</p>
                <div className="rounded-app bg-danger/10 px-4 py-3 font-mono text-[14px] font-bold italic leading-7 text-text">
                  "{item.original}"
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-black tracking-wide text-primary">地道金句升级 (ACADEMIC ALT)</p>
                <div className="rounded-app bg-primary/10 px-4 py-3 font-mono text-[14px] font-bold leading-7 text-text">
                  "{item.improved}"
                </div>
              </div>
            </div>
            <p className="mt-4 rounded-app border border-border bg-elevated/45 px-4 py-3 text-[13px] leading-6 text-muted">
              <span className="font-bold text-primary">诊断细节解析：</span>
              {item.note}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function NonGlassTeacherReport({
  overall,
  targetScore,
}: {
  overall: number;
  targetScore: number;
}) {
  return (
    <div className="p-7 max-md:p-4" id="report-panel-report" data-testid="report-panel-report" role="tabpanel">
      <div className="rounded-app border border-border bg-surface p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <SectionTitle icon={<Sparkles size={18} />}>名师评语批语报告</SectionTitle>
          <button className="inline-flex h-10 items-center gap-2 rounded-app border border-border bg-elevated px-4 text-sm font-bold text-muted">
            <RefreshCw size={15} />
            重新生成
          </button>
        </div>
        <label className="grid gap-2">
          <span className="text-[13px] font-bold text-muted">个性化评语</span>
          <textarea
            className="min-h-[112px] resize-y rounded-app border border-border bg-elevated/35 px-4 py-3 text-[15px] leading-7 text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            defaultValue="口语流畅度展现良好。建议后续继续加强高级替换表达，保证发音连贯性和重音饱满度，稳固冲刺更高分数。"
          />
        </label>
        <div className="mt-5 rounded-app border border-border bg-elevated/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold text-muted">反馈报告全文预览</p>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-bold text-white">
              <Copy size={15} />
              拷贝诊断文本
            </button>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-7 text-text">
{buildGlassReportText(overall, targetScore)}
          </pre>
        </div>
      </div>
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`island-panel rounded-app border border-border bg-surface shadow-app ${className}`}>
      {children}
    </section>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[14px] font-bold text-text">
      {icon ? <span className="text-primary">{icon}</span> : null}
      <span>{children}</span>
    </div>
  );
}
