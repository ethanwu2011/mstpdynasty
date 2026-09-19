/** Time helpers. Everything user-facing is America/New_York. */

export const TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etParts(at: number | Date = Date.now()): EtParts {
  const ms = typeof at === "number" ? at : at.getTime();
  const parts = Object.fromEntries(partsFmt.formatToParts(ms).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** "YYYY-MM-DD" in Eastern time. */
export function etDate(at: number | Date = Date.now()): string {
  const p = etParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Format a timestamp in Eastern time, e.g. formatEt(ms, { weekday: "short", hour: "numeric" }). */
export function formatEt(at: number | Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(typeof at === "number" ? at : at.getTime());
}

/** Epoch ms for a wall-clock time in Eastern time (handles DST). */
export function etToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Offset between the UTC reading of `guess` and its Eastern reading; iterate twice for DST edges.
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = etParts(ms);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ms = guess - (asUtc - ms);
  }
  return ms;
}
