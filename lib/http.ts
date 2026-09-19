/**
 * Shared JSON fetch helper for every public data source (Sleeper, FantasyCalc, ESPN).
 *
 * - In Next, `revalidate` / `tags` go through the Next data cache.
 *   The Next data cache refuses items over 2 MB, so large payloads
 *   (players, weekly stats, projections) use `noStore` and are cached by the
 *   caller in a trimmed form instead.
 * - `DATA_SOURCE=fixtures` reads responses from `fixtures/` (written by
 *   `npm run fixtures`) and never touches the network. Tests always run this way.
 */

export interface FetchJsonOptions {
  /** Seconds for the Next data cache. Ignored outside Next and in fixture mode. */
  revalidate?: number | false;
  /** Next cache tags, for revalidateTag(). */
  tags?: string[];
  /** Bypass the Next data cache entirely (use for payloads over 2 MB). */
  noStore?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `GET ${url} failed with HTTP ${status}`);
    this.name = "HttpError";
  }
}

export class FixtureMissingError extends Error {
  constructor(
    public readonly url: string,
    public readonly file: string,
  ) {
    super(`No fixture for ${url} (expected ${file}). Run \`npm run fixtures\` first.`);
    this.name = "FixtureMissingError";
  }
}

export function isFixtureMode(): boolean {
  return process.env.DATA_SOURCE === "fixtures";
}

export function fixturesDir(): string {
  return process.env.FIXTURES_DIR || `${process.cwd()}/fixtures`;
}

const HOST_DIRS: Record<string, string> = {
  "api.sleeper.app": "sleeper",
  "api.fantasycalc.com": "fantasycalc",
  "site.api.espn.com": "espn",
};

/**
 * Deterministic fixture path (relative to fixturesDir()) for a URL.
 * Example: https://api.sleeper.app/v1/league/123/matchups/4 -> sleeper/v1/league/123/matchups/4.json
 * Query strings are sorted and sanitized into the file name after an "@".
 */
export function fixtureRelPath(url: string): string {
  const u = new URL(url);
  const host = HOST_DIRS[u.host] ?? u.host.replace(/[^a-z0-9.-]/gi, "_");
  const path = u.pathname.replace(/^\/+|\/+$/g, "") || "index";
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b),
  );
  const query = params
    .map(([k, v]) => `${k}=${v}`)
    .join("+")
    .replace(/[^A-Za-z0-9=+._-]/g, "_");
  return `${host}/${path}${query ? `@${query}` : ""}.json`;
}

async function readFixture(url: string): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  const file = `${fixturesDir()}/${fixtureRelPath(url)}`;
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new FixtureMissingError(url, file);
  }
  return JSON.parse(raw);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a JSON document. Returns whatever the server sent (Sleeper sometimes sends `null`). */
export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  if (isFixtureMode()) return readFixture(url);

  const retries = opts.retries ?? 2;
  const init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } = {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  };
  if (opts.noStore) {
    init.cache = "no-store";
  } else if (opts.revalidate !== undefined || opts.tags) {
    init.next = { revalidate: opts.revalidate, tags: opts.tags };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        const text = await res.text();
        return text.length ? JSON.parse(text) : null;
      }
      lastError = new HttpError(url, res.status);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
    }
    if (attempt < retries) {
      await sleep(400 * 2 ** attempt);
      init.signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
    }
  }
  throw lastError;
}
