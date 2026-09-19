import Link from "next/link";
import type { ReactNode } from "react";
import { formatEt } from "@/lib/time";
import { cx } from "./cx";
import { LiveSquare } from "./Tag";

export interface RoastReceiptItem {
  /** Silkscreen caption: "Pick", "FC rank", "Bench left". */
  label: string;
  value: ReactNode;
}

/** Everything a roast needs, independent of where it is shown. */
export interface RoastBlockData {
  /** Small line over the headline: "Trade · Week 9", "Pick 4.07". */
  kicker?: string;
  /** Who got roasted: a manager's first name, or an issue title. */
  victim: string;
  /** The number that earned it, in pixel caps: "-1,800 value", "$0 bid". */
  stat?: string | null;
  /** Optional larger grotesk line under the headline (an issue dek). */
  lede?: string | null;
  /** The roast itself, plain text. Blank lines split paragraphs. */
  text: string;
  /** The proof: a short box-score line of the facts behind the joke. */
  receipt?: RoastReceiptItem[];
  /** When it happened (epoch ms). */
  at?: number | null;
  /** Permalink to where this roast lives. */
  href?: string | null;
  /** Byline in the footer (default "The Roast"). */
  byline?: string;
  /** Tags beside the kicker: FACTS ONLY, SAMPLE DATA. */
  tags?: ReactNode;
}

export interface RoastBlockProps extends RoastBlockData {
  /** hero = the home lead (up to 5px-pixel Jersey); compact = lists of roasts. */
  size?: "hero" | "compact";
  /** Light the headline in pixel steps on first paint. */
  animate?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/** The proof line: a ruled box score of labeled facts (2 across on phones, one row from sm). */
export function Receipt({ items, className }: { items: RoastReceiptItem[]; className?: string }) {
  return (
    <dl className={cx("m-0 grid grid-cols-2 border-y-2 border-ink sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none", className)}>
      {items.map((r, i) => (
        <div
          key={r.label}
          className={cx(
            "flex min-w-0 flex-col gap-1 px-3 py-2.5",
            i % 2 === 1 && "border-l border-ink",
            i >= 2 && "border-t border-ink sm:border-t-0",
            i > 0 && "sm:border-l",
          )}
        >
          <dt className="type-label text-ink-muted">{r.label}</dt>
          <dd className="m-0 truncate type-data text-[1.0625rem] font-semibold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function stamp(ms: number): string {
  const day = formatEt(ms, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = formatEt(ms, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ET`;
}

/**
 * A roast: the victim and the stat shouted in Jersey 10, the roast in grotesk under it, the
 * receipt that proves it, and a footer with the red square, the time and a permalink.
 */
export function RoastBlock({
  kicker,
  victim,
  stat,
  lede,
  text,
  receipt,
  at,
  href,
  byline = "The Roast",
  tags,
  size = "hero",
  animate = false,
  headingLevel = 2,
  className,
}: RoastBlockProps) {
  const hero = size === "hero";
  const H = headingLevel === 3 ? "h3" : "h2";
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className={cx("flex w-full min-w-0 flex-col", hero ? "gap-6 md:gap-7" : "gap-4", className)}>
      {kicker || tags ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {kicker ? <p className="type-label m-0 text-ink">{kicker}</p> : null}
          {tags}
        </div>
      ) : null}

      <H className={cx("type-display m-0 break-words", hero ? "text-j3 md:text-j4 xl:text-j5" : "text-j2 md:text-j3")}>
        <span className={cx("block", animate && "board-wipe")}>
          {victim}
        </span>
        {stat ? (
          <>
            <span className="sr-only">: </span>
            <span className={cx("block", animate && "board-wipe")}>
              {stat}
            </span>
          </>
        ) : null}
      </H>

      {lede ? <p className={cx("m-0 measure font-semibold", hero ? "text-lede" : "text-body")}>{lede}</p> : null}

      {paragraphs.length ? (
        <div className={cx("measure flex flex-col gap-3 text-body", hero && "md:text-lede")}>
          {paragraphs.map((p, i) => (
            <p key={i} className="m-0">
              {p}
            </p>
          ))}
        </div>
      ) : null}

      {receipt?.length ? <Receipt items={receipt} /> : null}

      <footer className={cx("type-label flex flex-wrap items-center gap-x-3 gap-y-2", hero && "pt-1")}>
        <LiveSquare size={12} />
        {at ? <time dateTime={new Date(at).toISOString()}>{stamp(at)}</time> : null}
        <span className="text-ink-muted">By {byline}</span>
        {href ? (
          <Link href={href} className="link-ink ml-auto px-0.5">
            Permalink
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
