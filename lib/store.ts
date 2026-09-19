/**
 * Tiny KV store.
 *
 * Backends (picked once per process):
 *   - "upstash": KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   - "memory":  under Vitest, or STORE_BACKEND=memory
 *   - "file":    everything else; JSON files in DATA_DIR (default `.data/`, or /tmp on Vercel without KV)
 * STORE_BACKEND=upstash|file|memory forces a backend.
 *
 * Values must be JSON-serializable. Keys are plain strings; see `keys` below for the
 * shared naming convention. All keys are namespaced with STORE_PREFIX (default "mstp:"),
 * and list() returns keys WITHOUT that prefix.
 */
import { Redis } from "@upstash/redis";

export type StoreBackend = "upstash" | "file" | "memory";

export interface SetOptions {
  /** Expire after this many seconds. */
  ttlSeconds?: number;
}

export interface Store {
  readonly backend: StoreBackend;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, opts?: SetOptions): Promise<void>;
  del(key: string): Promise<void>;
  /** Keys starting with `prefix`, sorted ascending. */
  list(prefix: string): Promise<string[]>;
  /** Acquire `key` for ttlSeconds. Returns false if someone else holds it (acts as a cooldown). */
  lock(key: string, ttlSeconds: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

const PREFIX = () => process.env.STORE_PREFIX ?? "mstp:";

/* ----------------------------- upstash ----------------------------- */

function upstashCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function upstashStore(creds: { url: string; token: string }): Store {
  const redis = new Redis({ url: creds.url, token: creds.token });
  const p = PREFIX();
  return {
    backend: "upstash",
    async get<T>(key: string) {
      return ((await redis.get<T>(p + key)) ?? null) as T | null;
    },
    async set<T>(key: string, value: T, opts?: SetOptions) {
      if (opts?.ttlSeconds) await redis.set(p + key, value, { ex: Math.max(1, Math.ceil(opts.ttlSeconds)) });
      else await redis.set(p + key, value);
    },
    async del(key: string) {
      await redis.del(p + key);
    },
    async list(prefix: string) {
      const out: string[] = [];
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, { match: `${p}${prefix}*`, count: 500 });
        cursor = String(next);
        for (const k of keys) out.push(k.slice(p.length));
      } while (cursor !== "0");
      return [...new Set(out)].sort();
    },
    async lock(key: string, ttlSeconds: number) {
      const res = await redis.set(p + key, Date.now(), { nx: true, ex: Math.max(1, Math.ceil(ttlSeconds)) });
      return res === "OK";
    },
    async unlock(key: string) {
      await redis.del(p + key);
    },
  };
}

/* ------------------------------ memory ------------------------------ */

interface Entry {
  v: unknown;
  /** Expiry, epoch ms; null = never. */
  exp: number | null;
}

function memoryStore(): Store {
  const map = new Map<string, Entry>();
  const live = (k: string): Entry | null => {
    const e = map.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      map.delete(k);
      return null;
    }
    return e;
  };
  return {
    backend: "memory",
    async get<T>(key: string) {
      const e = live(key);
      return e ? (structuredClone(e.v) as T) : null;
    },
    async set<T>(key: string, value: T, opts?: SetOptions) {
      map.set(key, { v: structuredClone(value), exp: opts?.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null });
    },
    async del(key: string) {
      map.delete(key);
    },
    async list(prefix: string) {
      return [...map.keys()].filter((k) => k.startsWith(prefix) && live(k)).sort();
    },
    async lock(key: string, ttlSeconds: number) {
      if (live(key)) return false;
      map.set(key, { v: Date.now(), exp: Date.now() + ttlSeconds * 1000 });
      return true;
    },
    async unlock(key: string) {
      map.delete(key);
    },
  };
}

/* ------------------------------- file ------------------------------- */

function fileDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // Vercel's filesystem is read-only outside /tmp. Data there is per-instance and
  // ephemeral: configure KV for anything real.
  if (process.env.VERCEL) return "/tmp/mstp-data";
  return `${process.cwd()}/.data`;
}

function fileStore(): Store {
  const dir = fileDir();
  const p = PREFIX();
  const fileFor = (key: string) => `${dir}/${encodeURIComponent(p + key)}.json`;
  const fs = () => import("node:fs/promises");
  let ensured = false;
  const ensureDir = async () => {
    if (ensured) return;
    await (await fs()).mkdir(dir, { recursive: true });
    ensured = true;
  };
  const readEntry = async (key: string): Promise<Entry | null> => {
    try {
      const raw = await (await fs()).readFile(fileFor(key), "utf8");
      const e = JSON.parse(raw) as Entry;
      if (e.exp !== null && e.exp <= Date.now()) return null;
      return e;
    } catch {
      return null;
    }
  };
  const writeEntry = async (key: string, e: Entry) => {
    await ensureDir();
    const f = await fs();
    const target = fileFor(key);
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await f.writeFile(tmp, JSON.stringify(e));
    await f.rename(tmp, target);
  };
  return {
    backend: "file",
    async get<T>(key: string) {
      const e = await readEntry(key);
      return e ? (e.v as T) : null;
    },
    async set<T>(key: string, value: T, opts?: SetOptions) {
      await writeEntry(key, { v: value, exp: opts?.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null });
    },
    async del(key: string) {
      await (await fs()).rm(fileFor(key), { force: true });
    },
    async list(prefix: string) {
      let names: string[];
      try {
        names = await (await fs()).readdir(dir);
      } catch {
        return [];
      }
      const keys: string[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        let full: string;
        try {
          full = decodeURIComponent(name.slice(0, -5));
        } catch {
          continue;
        }
        if (!full.startsWith(p)) continue;
        const key = full.slice(p.length);
        if (key.startsWith(prefix) && (await readEntry(key))) keys.push(key);
      }
      return keys.sort();
    },
    async lock(key: string, ttlSeconds: number) {
      await ensureDir();
      const f = await fs();
      const entry: Entry = { v: Date.now(), exp: Date.now() + ttlSeconds * 1000 };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await f.writeFile(fileFor(key), JSON.stringify(entry), { flag: "wx" });
          return true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
          if (await readEntry(key)) return false; // held and not expired
          await f.rm(fileFor(key), { force: true }); // expired: clear and retry once
        }
      }
      return false;
    },
    async unlock(key: string) {
      await (await fs()).rm(fileFor(key), { force: true });
    },
  };
}

