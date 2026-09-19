import "server-only";
import * as store from "@/lib/store";

/** Last outcome of a call to the joke writer, for /api/health. Never holds keys or league text. */
export interface WriterStatus {
  ok: boolean;
  at: number;
  model?: string | null;
  reason?: string;
  detail?: string;
}

const KEY = "ops:writer-status";

/** Strip anything that looks like a credential before it is stored. */
function scrub(s: string): string {
  return s.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]").replace(/\s+/g, " ").slice(0, 240);
}

export async function recordWriterStatus(s: WriterStatus): Promise<void> {
  const value: WriterStatus = { ...s, detail: s.detail ? scrub(s.detail) : undefined };
  await store.set(KEY, value).catch(() => {});
}

export async function readWriterStatus(): Promise<WriterStatus | null> {
  return store.get<WriterStatus>(KEY).catch(() => null);
}

/** The most recent sentences the post-check threw out, newest first, for /api/health. */
export interface DropRecord {
  at: number;
  label: string;
  reasons: string[];
  sentence: string;
}

const DROPS_KEY = "ops:recent-drops";
const MAX_DROPS = 25;

export async function recordDrops(records: DropRecord[]): Promise<void> {
  if (!records.length) return;
  const prev = (await store.get<DropRecord[]>(DROPS_KEY).catch(() => null)) ?? [];
  const next = [...records.map((r) => ({ ...r, sentence: scrub(r.sentence) })), ...prev].slice(0, MAX_DROPS);
  await store.set(DROPS_KEY, next).catch(() => {});
}

export async function readDrops(): Promise<DropRecord[]> {
  return (await store.get<DropRecord[]>(DROPS_KEY).catch(() => null)) ?? [];
}
