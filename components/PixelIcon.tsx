import { cx } from "./cx";

/*
 * Nav glyphs drawn on a 5x5 dot grid, in the board's own grammar. No stock icons.
 * "#" is a lit dot.
 */
const GLYPHS = {
  home: ["..#..", ".###.", "#####", ".#.#.", ".###."],
  scores: ["##.##", "##.##", ".....", "##.##", "##.##"],
  draft: ["#.#.#", ".....", "#.#.#", ".....", "#.#.#"],
  standings: ["#####", ".....", "####.", ".....", "###.."],
  odds: ["....#", "...##", "..###", ".####", "#####"],
  shame: [".....", ".###.", ".###.", ".###.", "....."],
  trades: ["...#.", "#####", ".....", "#####", ".#..."],
  issues: ["#####", ".....", "#####", ".....", "###.."],
  more: [".....", ".....", "#.#.#", ".....", "....."],
  close: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
} as const;

export type PixelGlyph = keyof typeof GLYPHS;

export interface PixelIconProps {
  glyph: PixelGlyph;
  /** Size of one dot in px (default 3, so the glyph is 15px). */
  dot?: 2 | 3 | 4;
  className?: string;
}

export function PixelIcon({ glyph, dot = 3, className }: PixelIconProps) {
  const rows = GLYPHS[glyph];
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return (
    <svg aria-hidden viewBox="0 0 5 5" width={5 * dot} height={5 * dot} shapeRendering="crispEdges" className={cx("block shrink-0", className)}>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
