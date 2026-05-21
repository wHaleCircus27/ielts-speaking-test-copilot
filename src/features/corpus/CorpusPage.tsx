import { Card } from "../../components/Card";

export function CorpusPage() {
  return (
    <Card>
      <h3 className="text-lg font-semibold">教师案例库</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        MVP 4 将在这里实现教师案例录入、Embedding、Top-K 检索和 Prompt 注入。
      </p>
    </Card>
  );
}
