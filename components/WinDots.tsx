import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface WinDotsProps {
  /** Side A's win probability, 0..1. Filled ink dots are A, hollow dots are B. */
  aProb: number;
  aName: string;
  bName: string;
  /** Number of dots (default 20: one dot is 5%). */
  dots?: number;
  /** Final result: allows 0 or all dots. Otherwise a live game always keeps one dot each side. */
  isFinal?: boolean;
  /** Light the dots in order on first paint (reduced motion shows them at once). */
  animate?: boolean;
  className?: string;
}

/** Filled dots for side A, counted from the left. */
export function filledDots(aProb: number, dots: number, isFinal: boolean): number {
  const p = Number.isFinite(aProb) ? Math.min(1, Math.max(0, aProb)) : 0.5;
  const n = Math.round(p * dots);
  if (isFinal) return n;
  return Math.min(dots - 1, Math.max(1, n));
}

/** The 20-dot win-probability row. */
export function WinDots({ aProb, aName, bName, dots = 20, isFinal = false, animate = false, className }: WinDotsProps) {
  const filled = filledDots(aProb, dots, isFinal);
  const aPct = Math.round(Math.min(1, Math.max(0, aProb)) * 100);
  return (
    <div
      role="img"
      aria-label={`Win probability: ${aName} ${aPct} percent, ${bName} ${100 - aPct} percent`}
      className={cx("grid w-full gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${dots}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: dots }, (_, i) => (
        <span
          key={i}
          className={cx("block aspect-square", i < filled ? "bg-ink" : "border-2 border-ink", animate && "dot-light")}
          style={animate ? ({ "--i": i } as CSSProperties) : undefined}
        />
      ))}
    </div>
  );
}
