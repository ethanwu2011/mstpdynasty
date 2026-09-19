import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { LiveSquare } from "./Tag";

/** A small link for the right side of a header bar ("All scores"). Paper underline, inverts on hover. */
export function BarLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="type-label hit-area -my-1 px-1 py-1 text-paper underline decoration-2 underline-offset-[3px] hover:bg-paper hover:text-ink"
    >
      {children}
    </Link>
  );
}

export interface HeaderBarProps {
  /** Reversed Silkscreen caps that name the event or the board: "PICK 3.07", "WEEK 5 FINAL", "STANDINGS". */
  label: ReactNode;
  /** Heading element for the label (default h2). Use "div" when the bar is not a heading. */
  as?: "h1" | "h2" | "h3" | "div";
  id?: string;
  /** Right side of the bar: a status, a Tag, a small link. */
  right?: ReactNode;
  /** Slow-blinking red square before the label (live games, live draft). */
  live?: boolean;
  className?: string;
}

/** The black strip that labels every panel. */
export function HeaderBar({ label, as: As = "h2", id, right, live = false, className }: HeaderBarProps) {
  return (
    <div className={cx("on-ink flex min-h-10 items-center justify-between gap-3 bg-ink px-4 py-2.5 text-paper", className)}>
      <As id={id} className="type-label m-0 flex min-w-0 items-center gap-2">
        {live ? <LiveSquare blink /> : null}
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      </As>
      {right ? <div className="type-label flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
