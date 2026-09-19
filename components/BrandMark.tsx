import { cx } from "./cx";

/** The pixel M with its red square, drawn on an 8x8 grid. Same drawing as public/favicon.svg. */
export function BrandMark({ size = 16, framed = true, className }: { size?: 16 | 24 | 32; framed?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 8 8" width={size} height={size} shapeRendering="crispEdges" className={cx("block shrink-0", className)}>
      {framed ? <rect width="8" height="8" className="fill-ink" /> : null}
      <path
        className={framed ? "fill-paper" : "fill-current"}
        d="M1 1h1v5H1zM5 1h1v5H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3z"
      />
      <rect x="6" y="6" width="1" height="1" className="fill-red" />
    </svg>
  );
}
