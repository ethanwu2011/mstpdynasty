import { cx } from "./cx";

export interface DotBarProps {
  /** 0..100 */
  value: number | null | undefined;
  /** Number of dots (default 20: one dot is 5 points). */
  dots?: number;
  /** Accessible text, e.g. "Playoff odds 72 percent". */
  label: string;
  className?: string;
}

/**
 * A one-sided meter in the board's dot vocabulary: lit ink squares for the value, unlit bulbs
 * (a 1px frame) for the rest. The last lit dot is drawn smaller for a partial step, the way a
 * halftone screen shows density with dot size, so 12% never reads the same as 10%.
 * For two sides of a matchup use WinDots.
 */
export function DotBar({ value, dots = 20, label, className }: DotBarProps) {
  const v = value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  const steps = (v / 100) * dots;
  const full = Math.floor(steps + 1e-9);
  const part = steps - full;
  return (
    <span
      role="img"
      aria-label={label}
      className={cx("grid w-full gap-[2px]", className)}
      style={{ gridTemplateColumns: `repeat(${dots}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: dots }, (_, i) => {
        if (i < full) return <span key={i} className="block aspect-square bg-ink" />;
        if (i === full && part > 0.04) {
          // Area-true partial dot, centered in its cell.
          const side = `${Math.round(Math.sqrt(part) * 100)}%`;
          return (
            <span key={i} className="relative block aspect-square border border-ink">
              <span className="absolute inset-0 m-auto bg-ink" style={{ width: side, height: side }} />
            </span>
          );
        }
        return <span key={i} className="block aspect-square border border-ink" />;
      })}
    </span>
  );
}
