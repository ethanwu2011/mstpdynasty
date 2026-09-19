import { cx } from "./cx";

/*
 * Ordered-dither dot fields drawn in SVG. Square dots on a fixed cell (9px by default,
 * the board's dot matrix), lit wherever a ramp beats the 8x8 Bayer threshold. This is
 * the halftone screen of the specimen board, built from data instead of a raster.
 */

export const BAYER8: readonly (readonly number[])[] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** Bayer threshold for a cell, in (0, 1). */
export function bayer(x: number, y: number): number {
  return (BAYER8[y % 8][x % 8] + 0.5) / 64;
}

export type DitherRamp = "ltr" | "rtl" | "ttb" | "btt" | "diagonal" | "radial" | "flat";

/** Ramp value in 0..1 at a cell. */
export function rampAt(ramp: DitherRamp, x: number, y: number, cols: number, rows: number): number {
  const fx = cols > 1 ? x / (cols - 1) : 0;
  const fy = rows > 1 ? y / (rows - 1) : 0;
  switch (ramp) {
    case "ltr":
      return fx;
    case "rtl":
      return 1 - fx;
    case "ttb":
      return fy;
    case "btt":
      return 1 - fy;
    case "diagonal":
      return (fx + fy) / 2;
    case "radial": {
      const dx = fx - 0.5;
      const dy = fy - 0.5;
      return 1 - Math.min(1, Math.hypot(dx, dy) / 0.7071);
    }
    case "flat":
      return 1;
  }
}

export interface DitherProps {
  cols: number;
  rows: number;
  /** Cell pitch in px (default 9). */
  cell?: number;
  /** Lit dot size in px (default cell - 3). */
  dot?: number;
  ramp?: DitherRamp;
  /** Density at the start and end of the ramp, 0..1. */
  from?: number;
  to?: number;
  /** Ramp exponent: > 1 keeps the field sparse longer. */
  curve?: number;
  className?: string;
}

/** A dithered halftone block: the texture block in the top bar, bar fills, empty-state art. */
export function Dither({ cols, rows, cell = 9, dot, ramp = "ltr", from = 0, to = 1, curve = 1, className }: DitherProps) {
  const size = dot ?? Math.max(1, cell - 3);
  let d = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = from + (to - from) * Math.pow(rampAt(ramp, x, y, cols, rows), curve);
      if (v > bayer(x, y)) d += `M${x * cell} ${y * cell}h${size}v${size}h-${size}z`;
    }
  }
  const w = cols * cell;
  const h = rows * cell;
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} width={w} height={h} shapeRendering="crispEdges" className={cx("block shrink-0", className)}>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
