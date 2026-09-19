import type { HeaderStatus } from "@/components/SiteHeader";
import type { LeagueContext, SeasonPhase } from "@/lib/types";
import { clockLength, etStamp } from "./format";

/** The top bar's status line for a phase. */
export function leagueStatus(ctx: LeagueContext, phase: SeasonPhase = ctx.phase): HeaderStatus {
  const draft = ctx.draft;
  switch (phase) {
    case "pre_draft":
      return {
        primary: "Startup draft",
        secondary: draft?.start_time ? etStamp(draft.start_time) : "Start time not set",
      };
    case "drafting": {
      const clock = clockLength(draft?.settings.pick_timer);
      const paused = draft?.status === "paused";
      return {
        primary: paused ? "Draft paused" : "Draft live",
        secondary: [draft ? `${draft.settings.rounds} rounds` : null, clock ? `${clock} clock` : null].filter(Boolean).join(" · "),
        live: !paused,
      };
    }
    case "in_season":
      return {
        primary: ctx.week >= ctx.playoffWeekStart ? `Playoffs · Week ${ctx.week}` : `Week ${ctx.week}`,
        secondary: `${ctx.season} season`,
      };
    case "offseason":
      return { primary: "Offseason", secondary: `${ctx.season} season` };
    case "complete":
      return { primary: `${ctx.season} final`, secondary: "Season complete" };
  }
}
