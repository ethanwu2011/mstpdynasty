/** Job run log: one entry per run under keys.jobRun, newest first when listed. */
import * as store from "@/lib/store";
import type { JobRunReport } from "@/lib/types";

const DAY = 24 * 3600;
/** Daily runs are kept for a season; ticks (up to 30 an hour) only for two weeks. */
const TTL = { daily: 200 * DAY, tick: 14 * DAY } as const;

export interface LoggedJobRun extends JobRunReport {
  leagueId: string;
}

export async function logJobRun(leagueId: string, report: JobRunReport): Promise<void> {
  const ttlSeconds = TTL[report.kind];
  try {
    // Two runs can start in the same millisecond (a tick next to the cron): claim a free key
    // atomically instead of overwriting, nudging the timestamp by a millisecond at a time.
    for (let i = 0; i < 10; i++) {
      const key = store.keys.jobRun(leagueId, report.startedAt + i);
      if (await store.lock(key, ttlSeconds)) {
        await store.set<LoggedJobRun>(key, { ...report, leagueId }, { ttlSeconds });
        return;
      }
    }
  } catch {
    // The log is best effort; never fail a job because of it.
  }
}

export async function listJobRuns(leagueId: string, limit = 20): Promise<LoggedJobRun[]> {
  const ks = (await store.list(store.keys.jobRunPrefix(leagueId))).sort((a, b) => {
    const ta = Number(a.slice(a.lastIndexOf(":") + 1));
    const tb = Number(b.slice(b.lastIndexOf(":") + 1));
    return tb - ta;
  });
  const runs = await Promise.all(ks.slice(0, limit).map((k) => store.get<LoggedJobRun>(k)));
  return runs.filter((r): r is LoggedJobRun => Boolean(r));
}
