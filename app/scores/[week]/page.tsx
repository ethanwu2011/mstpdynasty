import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLeagueContext } from "@/lib/league";
import { pagePhase, type SearchParams } from "../../_lib/phase";
import { DarkBoard, WeekScores } from "../_parts/view";

type Params = Promise<{ week: string }>;

function parseWeek(raw: string, lastWeek: number): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= lastWeek ? n : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week } = await params;
  return {
    title: /^\d{1,2}$/.test(week) ? `Week ${Number(week)} scores` : "Scores",
    description: "Every matchup of the week: scores, win odds, box scores and the points left on the bench.",
  };
}

export default async function WeekScoresPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ week: raw }, ctx] = await Promise.all([params, getLeagueContext()]);
  const week = parseWeek(raw, ctx.lastWeek);
  if (week === null) notFound();
  const phase = await pagePhase(ctx, searchParams);
  if (phase === "pre_draft" || phase === "drafting") return <DarkBoard ctx={ctx} phase={phase} />;
  return <WeekScores ctx={ctx} phase={phase} week={week} />;
}
