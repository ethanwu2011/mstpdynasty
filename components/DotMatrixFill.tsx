import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { bayer, rampAt, type DitherRamp } from "./Dither";

export interface DotMatrixFillProps {
  /** One plain line that says what is missing or what is loading. */
  label: ReactNode;
  /** empty = a mostly unlit board; loading = dots light in dither order, over and over. */
  state?: "empty" | "loading";
  /** Rows of dots (default 6). The field crops to the panel width. */
  rows?: number;
  /** Cell pitch in px (default 9: the 9x9 dot matrix). */
  cell?: number;
  /** Peak density of the lit dots, 0..1 (default 0.55). */
  density?: number;
  ramp?: DitherRamp;
  className?: string;
}

const COLS = 160;

/**
 * Empty and loading states: a dot-matrix field with its unlit bulbs showing, plus one line
 * of copy. The field is cropped, never stretched, so dots stay square at every width.
 */
export function DotMatrixFill({ label, state = "empty", rows = 6, cell = 9, density = 0.55, ramp = "diagonal", className }: DotMatrixFillProps) {
  const dot = cell - 3;
  const w = COLS * cell;
  const h = rows * cell;
  const cells: ReactNode[] = [];
  let unlit = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = bayer(x, y);
      // Ramp across the visible start of the field (first ~40 columns), then hold.
      const v = density * rampAt(ramp, Math.min(x, 40), y, 41, rows);
      const lit = v > t;
      if (state === "loading") {
        const style = { animationDelay: `${(t * 2.4 - 2.4).toFixed(3)}s`, opacity: lit ? 1 : 0.14 } as CSSProperties;
        cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={dot} height={dot} className="dm-scan" style={style} />);
      } else if (lit) {
        cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={dot} height={dot} />);
      } else {
        unlit += `M${x * cell} ${y * cell}h${dot}v${dot}h-${dot}z`;
      }
    }
  }
  return (
    <div role={state === "loading" ? "status" : undefined} className={cx("flex flex-col gap-3", className)}>
      <svg
        aria-hidden
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMinYMin slice"
        width="100%"
        height={h}
        shapeRendering="crispEdges"
        className="block text-ink"
      >
        {unlit ? <path d={unlit} className="fill-paper-shade" /> : null}
        <g fill="currentColor">{cells}</g>
      </svg>
      <p className="type-label m-0 text-ink-muted">{label}</p>
    </div>
  );
}
