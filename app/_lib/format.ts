/** Display formatting shared by every page. No data access here. */
import { formatEt } from "@/lib/time";

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Fantasy points, 2 decimals by default. */
export function fmtPts(n: number | null | undefined, decimals = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "--" : n.toFixed(decimals);
}

/** Whole number with thousands separators ("1,800"). */
export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "--" : intFmt.format(Math.round(n));
}

/** "+1,800" / "-1,800" / "0". */
export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "--";
  const r = Math.round(n);
  return (r > 0 ? "+" : r < 0 ? "-" : "") + intFmt.format(Math.abs(r));
}

/** 0..1 to a whole percent. */
export function pct(p01: number): number {
  return Math.round(Math.min(1, Math.max(0, p01)) * 100);
}

/** 1 -> "1st", 22 -> "22nd". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Round and pick in round to "4.07". */
export function pickLabel(round: number, pickInRound: number): string {
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
}

/** "Fri Sep 18 · 9:00 PM ET". */
export function etStamp(ms: number): string {
  const day = formatEt(ms, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = formatEt(ms, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ET`;
}

/** Seconds to a short clock length: 14400 -> "4h", 90 -> "90s", 5400 -> "1h 30m". */
export function clockLength(seconds: number | undefined | null): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 120) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Win-loss(-tie) record. */
export function record(w: number, l: number, t = 0): string {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}
