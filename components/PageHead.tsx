import type { ReactNode } from "react";
import { cx } from "./cx";
import { HeaderBar } from "./HeaderBar";
import type { PanelSpan } from "./Panel";

const LG_SPAN: Record<PanelSpan, string> = {
  12: "lg:col-span-12",
  9: "lg:col-span-9",
  8: "lg:col-span-8",
  7: "lg:col-span-7",
  6: "lg:col-span-6",
  5: "lg:col-span-5",
  4: "lg:col-span-4",
  3: "lg:col-span-3",
};

export interface PageHeadProps {
  /** Silkscreen caps on the ink bar over the title ("Scoreboard", "Standings"). Not a heading. */
  bar: ReactNode;
  barRight?: ReactNode;
  /** Blinking red square in the bar (games live). */
  live?: boolean;
  /** The page's h1, set in Jersey 10. Keep it to a few words. */
  title: ReactNode;
  /** Silkscreen line under the title: the week, the as-of, the rule that matters. */
  meta?: ReactNode;
  /** Beside the title on wide screens, under it on narrow ones (a week rail, a key number). */
  aside?: ReactNode;
  /** Anything else in the title panel, under the title (copy, a shout line, an action). */
  children?: ReactNode;
  span?: PanelSpan;
  className?: string;
}

/**
 * The first panel of a data page: an ink bar that names the board, then the page title in
 * pixel caps and one line of context. Goes first inside a Board.
 */
export function PageHead({ bar, barRight, live, title, meta, aside, children, span = 12, className }: PageHeadProps) {
  return (
    <header className={cx("flex min-w-0 flex-col bg-paper md:col-span-12", LG_SPAN[span], className)}>
      <HeaderBar as="div" label={bar} right={barRight} live={live} />
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 pb-6 pt-7 md:px-6 md:pb-7 md:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="type-display m-0 break-words text-j3 sm:text-j4 xl:text-j5">{title}</h1>
            {meta ? <div className="type-label m-0 flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-muted">{meta}</div> : null}
          </div>
          {aside ? <div className="min-w-0">{aside}</div> : null}
        </div>
        {children}
      </div>
    </header>
  );
}
