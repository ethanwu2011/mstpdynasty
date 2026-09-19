import Link from "next/link";
import { cx } from "@/components/cx";

export interface WeekRailProps {
  /** First week the league plays. */
  startWeek: number;
  playoffWeekStart: number;
  lastWeek: number;
  /** The week this page shows. */
  selected: number;
  /** The league's current week (0 when none). */
  current: number;
  /** Weeks after this one have not been played yet (dimmed). */
  playedThrough: number;
  /** The current week has games in progress: its marker blinks red. */
  live?: boolean;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function Cell({ week, selected, current, future, live }: { week: number; selected: boolean; current: boolean; future: boolean; live: boolean }) {
  return (
    <li className="flex">
      <Link
        href={`/scores/${week}`}
        aria-current={selected ? "page" : undefined}
        aria-label={`Week ${week}${current ? ", this week" : ""}`}
        className={cx(
          "pressable relative flex size-11 items-center justify-center border-2 border-ink no-underline",
          selected ? "bg-ink text-paper" : future ? "bg-paper text-ink-muted hover:text-ink" : "bg-paper text-ink",
        )}
      >
        <span aria-hidden className="text-[1.0625rem] font-extrabold tnum">
          {week}
        </span>
        {current ? (
          <span
            aria-hidden
            className={cx("absolute right-[3px] top-[3px] size-1.5", live ? "live-blink bg-red" : selected ? "bg-paper" : "bg-ink")}
          />
        ) : null}
      </Link>
    </li>
  );
}

function Group({ label, weeks, props }: { label: string; weeks: number[]; props: WeekRailProps }) {
  if (!weeks.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="type-label text-ink-muted">{label}</span>
      <ol className="m-0 flex list-none flex-wrap gap-[2px] p-0">
        {weeks.map((w) => (
          <Cell
            key={w}
            week={w}
            selected={w === props.selected}
            current={w === props.current}
            future={w > props.playedThrough}
            live={Boolean(props.live) && w === props.current}
          />
        ))}
      </ol>
    </div>
  );
}

/** Every week of the season as a row of square pixel keys. The page's week is lit. */
export function WeekRail(props: WeekRailProps) {
  const { startWeek, playoffWeekStart, lastWeek } = props;
  const regular = range(startWeek, Math.min(playoffWeekStart - 1, lastWeek));
  const playoffs = range(Math.max(playoffWeekStart, startWeek), lastWeek);
  return (
    <nav aria-label="Weeks" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <Group label="Regular season" weeks={regular} props={props} />
        <Group label="Playoffs" weeks={playoffs} props={props} />
      </div>
      {props.current >= startWeek && props.current <= lastWeek ? (
        <p className="type-label m-0 flex items-center gap-2 text-ink-muted">
          <span aria-hidden className={cx("inline-block size-1.5", props.live ? "bg-red" : "bg-ink")} />
          Week {props.current} is this week
        </p>
      ) : null}
    </nav>
  );
}
