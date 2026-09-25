import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLeagueContext } from "@/lib/league";
import { pagePhase, type SearchParams } from "../../_lib/phase";
import { DarkBoard, startWeekOf, WeekScores } from "../_parts/view";
import { weekRoute } from "../_parts/week";

type Params = Promise<{ week: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week } = await params;
  return {
    title: /^\d{1,2}$/.test(week) ? `Week ${Number(week)} scores` : "Scores",
    description: "Every matchup of the week: scores, win odds, box scores and the points left on the bench.",
  };
}

export default async function WeekScoresPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ week: raw }, ctx] = await Promise.all([params, getLeagueContext()]);
  const route = weekRoute(raw, startWeekOf(ctx), ctx.lastWeek);
  if (route.kind === "not_found") notFound();
  if (route.kind === "before_start") redirect("/scores");
  const week = route.week;
  const phase = await pagePhase(ctx, searchParams);
  if (phase === "pre_draft" || phase === "drafting") return <DarkBoard ctx={ctx} phase={phase} />;
  return <WeekScores ctx={ctx} phase={phase} week={week} />;
}
