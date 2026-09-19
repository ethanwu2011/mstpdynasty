import type { ReactNode } from "react";
import { cx } from "./cx";
import { HeaderBar } from "./HeaderBar";

/*
 * The broadsheet grid. A Board is an ink field with 2px gaps; Panels are paper tiles
 * laid on it, so every gap reads as a 2px ink rule and panels touch with no gutters.
 * Rows must fill all 12 columns on desktop, or the ink shows through as a black block.
 */

export interface BoardProps {
  children: ReactNode;
  className?: string;
  /** Rendered element (default div). */
  as?: "div" | "section";
  "aria-label"?: string;
}

/** 1 column on phones, 12 from md up. Centered at 1440 with side rules beyond that. */
export function Board({ children, className, as: As = "div", ...rest }: BoardProps) {
  return (
    <As
      aria-label={rest["aria-label"]}
      className={cx(
        "mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-[2px] border-y-2 border-ink bg-ink md:grid-cols-12 min-[1444px]:border-x-2",
        className,
      )}
    >
      {children}
    </As>
  );
}

export type PanelSpan = 12 | 9 | 8 | 7 | 6 | 5 | 4 | 3;

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

const MD_SPAN: Record<12 | 6, string> = { 12: "md:col-span-12", 6: "md:col-span-6" };

export interface PanelProps {
  children: ReactNode;
  /** Header bar label. Omit for an unlabeled tile. */
  label?: ReactNode;
  /** Right side of the header bar. */
  labelRight?: ReactNode;
  /** Blinking red square in the header bar. */
  live?: boolean;
  /** Columns on desktop (lg, 12-column grid). Default 12. */
  span?: PanelSpan;
  /** Columns from md to lg. Default 12 (full width on tablets). */
  mdSpan?: 12 | 6;
  /** Heading level of the label (default 2). */
  headingLevel?: 2 | 3;
  /** Anchor id for the panel. Also used to label the section. */
  id?: string;
  /** Inner padding (default true). Set false for flush tables and ribbons. */
  pad?: boolean;
  /** The active or selected panel: hard 4px offset shadow. */
  active?: boolean;
  as?: "section" | "div" | "article" | "aside";
  className?: string;
  bodyClassName?: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A ruled paper panel with a black header bar. Put it inside a Board. */
export function Panel({
  children,
  label,
  labelRight,
  live,
  span = 12,
  mdSpan = 12,
  headingLevel = 2,
  id,
  pad = true,
  active = false,
  as: As = "section",
  className,
  bodyClassName,
}: PanelProps) {
  const headingId = label ? `${id ?? (typeof label === "string" ? `panel-${slug(label)}` : "panel")}-label` : undefined;
  return (
    <As
      id={id}
      aria-labelledby={headingId}
      className={cx(
        "flex min-w-0 flex-col bg-paper",
        MD_SPAN[mdSpan],
        LG_SPAN[span],
        active && "relative z-10 shadow-hard",
        className,
      )}
    >
      {label ? <HeaderBar id={headingId} as={headingLevel === 3 ? "h3" : "h2"} label={label} right={labelRight} live={live} /> : null}
      <div className={cx("flex min-w-0 flex-1 flex-col", pad && "px-4 pb-5 pt-6 md:px-6 md:pb-6 md:pt-8", bodyClassName)}>{children}</div>
    </As>
  );
}
