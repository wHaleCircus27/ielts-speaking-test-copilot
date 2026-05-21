import type { PropsWithChildren } from "react";

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <section className={`rounded-app border border-border bg-surface p-5 shadow-app ${className}`}>
      {children}
    </section>
  );
}
