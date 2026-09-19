import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import s from "./MatrixLoading.module.css";

export interface MatrixLoadingProps {
  /** One plain line that says what is loading. */
  label: ReactNode;
  /** Rows of 9px dots (default 6). */
  rows?: number;
  className?: string;
}

/**
 * Loading state for route fallbacks: the dot matrix lighting up left to right in pixel steps.
 * CSS only, so a loading.tsx that ships with every page stays a few hundred bytes.
 */
export function MatrixLoading({ label, rows = 6, className }: MatrixLoadingProps) {
  return (
    <div role="status" className={cx("flex flex-col gap-3", className)}>
      <div aria-hidden className={s.field} style={{ "--rows": rows } as CSSProperties} />
      <p className="type-label m-0 text-ink-muted">{label}</p>
    </div>
  );
}
