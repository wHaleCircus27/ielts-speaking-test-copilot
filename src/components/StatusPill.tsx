import type { ReactNode } from "react";

export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  children: ReactNode;
}) {
  const toneClass = {
    ok: "border-primary/30 bg-primary/10 text-primary-strong",
    warn: "border-danger/30 bg-danger/10 text-danger",
    muted: "border-border bg-elevated text-muted",
  }[tone];

  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}
