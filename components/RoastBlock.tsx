import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { formatEt } from "@/lib/time";
import { cx } from "./cx";
import { LiveSquare } from "./Tag";

export interface RoastReceiptItem {
  /** Silkscreen caption: "Pick", "FC rank", "Bench left". */
  label: string;
  value: ReactNode;
  /** A long value (a player's name, a list of names): two columns wide, so it never gets cut. */
  wide?: boolean;
}

/** Everything a roast needs, independent of where it is shown. */
export interface RoastBlockData {
  /**
   * The event, named plainly: "Pick 3.07", "Trade, Sep 21", "Week 5 final". It labels the
   * panel when the block leads one, and is the first line of the kicker in a list.
   */
  event?: string;
  /** Small line over the headline with anything the event does not say: "Round 3", "Week 9". */
  kicker?: string;
  /** Who it is about: a manager's first name, or an issue title. */
  victim: string;
  /** The number that earned it, in pixel caps: "-1,800 value", "$0 bid". */
  stat?: string | null;
  /** Optional larger grotesk line under the headline (an issue dek). */
  lede?: string | null;
  /** The text itself, plain. Blank lines split paragraphs. */
  text: string;
  /** The proof: a short box-score line of the facts behind the joke. */
  receipt?: RoastReceiptItem[];
  /** When it happened (epoch ms). */
  at?: number | null;
  /** Link to where this lives. */
  href?: string | null;
  /** Markers beside the kicker. Only SAMPLE DATA in practice: a line never announces itself. */
  tags?: ReactNode;
}

export interface RoastBlockProps extends RoastBlockData {
  /** hero = the home lead (up to 5px-pixel Jersey); compact = lists. */
  size?: "hero" | "compact";
  /** The event already labels the panel above: leave it out of the kicker. */
  eventInPanel?: boolean;
  /** Light the headline in pixel steps on first paint. */
  animate?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * The proof line: a ruled box score of labeled facts. Sized by its own width, not the screen's:
 * one row when the block is 520px or wider, two across below that (a phone, a narrow column).
 * Values wrap instead of being cut, and a wide item (a player's name) takes two columns. Wide
 * items go first so the two-across grid never leaves a hole, and an odd last item spans the row.
 */
export function Receipt({ items, className }: { items: RoastReceiptItem[]; className?: string }) {
  const ordered = [...items.filter((r) => r.wide), ...items.filter((r) => !r.wide)];
  const narrowCount = ordered.filter((r) => !r.wide).length;
  const cols = ordered.reduce((n, r) => n + (r.wide ? 2 : 1), 0);
  return (
    <div className={cx("@container", className)}>
      <dl
        className="m-0 grid grid-cols-2 gap-px border-y-2 border-ink bg-ink @min-[32.5rem]:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
        style={{ "--cols": cols } as CSSProperties}
      >
        {ordered.map((r, i) => (
          <div
            key={r.label}
            className={cx(
              "flex min-w-0 flex-col gap-1 bg-paper px-3 py-2.5",
              r.wide && "col-span-2",
              !r.wide && narrowCount % 2 === 1 && i === ordered.length - 1 && "col-span-2 @min-[32.5rem]:col-span-1",
            )}
          >
            <dt className="type-label text-ink-muted">{r.label}</dt>
            <dd className="m-0 type-data text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function stamp(ms: number): string {
  const day = formatEt(ms, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = formatEt(ms, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ET`;
}

/*
 * Headline steps that fit a 375px phone without a word stranded on its own line. Jersey 10 runs
 * about 0.37em a character, so j3 (56px) holds 15 to 16 characters in a 343px column and j2
 * (37px) about 24. Each line takes its own step: the name stays loud even when the stat is long.
 */
function headlineSize(line: string, hero: boolean): string {
  const n = line.length;
  if (!hero) return n <= 24 ? "text-j2 md:text-j3" : "text-j2";
  if (n <= 15) return "text-j3 md:text-j4 xl:text-j5";
  if (n <= 24) return "text-j2 sm:text-j3 md:text-j4 xl:text-j5";
  return "text-j2 md:text-j3 xl:text-j4";
}

/**
 * The lead block: who and the number shouted in Jersey 10, the text in grotesk under it on plain
 * paper, the receipt that proves it, and a footer with the red square, the time and a link.
 */
export function RoastBlock({
  event,
  kicker,
  victim,
  stat,
  lede,
  text,
  receipt,
  at,
  href,
  tags,
  size = "hero",
  eventInPanel = false,
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
  const top = [eventInPanel ? null : event, kicker].filter(Boolean).join(" · ");

  return (
    <article className={cx("flex w-full min-w-0 flex-col", hero ? "gap-6 md:gap-7" : "gap-4", className)}>
      {top || tags ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {top ? <p className="type-label m-0 text-ink">{top}</p> : null}
          {tags}
        </div>
      ) : null}

      <H className="type-display m-0 break-words [text-wrap:balance]">
        <span className={cx("block", headlineSize(victim, hero), animate && "board-wipe")}>{victim}</span>
        {stat ? (
          <>
            <span className="sr-only">: </span>
            <span className={cx("block", headlineSize(stat, hero), animate && "board-wipe")}>{stat}</span>
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

      {at || href ? (
        <footer className={cx("type-label flex flex-wrap items-center gap-x-3 gap-y-2", hero && "pt-1")}>
          {at ? (
            <>
              <LiveSquare size={12} />
              <time dateTime={new Date(at).toISOString()}>{stamp(at)}</time>
            </>
          ) : null}
          {href ? (
            <Link href={href} className="link-ink hit-area ml-auto px-0.5">
              Link
            </Link>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
