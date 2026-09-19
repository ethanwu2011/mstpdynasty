import { cx } from "./cx";

/** A row's one-liner from a surface line map, or null when there is none (no key, no line yet). */
export function lineOf(lines: Record<string, string | null | undefined> | null | undefined, id: string | number): string | null {
  const v = lines?.[String(id)];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const SIZE = {
  row: "text-row font-medium leading-snug",
  body: "text-body font-medium leading-snug md:text-lede",
  lede: "text-lede font-semibold leading-snug",
} as const;

/**
 * The one mean line under a stat row (a standings row, an odds row, a matchup, a pick). Stated
 * flat in the grotesk with no label or badge: it reads as the row's caption. Renders nothing
 * when there is no line, so a row never shows a placeholder joke. 16px or more on a phone.
 */
export function RowLine({
  text,
  className,
  size = "row",
  as: As = "p",
}: {
  text: string | null | undefined;
  className?: string;
  /** row = under a table row (16px); body = under a matchup; lede = under a big headline. */
  size?: keyof typeof SIZE;
  as?: "p" | "span";
}) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return null;
  return <As className={cx("m-0 block max-w-[68ch] text-ink", SIZE[size], className)}>{t}</As>;
}
