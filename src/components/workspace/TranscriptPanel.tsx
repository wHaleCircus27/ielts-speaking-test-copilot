import { lowAccuracyThreshold } from "../../lib/transcript";
import type { TranscriptToken } from "../../types/speech";

export function TranscriptPanel({
  tokens,
  wordTokenElementRefs,
  onJumpToTimestamp,
}: {
  tokens: TranscriptToken[];
  wordTokenElementRefs: React.MutableRefObject<
    Record<string, HTMLButtonElement | null>
  >;
  onJumpToTimestamp: (seconds: number) => void;
}) {
  return (
    <div className="max-h-[220px] overflow-y-auto rounded-xl border border-current/10 bg-current/[0.02] p-4 leading-8">
      {tokens.map((token) => {
        if (token.type === "pause") {
          return (
            <span
              key={token.id}
              className="mx-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600"
            >
              [Pause: {(token.durationMs / 1000).toFixed(1)}s]
            </span>
          );
        }

        const isLowAccuracy =
          token.accuracyScore !== undefined &&
          token.accuracyScore < lowAccuracyThreshold;
        const tooltipParts = [
          token.accuracyScore === undefined
            ? ""
            : `Accuracy: ${token.accuracyScore.toFixed(1)}`,
          ...(token.phonemeErrors ?? []),
        ].filter(Boolean);

        return (
          <button
            key={token.id}
            ref={(element) => {
              wordTokenElementRefs.current[token.id] = element;
            }}
            type="button"
            title={tooltipParts.join("\n")}
            onClick={() => onJumpToTimestamp(token.startMs / 1000)}
            className={`transcript-word mx-0.5 rounded px-1 py-0.5 transition hover:bg-current/10 ${
              isLowAccuracy
                ? "text-red-600 underline decoration-red-500 decoration-2 underline-offset-4"
                : ""
            }`}
          >
            {token.text}
          </button>
        );
      })}
    </div>
  );
}
