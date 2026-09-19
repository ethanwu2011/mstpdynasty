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
  /**
   * Size step. d40 and up are Doto dot-matrix digits (multiples of 10px keep the dots crisp).
   * Doto is never used below 32px: it turns to grey fuzz on a phone. d30 is set in Jersey 10
   * (the solid pixel face, 37px) and d20 in the grotesk, bold and tabular.
   * Omit to size with className (then keep it at text-d40 or larger at every breakpoint).
   */
  size?: NumeralSize;
  tone?: NumeralTone;
  /** Shown when value is null or not finite (default "--"). */
  empty?: string;
  /** Accessible text when the digits alone are ambiguous ("112.4 points"). */
  label?: string;
  className?: string;
}

const DOTO: Partial<Record<NumeralSize, string>> = {
  d40: "text-d40",
  d60: "text-d60",
  d80: "text-d80",
  d100: "text-d100",
};

/* Below 32px the digits are solid: Jersey 10 for d30, the grotesk for d20. */
const SOLID: Partial<Record<NumeralSize, string>> = {
  d30: "type-display text-j2 tnum",
  d20: "font-sans text-numeral-solid font-extrabold leading-none tnum",
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

/** Scores, odds, records, clocks: Doto dot-matrix digits when big, solid digits when small. */
export function Numeral({ value, decimals, pad, sign, group, size, tone = "ink", empty, label, className }: NumeralProps) {
  const text = formatNumeral(value, { decimals, pad, sign, group, empty });
  const solid = size ? SOLID[size] : undefined;
  if (solid) {
    return (
      <span className={cx("relative inline-block whitespace-nowrap", solid, TONES[tone], className)}>
        <span className="sr-only">{label ?? text}</span>
        <span aria-hidden>{text}</span>
      </span>
    );
  }
  return (
    <span className={cx("type-numeral relative inline-block whitespace-nowrap", size && DOTO[size], TONES[tone], className)}>
      <span className="sr-only">{label ?? text}</span>
      <span aria-hidden className="relative">
        {dotted(text)}
      </span>
    </span>
  );
}
