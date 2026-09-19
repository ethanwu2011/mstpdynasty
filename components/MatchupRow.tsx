import Link from "next/link";
import type { WinProb, WinProbWeek } from "@/lib/types";
import { cx } from "./cx";
import { Numeral } from "./Numeral";
import { RowLine } from "./RowLine";
import { Tag } from "./Tag";
import { WinDots } from "./WinDots";
import { teamSubtitle } from "@/lib/names";

export type MatchupStatus = "pre" | "live" | "final";

export interface MatchupSide {
  /** Big line: the manager's first name. */
  name: string;
  /** Small line under it: the team name. */
  detail?: string;
  /** Points scored so far (null before kickoff). */
  score: number | null;
  /** Projected or expected final points. */
  projected?: number | null;
  /** 0..1 */
  winProb: number;
}

export interface MatchupRowProps {
  a: MatchupSide;
  b: MatchupSide;
  status: MatchupStatus;
  /** Small caption at the top left, e.g. "Matchup 3". */
  label?: string;
  /** Makes the whole row a link (e.g. to /scores/9#m3). */
  href?: string;
  /** Light the win dots on first paint. */
  animate?: boolean;
  /** The matchup's one-liner, when there is one. */
  line?: string | null;
  className?: string;
}

/** Map a model WinProb onto MatchupRow props. `basis` comes from the WinProbWeek. */
export function matchupFromWinProb(wp: WinProb, basis: WinProbWeek["basis"]): Pick<MatchupRowProps, "a" | "b" | "status" | "label"> {
  const status: MatchupStatus = wp.isFinal || basis === "final" ? "final" : basis === "live" ? "live" : "pre";
  const side = (t: WinProb["home"]): MatchupSide => ({
    name: t.team.managerName,
    detail: teamSubtitle(t.team.teamName, t.team.managerName) ?? undefined,
    score: status === "pre" ? null : t.actual,
    projected: status === "final" ? null : t.mean,
    winProb: t.winProb,
  });
  return { a: side(wp.home), b: side(wp.away), status, label: `Matchup ${wp.matchupId}` };
}

function SideLine({ side, status, isWinner, isLoser }: { side: MatchupSide; status: MatchupStatus; isWinner: boolean; isLoser: boolean }) {
  const showProjected = status === "pre";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
      <div className="min-w-0">
        <p className={cx("m-0 truncate text-[1.0625rem] leading-tight", isWinner ? "font-extrabold" : isLoser ? "font-medium text-ink-muted" : "font-semibold")}>
          {side.name}
        </p>
        {side.detail ? <p className="m-0 truncate text-fine text-ink-muted">{side.detail}</p> : null}
      </div>
      <div className="flex items-baseline gap-2">
        {status === "live" && side.projected != null ? (
          <span className="text-fine text-ink-muted" title="Expected final score">
            Proj {side.projected.toFixed(1)}
          </span>
        ) : null}
        <Numeral
          size="d30"
          decimals={showProjected ? 1 : 2}
          value={showProjected ? (side.projected ?? null) : side.score}
          tone={showProjected ? "muted" : "ink"}
          label={showProjected ? `projected ${side.projected?.toFixed(1) ?? "unknown"} points` : `${side.score ?? 0} points`}
        />
      </div>
    </div>
  );
}

/**
 * Two team lines with Doto scores and a 20-dot win-probability row. LIVE games carry a slow
 * red blink; FINAL games set the winner in bold. Before kickoff the scores are projections.
 */
export function MatchupRow({ a, b, status, label, href, animate = false, line, className }: MatchupRowProps) {
  const final = status === "final";
  const aWins = final && (a.score ?? 0) > (b.score ?? 0);
  const bWins = final && (b.score ?? 0) > (a.score ?? 0);
  const aPct = Math.round(Math.min(1, Math.max(0, a.winProb)) * 100);
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="type-label text-ink-muted">{label}</span>
        {status === "live" ? (
          <Tag square="blink">Live</Tag>
        ) : final ? (
          <Tag>Final</Tag>
        ) : (
          <Tag tone="outline">Proj</Tag>
        )}
      </div>
      <SideLine side={a} status={status} isWinner={aWins} isLoser={bWins} />
      <SideLine side={b} status={status} isWinner={bWins} isLoser={aWins} />
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2 pt-1">
        <Numeral size="d20" value={aPct} className="text-left" label={`${a.name} ${aPct} percent`} />
        <WinDots aProb={a.winProb} aName={a.name} bName={b.name} isFinal={final} animate={animate} />
        <Numeral size="d20" value={100 - aPct} className="text-right" label={`${b.name} ${100 - aPct} percent`} />
      </div>
      <RowLine text={line} className="pt-1" />
    </>
  );
  const cls = cx("grid gap-2 py-3.5", className);
  if (href) {
    return (
      <Link href={href} aria-label={`${a.name} versus ${b.name}`} className={cx(cls, "-mx-4 px-4 no-underline hover:bg-paper-shade md:-mx-6 md:px-6")}>
        {body}
      </Link>
    );
  }
  return (
    <article aria-label={`${a.name} versus ${b.name}`} className={cls}>
      {body}
    </article>
  );
}
