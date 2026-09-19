/**
 * Roast lore loader. Lore never lives in the repo (it is public): the store key
 * `keys.roastNotes()` and env ROAST_NOTES (JSON, manager first name -> text) are merged at
 * runtime, env winning per manager. config/roast-notes.ts only documents the format.
 */
import { ROAST_NOTE_MAX_CHARS, ROAST_NOTES_DEFAULTS } from "@/config/roast-notes";
import { roastNotesFromEnv } from "@/lib/env";
import * as store from "@/lib/store";

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, ROAST_NOTE_MAX_CHARS) : "";
}

/** All non-empty notes, keyed by manager first name as written in the source. */
export async function loadRoastNotes(): Promise<Record<string, string>> {
  const merged: Record<string, string> = { ...ROAST_NOTES_DEFAULTS };
  try {
    const stored = await store.get<unknown>(store.keys.roastNotes());
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (clean(v)) merged[k] = clean(v);
    }
  } catch {
    // store unavailable: env still applies
  }
  for (const [k, v] of Object.entries(roastNotesFromEnv())) if (clean(v)) merged[k] = clean(v);
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v.length > 0));
}

/** Notes for the managers in `names` (case-insensitive), in a stable order. */
export function notesFor(all: Record<string, string>, names: string[]): Record<string, string> {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return Object.fromEntries(
    Object.entries(all)
      .filter(([k]) => wanted.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
