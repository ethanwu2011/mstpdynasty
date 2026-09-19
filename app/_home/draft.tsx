/** Pre-draft and draft-day home panels. */
import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { cx } from "@/components/cx";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { BarLink } from "@/components/HeaderBar";
import { Numeral } from "@/components/Numeral";
import { Panel, type PanelSpan } from "@/components/Panel";
import { Receipt, RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import { managerFor } from "@/lib/league";
import type { DraftFacts, DraftPickFact, LeagueContext, Roast } from "@/lib/types";
import { clockLength, etStamp, ordinal, pickLabel } from "../_lib/format";
import { draftOrder, pickAt, slotPicks } from "../_lib/draft";
import { roastToBlock } from "../_lib/roast-view";

function orderLabel(ctx: LeagueContext): string {
  const d = ctx.draft;
  if (!d) return "";
  if (d.type !== "snake") return d.type === "linear" ? "Linear" : d.type;
  const r = d.settings.reversal_round ?? 0;
  return r > 0 ? `Snake · round ${r} flip` : "Snake";
}

/* ------------------------------ the countdown lead ------------------------------ */

/** The pre-draft lead: no roast yet, so the clock to pick 1.01 is the headline. */
export function DraftCountdownLead({ ctx, serverNow }: { ctx: LeagueContext; serverNow: number }) {
  const d = ctx.draft;
  const commish = ctx.managers.find((m) => m.isCommissioner)?.name ?? "the commissioner";
  const rounds = d?.settings.rounds ?? 0;
  const teams = d?.settings.teams ?? ctx.rosters.length;
  const clock = clockLength(d?.settings.pick_timer);
  const start = d?.start_time ?? null;
  const autostart = Boolean(d?.settings.autostart);

  return (
    <article className="flex flex-1 flex-col gap-6 md:gap-7">
      <p className="type-label m-0">
        Startup draft · {orderLabel(ctx) || "Order not set"} · {rounds} rounds
      </p>

      <h3 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
        <span className="board-wipe block">Pick 1.01 is up next</span>
      </h3>

      {start ? (
        <Countdown
          target={start}
          serverNow={serverNow}
          ghost
          digitClassName="text-d60 sm:text-d80 xl:text-d100"
          label={`Draft scheduled for ${etStamp(start)}`}
          expired={
            <div className="flex flex-col gap-3">
              <Numeral value="00:00:00" ghost label="Zero" className="text-d60 sm:text-d80 xl:text-d100" />
              <p className="type-label m-0 flex items-center gap-2">
                <LiveSquare blink size={10} />
                {autostart ? "Starting any second" : `Past the scheduled start. The draft opens when ${commish} hits start.`}
              </p>
            </div>
          }
        />
      ) : (
        <DotMatrixFill label="Sleeper has no start time for the draft yet." rows={5} />
      )}

      <p className="measure m-0 text-body md:text-lede">
        Every pick is checked against FantasyCalc&apos;s dynasty rankings the moment it lands. Reaches get called out by name, steals get
        noticed, and nobody gets through {rounds * teams || "all the"} picks clean. Draft Grades goes out when the board is full.
      </p>

      <Receipt
        items={[
          { label: "Rounds", value: rounds || "--" },
          { label: "Picks", value: rounds * teams || "--" },
          { label: "Pick clock", value: clock ?? "None" },
          { label: "Teams", value: teams },
        ]}
      />

      <footer className="type-label mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <LiveSquare size={12} />
        {start ? <time dateTime={new Date(start).toISOString()}>{etStamp(start)}</time> : <span>Start time not set</span>}
        <span className="text-ink-muted">MSTP Dynasty</span>
        <Link href="/draft" className="link-ink ml-auto px-0.5">
          Draft board
        </Link>
      </footer>
    </article>
  );
}

/* ------------------------------ draft order ------------------------------ */

export function DraftOrderPanel({ ctx, span = 4 }: { ctx: LeagueContext; span?: PanelSpan }) {
  const d = ctx.draft;
  const order = d ? draftOrder(d) : [];
  return (
    <Panel label="Draft order" labelRight={<span className="text-paper-shade">{orderLabel(ctx)}</span>} span={span} bodyClassName="px-4 pb-4 pt-2 md:px-6" pad={false}>
      {d && order.length ? (
        <ol className="m-0 list-none divide-y divide-ink p-0">
          {order.map(({ slot, rosterId }) => {
            const m = managerFor(ctx, rosterId);
            const picks = slotPicks(d, slot, 3);
            return (
              <li key={slot} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                <Numeral value={slot} pad={2} size="d30" label={`Slot ${slot}`} />
                <div className="min-w-0">
                  <p className="m-0 truncate font-bold leading-tight">{m.name}</p>
                  <p className="m-0 truncate text-fine text-ink-muted">{m.username ?? m.teamName}</p>
                </div>
                <p className="type-data m-0 flex gap-x-2.5 text-fine text-ink-muted" aria-label={`First picks ${picks.map((p) => p.label).join(", ")}`}>
                  {picks.map((p) => (
                    <span key={p.label} className={p.round === 1 ? "font-bold text-ink" : undefined}>
                      {p.label}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="py-4">
          <DotMatrixFill label="Sleeper has not set the draft order yet." rows={5} />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ the league box score ------------------------------ */

const SCORING_LINES: Array<{ key: string; label: string; show: (v: number) => string }> = [
  { key: "rec", label: "Per catch", show: (v) => String(v) },
  { key: "bonus_rec_te", label: "TE catch bonus", show: (v) => `+${v}` },
  { key: "pass_td", label: "Passing TD", show: (v) => String(v) },
  { key: "pass_int", label: "Interception", show: (v) => String(v) },
];

export function LeagueRulesPanel({ ctx, span = 4, mdSpan = 12 }: { ctx: LeagueContext; span?: PanelSpan; mdSpan?: 12 | 6 }) {
  const counts = new Map<string, number>();
  for (const p of ctx.rosterPositions) counts.set(p, (counts.get(p) ?? 0) + 1);
  const s = ctx.league.settings;
  const slots: Array<[string, number]> = [
    ["QB", counts.get("QB") ?? 0],
    ["RB", counts.get("RB") ?? 0],
    ["WR", counts.get("WR") ?? 0],
    ["TE", counts.get("TE") ?? 0],
    ["Flex", (counts.get("FLEX") ?? 0) + (counts.get("SUPER_FLEX") ?? 0) + (counts.get("REC_FLEX") ?? 0)],
    ["Bench", counts.get("BN") ?? 0],
    ["Taxi", s.taxi_slots ?? 0],
    ["IR", s.reserve_slots ?? 0],
  ];
  const waivers = s.waiver_type === 2 ? `FAAB, $${s.waiver_budget ?? 0}` : s.waiver_type === 1 ? "Reverse standings" : "Rolling";
  const playoffTeams = s.playoff_teams ?? 0;
  const facts: Array<[string, string]> = [
    ...SCORING_LINES.filter((l) => typeof ctx.scoring[l.key] === "number" && ctx.scoring[l.key] !== 0).map(
      (l) => [l.label, l.show(ctx.scoring[l.key])] as [string, string],
    ),
    ["Playoffs", playoffTeams ? `${playoffTeams} teams, weeks ${ctx.playoffWeekStart} to ${ctx.lastWeek}` : "--"],
    ["Trade deadline", s.trade_deadline ? `Week ${s.trade_deadline}` : "None"],
    ["Waivers", waivers],
  ];
  return (
    <Panel label="The league" labelRight={<span className="text-paper-shade">{ctx.league.total_rosters} teams</span>} span={span} mdSpan={mdSpan}>
      <div className="flex flex-col gap-5">
        <ul className="m-0 grid list-none grid-cols-4 gap-px border-2 border-ink bg-ink p-0">
          {slots.map(([label, n]) => (
            <li key={label} className="flex flex-col items-start gap-1.5 bg-paper px-2.5 py-2">
              <span className="type-label text-ink-muted">{label}</span>
              <Numeral value={n} size="d40" />
            </li>
          ))}
        </ul>
        <dl className="m-0 border-t-2 border-ink">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 border-b border-ink py-2">
              <dt className="type-label">{k}</dt>
              <dd className="m-0 text-right text-data font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

/* ------------------------------ on the clock ------------------------------ */

/** Who is on the clock and who is next. No running time on the clock: the site never knows when a pick was made. */
export function OnTheClockPanel({ ctx, facts, span = 4 }: { ctx: LeagueContext; facts: DraftFacts | null; span?: PanelSpan }) {
  const d = ctx.draft;
  const teams = facts?.teams || d?.settings.teams || 0;
  const total = facts ? facts.rounds * teams : 0;
  const made = facts?.picks.length ?? 0;

  let next: { pickNo: number; round: number; label: string; manager: string; team: string } | null = null;
  if (facts?.onTheClock) {
    const o = facts.onTheClock;
    next = { pickNo: o.pickNo, round: o.round, label: pickLabel(o.round, o.pickNo - (o.round - 1) * teams), manager: o.team.managerName, team: o.team.teamName };
  } else if (d && total && made < total) {
    const at = pickAt(d, made + 1);
    const m = at.rosterId ? managerFor(ctx, at.rosterId) : null;
    next = { pickNo: made + 1, round: at.round, label: at.label, manager: m?.name ?? "Unknown", team: m?.teamName ?? "" };
  }
  const upcoming = d && next ? [1, 2, 3].map((k) => next.pickNo + k).filter((n) => n <= total).map((n) => ({ n, ...pickAt(d, n) })) : [];
  const resumes = facts?.resumesAt ?? null;
  const round = next?.round ?? facts?.rounds ?? 0;

  return (
    <Panel label="On the clock" live={Boolean(next) && d?.status === "drafting"} labelRight={facts?.placeholder ? <SampleMark onInk /> : null} span={span}>
      {next ? (
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="type-label text-ink-muted">Pick {next.label}</span>
              <span className="type-display truncate text-j3">{next.manager}</span>
              <span className="truncate text-fine text-ink-muted">{next.team}</span>
            </div>
            <Numeral value={next.label} size="d60" ghost label={`Pick ${next.label}`} />
          </div>

          {resumes ? (
            <p className="type-label m-0 flex items-center gap-2">
              <LiveSquare size={10} />
              Draft paused. Picks resume at {resumes}.
            </p>
          ) : null}

          {upcoming.length ? (
            <div className="flex flex-col gap-1">
              <span className="type-label text-ink-muted">Up next</span>
              <ol className="m-0 list-none divide-y divide-ink border-y-2 border-ink p-0">
                {upcoming.map((u) => (
                  <li key={u.n} className="flex items-center justify-between gap-3 py-2">
                    <span className="type-data">{u.label}</span>
                    <span className="truncate font-semibold">{u.rosterId ? managerFor(ctx, u.rosterId).name : "--"}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <RoundDots round={round} rounds={facts?.rounds ?? 0} made={made} total={total} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-6">
          <div className="flex flex-col gap-2">
            <span className="type-label text-ink-muted">Board</span>
            <span className="type-display text-j3">{total && made >= total ? "Board full" : "Waiting"}</span>
          </div>
          <DotMatrixFill label={total && made >= total ? `All ${total} picks are in.` : "No pick is on the clock right now."} rows={5} />
          <RoundDots round={facts?.rounds ?? 0} rounds={facts?.rounds ?? 0} made={made} total={total} />
        </div>
      )}
    </Panel>
  );
}

/** One dot per round: filled when done, framed for the round on the clock. */
function RoundDots({ round, rounds, made, total }: { round: number; rounds: number; made: number; total: number }) {
  if (!rounds) return null;
  const teams = total / rounds;
  const done = Math.floor(made / teams);
  return (
    <div className="mt-auto flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="type-label text-ink-muted">
          Round {Math.min(round || 1, rounds)} of {rounds}
        </span>
        <span className="type-data text-fine text-ink-muted">
          {made} of {total} picks
        </span>
      </div>
      <div
        role="img"
        aria-label={`${done} of ${rounds} rounds complete`}
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(17, minmax(0, 1fr))" }}
      >
        {Array.from({ length: rounds }, (_, i) => (
          <span key={i} className={cx("block aspect-square", i < done ? "bg-ink" : i === done ? "border-2 border-ink bg-paper-shade" : "border border-ink")} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ the live board strip ------------------------------ */

function Verdict({ p }: { p: DraftPickFact }) {
  if (p.verdict === "reach")
    return (
      <span className="type-label flex items-center gap-1.5">
        <LiveSquare size={8} />
        Reach
      </span>
    );
  if (p.verdict === "steal")
    return (
      <span className="type-label flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2 bg-ink" />
        Steal
      </span>
    );
  return null;
}

export function BoardStrip({ facts, count = 10 }: { facts: DraftFacts | null; count?: number }) {
  // Newest first: the latest pick is the first cell. Phones show 4, tablets 5, wide screens 10.
  const picks = facts ? [...facts.picks].sort((a, b) => b.pickNo - a.pickNo).slice(0, count) : [];
  const newest = picks[0]?.pickNo;
  return (
    <Panel
      label="Latest picks"
      labelRight={
        <>
          {facts?.placeholder ? <SampleMark onInk /> : null}
          <BarLink href="/draft">Full board</BarLink>
        </>
      }
      pad={picks.length === 0}
    >
      {picks.length ? (
        <ol className="m-0 grid list-none grid-cols-2 gap-px bg-ink p-0 sm:grid-cols-5 xl:grid-cols-10">
          {picks.map((p, i) => (
            <li
              key={p.pickNo}
              id={`strip-pick-${p.pickNo}`}
              className={cx("min-w-0 flex-col gap-2 bg-paper px-3 py-3", i < 4 ? "flex" : i < 5 ? "hidden sm:flex" : "hidden xl:flex")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="type-label">{pickLabel(p.round, p.pickInRound)}</span>
                {p.pickNo === newest ? <Tag>Latest</Tag> : <Verdict p={p} />}
              </div>
              <p className="m-0 line-clamp-2 font-bold leading-tight">{p.player.name}</p>
              <p className="type-label m-0 text-ink-muted">
                {p.player.position}
                {p.player.nflTeam ? ` · ${p.player.nflTeam}` : ""}
              </p>
              <p className="m-0 mt-auto truncate text-fine text-ink-muted">
                {p.team.managerName}
                {p.fcRank ? ` · FC ${ordinal(p.fcRank)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <DotMatrixFill state="loading" label="No picks yet. The board fills in as they land." rows={5} />
      )}
    </Panel>
  );
}

/* ------------------------------ earlier roasts ------------------------------ */

export function EarlierRoastsPanel({ roasts, span = 8 }: { roasts: Roast[]; span?: PanelSpan }) {
  const blocks: RoastBlockData[] = roasts.map(roastToBlock);
  return (
    <Panel label="Earlier picks" span={span} pad={false}>
      <div className="grid flex-1 grid-cols-1 gap-px bg-ink md:grid-cols-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex bg-paper px-4 pb-5 pt-6 md:px-6">
            <RoastBlock {...b} size="compact" headingLevel={3} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
