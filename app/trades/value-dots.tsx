/**
 * A trade's value over time as a dot chart: one column per stored FantasyCalc day, lit dots from
 * the zero line up (the side is ahead) or down (it is behind), on the board's own dot grid.
 * Unlit bulbs fill the rest of the column. Only today's column turns red, and only when the side
 * is behind: the alarm stays small. Every value is a point from the hindsight series as given;
 * nothing is interpolated between stored days.
 */
import { cx } from "@/components/cx";
import { formatEt } from "@/lib/time";
import type { TradeValuePoint } from "@/lib/types";
import { fmtSigned } from "../_lib/format";

const HALF = 5;
const CELL = 8;
const DOT = 6;

const dayLabel = (date: string) => formatEt(Date.parse(`${date}T12:00:00Z`), { month: "short", day: "numeric" });

export function ValueDots({ series, name, className }: { series: TradeValuePoint[]; name: string; className?: string }) {
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((p) => Math.abs(p.net)));
  const w = series.length * CELL - (CELL - DOT);
  const h = (HALF * 2 + 1) * CELL - (CELL - DOT);
  const zeroY = HALF * CELL;
  let unlit = "";
  let lit = "";
  let alarm = "";
  series.forEach((p, x) => {
    const today = x === series.length - 1;
    const n = p.net === 0 ? 0 : Math.max(1, Math.round((Math.abs(p.net) / max) * HALF));
    const px = x * CELL;
    for (let r = 1; r <= HALF; r++) {
      const above = zeroY - r * CELL;
      const below = zeroY + r * CELL;
      const cellUp = `M${px} ${above}h${DOT}v${DOT}h-${DOT}z`;
      const cellDown = `M${px} ${below}h${DOT}v${DOT}h-${DOT}z`;
      if (p.net > 0 && r <= n) lit += cellUp;
      else unlit += cellUp;
      if (p.net < 0 && r <= n) {
        if (today) alarm += cellDown;
        else lit += cellDown;
      } else unlit += cellDown;
    }
  });
  const first = series[0];
  const last = series[series.length - 1];
  // The series is sampled (at most 40 points) and skips days nobody stored, so count days by date.
  const days = Math.round((Date.parse(`${last.date}T12:00:00Z`) - Date.parse(`${first.date}T12:00:00Z`)) / 86_400_000);
  const label =
    series.length === 1
      ? `${name}'s net value on ${dayLabel(last.date)}: ${fmtSigned(last.net)}.`
      : `${name}'s net value from ${dayLabel(first.date)} to ${dayLabel(last.date)}: ${fmtSigned(first.net)} to ${fmtSigned(last.net)}, over ${days} ${days === 1 ? "day" : "days"}.`;
  return (
    <figure className={cx("m-0 flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-end gap-3">
        <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} width={w} height={h} shapeRendering="crispEdges" className="block h-auto max-w-full shrink-0">
          <path d={unlit} className="fill-paper-shade" />
          <rect x={0} y={zeroY} width={w} height={DOT} className="fill-ink" />
          <path d={lit} className="fill-ink" />
          <path d={alarm} className="fill-red" />
        </svg>
        <span aria-hidden className="type-label flex flex-col justify-between self-stretch text-ink-muted">
          <span>Ahead</span>
          <span>Behind</span>
        </span>
      </div>
      <figcaption className="type-label flex justify-between gap-3 whitespace-nowrap text-ink-muted" style={{ width: Math.max(w, 160) }}>
        <span>{dayLabel(first.date)}</span>
        {series.length > 1 ? <span>{dayLabel(last.date)}</span> : null}
      </figcaption>
    </figure>
  );
}
