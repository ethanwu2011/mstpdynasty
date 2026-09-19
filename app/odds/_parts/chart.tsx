/**
 * Odds over time as small multiples: one board per team, one dot column per week, twenty dots
 * tall (5% each). Lit dots are the odds; the top dot of a column shrinks for a partial step,
 * halftone style, so the height stays honest to the tenth. Unlit bulbs mark weeks still to come.
 */
import Link from "next/link";
import type { CSSProperties } from "react";
import { cx } from "@/components/cx";
import { Numeral } from "@/components/Numeral";
import { TeamSub } from "@/components/TeamSub";
import type { RosterId } from "@/lib/types";

export type OddsMetric = "playoff" | "title" | "last";

export const METRICS: Record<OddsMetric, { label: string; long: string }> = {
  playoff: { label: "Playoffs", long: "playoff odds" },
  title: { label: "Title", long: "title odds" },
  last: { label: "Last place", long: "last-place odds" },
};

export interface OddsSeries {
  rosterId: RosterId;
  name: string;
  teamName: string;
  /** week -> percent (0..100) */
  values: Map<number, number>;
}

const ROWS = 20;
const CELL = 8;
const DOT = 6;

export function weekLabel(week: number, preWeek: number): string {
  return week <= preWeek ? "Pre" : `W${week}`;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  if (v < 0.1) return "<0.1";
  if (v > 99.9 && v < 100) return ">99.9";
  return v.toFixed(1);
}

function Columns({ weeks, values, label }: { weeks: number[]; values: Map<number, number>; label: string }) {
  const w = weeks.length * CELL - (CELL - DOT);
  const h = ROWS * CELL - (CELL - DOT);
  let unlit = "";
  let lit = "";
  weeks.forEach((week, x) => {
    const v = values.get(week);
    const steps = v === undefined ? 0 : (Math.min(100, Math.max(0, v)) / 100) * ROWS;
    const full = Math.floor(steps + 1e-9);
    const part = steps - full;
    for (let r = 0; r < ROWS; r++) {
      const px = x * CELL;
      const py = (ROWS - 1 - r) * CELL;
      if (r < full) lit += `M${px} ${py}h${DOT}v${DOT}h-${DOT}z`;
      else if (r === full && part > 0.04) {
        // Area-true partial dot, centered in its cell, over an unlit bulb.
        const s = Math.max(1, Math.round(Math.sqrt(part) * DOT));
        const o = (DOT - s) / 2;
        unlit += `M${px} ${py}h${DOT}v${DOT}h-${DOT}z`;
        lit += `M${px + o} ${py + o}h${s}v${s}h-${s}z`;
      } else unlit += `M${px} ${py}h${DOT}v${DOT}h-${DOT}z`;
    }
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      shapeRendering="crispEdges"
      className="block h-auto max-w-full"
    >
      <path d={unlit} className="fill-paper-shade" />
      <path d={lit} className="fill-ink" />
    </svg>
  );
}

function Tile({ s, weeks, preWeek, metric, rank }: { s: OddsSeries; weeks: number[]; preWeek: number; metric: OddsMetric; rank: number }) {
  const known = weeks.filter((w) => s.values.has(w));
  const latestWeek = known[known.length - 1];
  const latest = latestWeek === undefined ? null : s.values.get(latestWeek)!;
  const prevWeek = known[known.length - 2];
  const prev = prevWeek === undefined ? null : s.values.get(prevWeek)!;
  const delta = latest !== null && prev !== null ? latest - prev : null;
  const described = known.map((w) => `${weekLabel(w, preWeek) === "Pre" ? "preseason" : `week ${w}`} ${fmt(s.values.get(w)!)}%`).join(", ");
  const label = known.length ? `${s.name} ${METRICS[metric].long} by week: ${described}.` : `${s.name}: no ${METRICS[metric].long} yet.`;
  return (
    <li className="flex min-w-0 flex-col gap-3 bg-paper px-3 pb-4 pt-3.5 md:px-4">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          {latest !== null ? (
            <span aria-hidden className="type-label text-ink-muted">
              {String(rank).padStart(2, "0")}
            </span>
          ) : null}
          <span className="truncate font-bold leading-tight">{s.name}</span>
        </span>
        <TeamSub team={s.teamName} manager={s.name} className="truncate text-fine text-ink-muted" />
      </div>
      {latest === null ? null : (
        <div className="flex items-baseline justify-between gap-2">
          <Numeral value={fmt(latest)} size="d30" label={`${fmt(latest)} percent`} />
          {delta !== null ? (
            <span className="type-data whitespace-nowrap text-fine">
              <span className="font-bold">
                {delta > 0.05 ? "+" : delta < -0.05 ? "-" : ""}
                {Math.abs(delta).toFixed(1)}
              </span>
              <span className="text-ink-muted"> since {weekLabel(prevWeek!, preWeek)}</span>
            </span>
          ) : null}
        </div>
      )}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className="type-label flex flex-col justify-between text-right leading-none text-ink-muted">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <Columns weeks={weeks} values={s.values} label={label} />
        <span aria-hidden />
        <div aria-hidden className="type-label mt-2 flex justify-between leading-none text-ink-muted" style={{ maxWidth: weeks.length * CELL - (CELL - DOT) }}>
          <span>{weekLabel(weeks[0], preWeek)}</span>
          <span>{weekLabel(weeks[weeks.length - 1], preWeek)}</span>
        </div>
      </div>
    </li>
  );
}

export interface OddsChartProps {
  series: OddsSeries[];
  /** Every week on the x axis, oldest first (future weeks show as unlit bulbs). */
  weeks: number[];
  /** Snapshots at or before this week are preseason. */
  preWeek: number;
  metric: OddsMetric;
}

export function MetricSwitch({ metric, hrefFor }: { metric: OddsMetric; hrefFor: (m: OddsMetric) => string }) {
  return (
    <nav aria-label="Which odds to show" className="flex flex-wrap gap-2">
      {(Object.keys(METRICS) as OddsMetric[]).map((m) => {
        const on = m === metric;
        return (
          <Link
            key={m}
            href={hrefFor(m)}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={cx(
              "type-label pressable inline-flex min-h-11 items-center border-2 border-ink px-3 py-2 no-underline",
              on ? "bg-ink text-paper" : "bg-paper text-ink",
            )}
          >
            {METRICS[m].label}
          </Link>
        );
      })}
    </nav>
  );
}

export function OddsChart({ series, weeks, preWeek, metric }: OddsChartProps) {
  const sorted = [...series].sort((a, b) => {
    const la = [...a.values.entries()].sort((x, y) => x[0] - y[0]).at(-1)?.[1] ?? -1;
    const lb = [...b.values.entries()].sort((x, y) => x[0] - y[0]).at(-1)?.[1] ?? -1;
    // As shown (one decimal) first, so two boards that read the same are ordered by name.
    return Math.round(lb * 10) - Math.round(la * 10) || lb - la || a.name.localeCompare(b.name);
  });
  const n = sorted.length;
  const cols = n <= 6 ? Math.max(1, n) : n % 5 === 0 ? 5 : n % 6 === 0 ? 6 : n % 4 === 0 ? 4 : 5;
  return (
    <ol
      className="m-0 grid list-none grid-cols-2 gap-px bg-ink p-0 max-md:[&>li:last-child:nth-child(odd)]:col-span-2 md:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
      style={{ "--cols": cols } as CSSProperties}
    >
      {sorted.map((s, i) => (
        <Tile key={s.rosterId} s={s} weeks={weeks} preWeek={preWeek} metric={metric} rank={i + 1} />
      ))}
    </ol>
  );
}