/* ------------------------------ factory ----------------------------- */

let singleton: Store | null = null;

export function pickBackend(): StoreBackend {
  const forced = process.env.STORE_BACKEND as StoreBackend | undefined;
  if (forced === "upstash" || forced === "file" || forced === "memory") return forced;
  if (upstashCredentials()) return "upstash";
  if (process.env.VITEST) return "memory";
  return "file";
}

export function getStore(): Store {
  if (singleton) return singleton;
  const backend = pickBackend();
  if (backend === "upstash") {
    const creds = upstashCredentials();
    if (!creds) throw new Error("STORE_BACKEND=upstash but no KV_REST_API_* / UPSTASH_REDIS_REST_* env vars are set");
    singleton = upstashStore(creds);
  } else if (backend === "memory") {
    singleton = memoryStore();
  } else {
    singleton = fileStore();
  }
  return singleton;
}

/** Test helper: drop the singleton so the next getStore() re-reads env. */
export function resetStoreForTests(): void {
  singleton = null;
}

export const get = <T>(key: string) => getStore().get<T>(key);
export const set = <T>(key: string, value: T, opts?: SetOptions) => getStore().set<T>(key, value, opts);
export const del = (key: string) => getStore().del(key);
export const list = (prefix: string) => getStore().list(prefix);
export const lock = (key: string, ttlSeconds: number) => getStore().lock(key, ttlSeconds);
export const unlock = (key: string) => getStore().unlock(key);

/**
 * Shared key convention. League-scoped data always starts with `league:<leagueId>:` so a
 * dev run against the fixture league never collides with the real league.
 */
export const keys = {
  /** Trimmed /players/nfl map (global, refreshed at most daily). */
  players: () => "global:players:v1",
  /** Trimmed weekly stats / projections cache (global). */
  stats: (season: string, week: number) => `global:stats:${season}:${week}`,
  projections: (season: string, week: number) => `global:proj:${season}:${week}`,
  /** FantasyCalc snapshot by ET date (kept, so trade grades can use value at the time). */
  fantasyCalc: (date: string) => `global:fantasycalc:${date}`,
  fantasyCalcLatest: () => "global:fantasycalc:latest",
  /** Newsletters. */
  issue: (leagueId: string, slug: string) => `league:${leagueId}:issue:${slug}`,
  issuePrefix: (leagueId: string) => `league:${leagueId}:issue:`,
  /** Instant roasts, id = "trade:<txId>" | "waiver:<batchId>" | "pick:<draftId>:<pickNo>". */
  roast: (leagueId: string, roastId: string) => `league:${leagueId}:roast:${roastId}`,
  roastPrefix: (leagueId: string, kind?: string) => `league:${leagueId}:roast:${kind ? `${kind}:` : ""}`,
  /** Season sim snapshot per week. */
  oddsSnapshot: (leagueId: string, season: string, week: number) =>
    `league:${leagueId}:odds:${season}:${String(week).padStart(2, "0")}`,
  oddsPrefix: (leagueId: string, season: string) => `league:${leagueId}:odds:${season}:`,
  /** Newsletter subscribers, keyed by lowercased email. */
  subscriber: (leagueId: string, email: string) => `league:${leagueId}:sub:${email.toLowerCase()}`,
  subscriberPrefix: (leagueId: string) => `league:${leagueId}:sub:`,
  /** Job run log, one entry per run. */
  jobRun: (leagueId: string, startedAt: number) => `league:${leagueId}:job:${startedAt}`,
  jobRunPrefix: (leagueId: string) => `league:${leagueId}:job:`,
  /** Last-seen snapshots (injury statuses, draft pick timestamps, transaction cursors...). */
  snapshot: (leagueId: string, name: string) => `league:${leagueId}:snap:${name}`,
  /** Locks / cooldowns. */
  lock: (leagueId: string, name: string) => `league:${leagueId}:lock:${name}`,
  /** Roast lore (manager first name -> text), set by the commissioner. Env ROAST_NOTES wins over it. */
  roastNotes: () => "roast-notes",
  /** Single-use tokens (approve links). */
  token: (leagueId: string, id: string) => `league:${leagueId}:token:${id}`,
};
