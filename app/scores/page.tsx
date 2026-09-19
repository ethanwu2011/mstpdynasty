import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { pagePhase, type SearchParams } from "../_lib/phase";
import { DarkBoard, defaultWeek, WeekScores } from "./_parts/view";

export const metadata: Metadata = {
  title: "Scores",
  description: "Every matchup this week: live scores, win odds and the points left on the bench.",
};

/** This week's scoreboard (the canonical week pages live at /scores/[week]). */
export default async function ScoresPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  const week = defaultWeek(ctx, phase);
  if (week === null) return <DarkBoard ctx={ctx} phase={phase === "drafting" ? "drafting" : "pre_draft"} />;
  return <WeekScores ctx={ctx} phase={phase} week={week} />;
}
