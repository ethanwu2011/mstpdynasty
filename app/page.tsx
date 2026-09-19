/**
 * Foundation proof page: shows the data layer works. OWNER: UI agent (replace entirely).
 */
import { getLeagueContext } from "@/lib/league";
import { formatEt } from "@/lib/time";

export const revalidate = 60;

export default async function Home() {
  const ctx = await getLeagueContext();
  const draftStart = ctx.draft?.start_time
    ? formatEt(ctx.draft.start_time, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "not scheduled";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 font-mono text-sm">
      <h1 className="text-lg font-bold">{ctx.league.name}</h1>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1">
        <dt>League</dt>
        <dd>{ctx.leagueId}{ctx.isDevLeague ? " (dev league)" : ""}{ctx.isFixture ? " (fixtures)" : ""}</dd>
        <dt>Season</dt>
        <dd>{ctx.season}</dd>
        <dt>Phase</dt>
        <dd>{ctx.phase}</dd>
        <dt>Week</dt>
        <dd>{ctx.week} (NFL week {ctx.state.week})</dd>
        <dt>Draft</dt>
        <dd>{ctx.draft ? `${ctx.draft.status}, ${ctx.draft.settings.rounds} rounds, starts ${draftStart}` : "none"}</dd>
      </dl>
      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-current">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Manager</th>
            <th className="py-1 pr-2">Sleeper</th>
            <th className="py-1">Team</th>
          </tr>
        </thead>
        <tbody>
          {ctx.managers.map((m) => (
            <tr key={m.rosterId} className="border-b border-black/10">
              <td className="py-1 pr-2 tabular-nums">{m.rosterId}</td>
              <td className="py-1 pr-2">{m.name}{m.isCommissioner ? " (commish)" : ""}</td>
              <td className="py-1 pr-2">{m.username ?? "vacant"}</td>
              <td className="py-1">{m.teamName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
