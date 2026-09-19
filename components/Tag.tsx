import type { ReactNode } from "react";
import { cx } from "./cx";

export type TagTone = "ink" | "outline" | "paper" | "alarm";

export interface TagProps {
  children: ReactNode;
  /** ink = ink box (default), outline = ink frame on paper, paper = paper box (use on ink bars), alarm = red. */
  tone?: TagTone;
  /** Red square before the text. "blink" blinks slowly (live games, live draft). */
  square?: boolean | "blink";
  title?: string;
  className?: string;
}

const TONES: Record<TagTone, string> = {
  ink: "bg-ink text-paper px-1.5 py-[3px]",
  outline: "border-2 border-ink text-ink px-1 py-px",
  paper: "bg-paper text-ink px-1.5 py-[3px]",
  alarm: "bg-red text-on-red px-1.5 py-[3px]",
};

/** Tiny Silkscreen caps in a box: LIVE, FINAL, TRADE, WAIVER, $0 BID. */
export function Tag({ children, tone = "ink", square, title, className }: TagProps) {
  return (
    <span
      title={title}
      className={cx("type-label inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none", TONES[tone], className)}
    >
      {square ? <LiveSquare blink={square === "blink"} /> : null}
      {children}
    </span>
  );
}

export interface LiveSquareProps {
  blink?: boolean;
  /** Pixel size of the square (default 8). */
  size?: 8 | 10 | 12;
  className?: string;
}

const SQUARE: Record<NonNullable<LiveSquareProps["size"]>, string> = { 8: "size-2", 10: "size-2.5", 12: "size-3" };

/** The red alarm square. Decorative: pair it with a word (LIVE, LAST, the time). */
export function LiveSquare({ blink = false, size = 8, className }: LiveSquareProps) {
  return <span aria-hidden className={cx("inline-block shrink-0 bg-red", SQUARE[size], blink && "live-blink", className)} />;
}

/** The "sample data" marker for any result with `placeholder: true`. */
export function SampleMark({ onInk = false }: { onInk?: boolean }) {
  return (
    <Tag tone={onInk ? "paper" : "outline"} title="Placeholder numbers until the real model is wired in">
      Sample data
    </Tag>
  );
}
