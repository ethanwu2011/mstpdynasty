/**
 * Roast lore FORMAT ONLY. This repo is public, so real lore never lives here.
 *
 * Real per-manager running jokes are read at runtime (lib/roast/notes.ts) from:
 *   1. the store key "roast-notes" (`keys.roastNotes()` in lib/store.ts), set by the commissioner
 *   2. env ROAST_NOTES, a JSON object of manager first name -> text (`roastNotesFromEnv()`)
 * Env wins per manager. Keys are the first names in config/managers.ts (case-insensitive).
 *
 *   ROAST_NOTES='{"Ethan":"drafted a kicker in a league with no kickers","Peter":"..."}'
 *
 * Write each note as plain facts or running jokes, one or two sentences. The Roast only uses
 * a note when it fits the week's facts, and the hard limits still apply: anything personal
 * (school, work, health, family, looks) is off limits unless it is written here as the joke.
 * The shipped defaults below are intentionally empty.
 */
import { MANAGERS } from "@/config/managers";

export const ROAST_NOTES_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(MANAGERS.map((m) => [m.firstName, ""])),
);

/** Longest note (characters) passed to the model per manager. */
export const ROAST_NOTE_MAX_CHARS = 500;
