import { cx } from "./cx";

export type NumeralSize = "d20" | "d30" | "d40" | "d60" | "d80" | "d100";
export type NumeralTone = "ink" | "muted" | "red" | "paper";

export interface NumeralProps {
  /** A number is formatted; a string is shown as is ("1.07", "7-2"). null shows the placeholder. */
  value: number | string | null | undefined;
  /** Fixed decimals for numbers (default 0). */
  decimals?: number;
  /** Zero-pad the integer part to this many digits ("07"). */
  pad?: number;
  /** Prefix positive numbers with "+". */
  sign?: boolean;
  /** Thousands separators (default true). */
  group?: boolean;
  /** Doto size step. Multiples of 10px keep the dots crisp. Omit to size with className. */
  size?: NumeralSize;
  tone?: NumeralTone;
  /** Unlit "8" dots behind the digits, like a scoreboard with its bulbs off. Paper grounds only. */
  ghost?: boolean;
  /** Shown when value is null or not finite (default "--"). */
  empty?: string;
  /** Accessible text when the digits alone are ambiguous ("112.4 points"). */
  label?: string;
  className?: string;
}

const SIZES: Record<NumeralSize, string> = {
  d20: "text-d20",
  d30: "text-d30",
  d40: "text-d40",
  d60: "text-d60",
  d80: "text-d80",
  d100: "text-d100",
};

const TONES: Record<NumeralTone, string> = {
  ink: "text-ink",
  muted: "text-ink-muted",
  red: "text-red",
  paper: "text-paper",
};

export function formatNumeral(
  value: NumeralProps["value"],
  { decimals = 0, pad = 0, sign = false, group = true, empty = "--" }: Pick<NumeralProps, "decimals" | "pad" | "sign" | "group" | "empty"> = {},
): string {
  if (value === null || value === undefined) return empty;
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return empty;
  const abs = Math.abs(value);
  let text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: group,
  }).format(abs);
  if (pad > 0) {
    const [int, frac] = text.split(".");
    text = int.padStart(pad, "0") + (frac !== undefined ? `.${frac}` : "");
  }
  const neg = value < 0 && Number(text.replace(/,/g, "")) !== 0;
  return (neg ? "-" : sign && value > 0 ? "+" : "") + text;
}

/*
 * Doto draws "." and ":" as plus-shaped clusters, which read as "+" at score sizes
 * ("110+5"). They are replaced with single square dots on the same 0.1em dot pitch.
 */
function dotted(text: string) {
  return text.split(/([.:])/).map((part, i) =>
    part === "." ? <span key={i} className="numeral-point" /> : part === ":" ? <span key={i} className="numeral-colon" /> : part,
  );
}

/** Doto dot-matrix digits: scores, odds, records, clocks. */
export function Numeral({ value, decimals, pad, sign, group, size, tone = "ink", ghost = false, empty, label, className }: NumeralProps) {
  const text = formatNumeral(value, { decimals, pad, sign, group, empty });
  const ghostText = text.replace(/[0-9]/g, "8");
  return (
    <span className={cx("type-numeral relative inline-block whitespace-nowrap", size && SIZES[size], TONES[tone], className)}>
      <span className="sr-only">{label ?? text}</span>
      {ghost ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 select-none text-paper-shade">
          {dotted(ghostText)}
        </span>
      ) : null}
      <span aria-hidden className="relative">
        {dotted(text)}
      </span>
    </span>
  );
}
