import type { ReactNode } from "react";
import { cx } from "./cx";
import { LiveSquare } from "./Tag";

export interface DataColumn<T> {
  key: string;
  /** Silkscreen header text. */
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Extra classes for this column's cells (e.g. "w-full" to let one column take the slack). */
  className?: string;
  /** Hide below md (keep the phone table to the columns that matter). */
  hideOnPhone?: boolean;
}

/** leader = bold row; last = red square + "Last place" for screen readers; alarm = red square only. */
export type RowMark = "leader" | "last" | "alarm" | null;

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Accessible name of the table and its scroll region. */
  caption: string;
  /** Show the caption visually (default false: the panel header already says it). */
  showCaption?: boolean;
  /** leader = bold row; last = last place (red square); alarm = red square (the worst shame entry). */
  mark?: (row: T, index: number) => RowMark;
  /** Anchor id per row (for permalinks such as /trades#trade-123). */
  rowId?: (row: T, index: number) => string | undefined;
  /** Minimum table width in px before it scrolls sideways (default 560). */
  minWidth?: number;
  /** Tighter rows for strips (default false). */
  dense?: boolean;
  /** Shown instead of the table when rows is empty. */
  empty?: ReactNode;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * A real table: Silkscreen headers on an ink bar, grotesk tabular data, zebra rows in paper
 * shade. The first column is pinned and the table scrolls sideways inside its panel on phones.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  showCaption = false,
  mark,
  rowId,
  minWidth = 560,
  dense = false,
  empty,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const cellPad = dense ? "px-3 py-2" : "px-3 py-3";
  return (
    <div role="region" aria-label={caption} tabIndex={0} className={cx("w-full overflow-x-auto overscroll-x-contain", className)}>
      <table className="type-data w-full border-collapse" style={{ minWidth }}>
        <caption className={showCaption ? "type-label px-3 py-2 text-left text-ink-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr className="bg-ink text-paper">
            {columns.map((c, ci) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  "type-label whitespace-nowrap border-t-2 border-paper px-3 py-2.5 font-normal",
                  ALIGN[c.align ?? "left"],
                  ci === 0 && "sticky left-0 z-[2] bg-ink",
                  c.hideOnPhone && "hidden md:table-cell",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const m = mark?.(row, ri) ?? null;
            return (
              <tr key={rowKey(row, ri)} id={rowId?.(row, ri)} className={cx("even:bg-paper-shade odd:bg-paper", m === "leader" && "font-bold")}>
                {columns.map((c, ci) => {
                  const Cell = ci === 0 ? "th" : "td";
                  return (
                    <Cell
                      key={c.key}
                      scope={ci === 0 ? "row" : undefined}
                      className={cx(
                        cellPad,
                        "align-middle",
                        ci === 0 ? "sticky left-0 z-[1] whitespace-nowrap bg-inherit text-left font-[inherit] shadow-[inset_-1px_0_0_var(--color-ink)]" : ALIGN[c.align ?? "left"],
                        c.className,
                        c.hideOnPhone && "hidden md:table-cell",
                      )}
                    >
                      {ci === 0 && (m === "last" || m === "alarm") ? (
                        <span className="inline-flex items-center gap-2">
                          <LiveSquare size={10} />
                          {m === "last" ? <span className="sr-only">Last place: </span> : null}
                          {c.cell(row, ri)}
                        </span>
                      ) : (
                        c.cell(row, ri)
                      )}
                    </Cell>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
