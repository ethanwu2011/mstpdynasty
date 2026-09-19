/** The standings table with the playoff line drawn across it. */
import { cx } from "@/components/cx";
import { Numeral } from "@/components/Numeral";
import { LiveSquare, Tag } from "@/components/Tag";
import type { PowerRow, RosterId, StandingRow } from "@/lib/types";
import { fmtPts, record } from "../../_lib/format";

export interface StandingsTableProps {
  rows: StandingRow[];
  /** Power rows by roster id, for the all-play record and luck. */
  power: Map<RosterId, PowerRow>;
  /** Any games played yet. Before that there are no ranks, no line, no luck. */
  played: boolean;
  playoffTeams: number;
  byes: number;
  championId: RosterId | null;
}

/** "52-28", or "52.5-27.5" when ties split a win. */
function allPlay(w: number, l: number): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${f(w)}-${f(l)}`;
}

function signed(n: number, decimals = 1): string {
  const r = Number(n.toFixed(decimals));
  if (r === 0) return (0).toFixed(decimals);
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(decimals)}`;
}

const HEAD = "type-label whitespace-nowrap px-3 py-2.5 font-normal";

export function StandingsTable({ rows, power, played, playoffTeams, byes, championId }: StandingsTableProps) {
  const lastId = played && rows.length ? rows[rows.length - 1].team.rosterId : null;
  const lineAfter = played && playoffTeams > 0 && playoffTeams < rows.length ? playoffTeams : -1;
  const luckValues = played ? rows.map((r) => power.get(r.team.rosterId)?.luck).filter((x): x is number => typeof x === "number") : [];
  const maxLuck = luckValues.length ? Math.max(...luckValues) : null;
  const minLuck = luckValues.length ? Math.min(...luckValues) : null;
  const COLS = 7;

  return (
    <div role="region" aria-label="Standings" tabIndex={0} className="w-full overflow-x-auto overscroll-x-contain">
      <table className="type-data w-full min-w-[680px] border-collapse">
        <caption className="sr-only">
          Standings{played && lineAfter > 0 ? `. The top ${playoffTeams} make the playoffs.` : ""}
        </caption>
        <thead>
          <tr className="bg-ink text-paper">
            <th scope="col" className={cx(HEAD, "sticky left-0 z-[2] bg-ink text-left")}>
              Team
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              W-L{rows.some((r) => r.ties) ? "-T" : ""}
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              PF
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              PA
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              All-play
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              Luck
            </th>
            <th scope="col" className={cx(HEAD, "text-right")}>
              Streak
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = power.get(r.team.rosterId);
            const leader = played && i === 0;
            const last = r.team.rosterId === lastId;
            const champ = r.team.rosterId === championId;
            const inBye = played && byes > 0 && i < byes && lineAfter > 0;
            return [
              i === lineAfter ? (
                <tr key={`line-${i}`} aria-hidden className="bg-paper">
                  <td colSpan={COLS} className="p-0">
                    <div className="flex items-center">
                      <span className="type-label sticky left-0 z-[1] shrink-0 bg-ink px-3 py-1 text-paper">Playoff line</span>
                      <span className="h-1 flex-1 bg-ink" />
                    </div>
                  </td>
                </tr>
              ) : null,
              <tr key={r.team.rosterId} className={cx(i % 2 ? "bg-paper-shade" : "bg-paper", leader && "font-bold")}>
                <th
                  scope="row"
                  className="sticky left-0 z-[1] whitespace-nowrap bg-inherit px-3 py-3 text-left font-[inherit] shadow-[inset_-1px_0_0_var(--color-ink)]"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-8 shrink-0">
                      {played ? <Numeral value={r.rank} pad={2} size="d20" tone={leader ? "ink" : "muted"} label={`Rank ${r.rank}`} /> : <span className="text-ink-muted">--</span>}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        {last ? (
                          <>
                            <LiveSquare size={10} />
                            <span className="sr-only">Last place: </span>
                          </>
                        ) : null}
                        <span className={cx("text-body leading-tight", leader || champ ? "font-extrabold" : "font-semibold")}>{r.team.managerName}</span>
                        {champ ? <Tag>Champion</Tag> : null}
                        {inBye && !championId ? <Tag tone="outline">Bye spot</Tag> : null}
                      </span>
                      <span className="max-w-[12rem] truncate text-fine font-normal text-ink-muted">{r.team.teamName}</span>
                    </span>
                  </span>
                </th>
                <td className="whitespace-nowrap px-3 py-3 text-right font-bold">{record(r.wins, r.losses, r.ties)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{played ? fmtPts(r.pointsFor) : "--"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-ink-muted">{played ? fmtPts(r.pointsAgainst) : "--"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{played && p ? allPlay(p.allPlayWins, p.allPlayLosses) : "--"}</td>
                <td
                  className={cx(
                    "whitespace-nowrap px-3 py-3 text-right",
                    played && p && (p.luck === maxLuck || p.luck === minLuck) && p.luck !== 0 && "font-extrabold",
                  )}
                >
                  {played && p ? signed(p.luck) : "--"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{played && r.streak ? r.streak : "--"}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
