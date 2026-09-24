/**
 * The external writer: Claude Code on the commissioner's own plan writes the issues instead of
 * the site's API writer (see lib/jobs/issues.ts, externalBriefs and publishExternal).
 *
 *   GET   ?kind=daily (optional; default every issue due today) &rewrite=1 (optional: brief an
 *         issue that already went out, to replace its words on the site)
 *         -> { briefs: [{ slug, kind, published, system, user, slots }], skipped }
 *   POST  { slug, text, model? } -> { status: queued | updated | rejected | missing, report }
 *         `text` is the reply in the persona's @@slot format. It passes the same post-check as
 *         the site's own writer; failed slots fall back to code text and are listed in the
 *         report, so the writer can fix them and post again.
 *
 * Bearer ADMIN_SECRET (or CRON_SECRET), through the admin limiter like every admin route. The
 * brief holds the private lore, so nothing here is public.
 */
import { adminSecretProblem, bearerOf, checkAdminAuth, checkCronAuth, clientIp } from "@/lib/email/gate";
import { allowAdminAttempt } from "@/lib/email/limits";
import { todaysPlan } from "@/lib/jobs";
import { externalBriefs, publishExternal } from "@/lib/jobs/issues";
import { getLeagueContext } from "@/lib/league";
import { getSchedule } from "@/lib/sleeper";
import type { IssueKind, NflGame } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };
const KINDS: IssueKind[] = ["daily", "thursday_fallout", "weekly_recap", "draft_grades"];
const MAX_TEXT = 60_000;

async function authorize(req: Request): Promise<Response | null> {
  if (!bearerOf(req)) return Response.json({ error: "Bearer ADMIN_SECRET required." }, { status: 401, headers: NO_STORE });
  if (!(await allowAdminAttempt(clientIp(req)))) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
  const ok = checkAdminAuth(req).ok || Boolean(process.env.CRON_SECRET && checkCronAuth(req).ok);
  if (!ok) return Response.json({ error: "Not authorized.", adminSecret: adminSecretProblem() ?? "ok" }, { status: 401, headers: NO_STORE });
  return null;
}

async function setup() {
  const ctx = await getLeagueContext();
  const schedule = await getSchedule(ctx.season).catch(() => [] as NflGame[]);
  return { ctx, schedule };
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as IssueKind | null;
  if (kind && !KINDS.includes(kind)) return Response.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400, headers: NO_STORE });
  const rewrite = url.searchParams.get("rewrite") === "1";
  const { ctx, schedule } = await setup();
  const now = Date.now();
  const plan = todaysPlan(ctx, now, schedule);
  const jobs = plan.jobs.filter((j) => !kind || j.job === kind);
  const out = await externalBriefs(jobs, ctx, now, schedule, { rewrite });
  const notToday = kind && !jobs.length ? [{ job: kind, detail: plan.skipped.find((s) => s.job === kind)?.detail ?? "Not due today." }] : [];
  return Response.json({ date: plan.date, briefs: out.briefs, skipped: [...out.skipped, ...notToday] }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  let body: { slug?: unknown; text?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { slug, text, model? }." }, { status: 400, headers: NO_STORE });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 80) : "claude-code";
  if (!slug || !text.trim()) return Response.json({ error: "slug and text are required." }, { status: 400, headers: NO_STORE });
  if (text.length > MAX_TEXT) return Response.json({ error: "text is too long." }, { status: 413, headers: NO_STORE });
  const { ctx, schedule } = await setup();
  const res = await publishExternal(slug, text, model, ctx, schedule);
  const code = res.status === "missing" ? 404 : res.status === "rejected" ? 422 : 200;
  return Response.json(res, { status: code, headers: NO_STORE });
}
