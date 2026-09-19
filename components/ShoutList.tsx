import { LiveSquare } from "./Tag";
import { Numeral } from "./Numeral";

export interface Shout {
  /** Silkscreen caption: "Luckiest", "Title favorite". */
  label: string;
  /** Who: a manager's first name, shouted in Jersey 10. */
  name: string;
  /** The number that earned it, in Doto ("+2.1", "31.2"). */
  value: string;
  /** Small unit after the number ("wins", "%"). */
  unit?: string;
  /** Accessible reading of value + unit when the digits alone are ambiguous. */
  valueLabel?: string;
  /** Red square: the shameful end of the board. */
  alarm?: boolean;
}

/**
 * Ruled lines of name-and-number, message-board style: the caption, the name in pixel caps,
 * the stat in dot-matrix digits. For the two or three facts a page is really about.
 */
export function ShoutList({ items, className }: { items: Shout[]; className?: string }) {
  if (!items.length) return null;
  return (
    <dl className={`m-0 border-t-2 border-ink ${className ?? ""}`}>
      {items.map((s) => (
        <div
          key={s.label}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-1 border-b border-ink py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
        >
          <dt className="type-label col-span-2 flex items-center gap-2 text-ink-muted sm:col-span-1 sm:self-center">
            {s.alarm ? <LiveSquare size={8} /> : null}
            {s.label}
          </dt>
          <dd className="type-display m-0 truncate text-j2">{s.name}</dd>
          <dd className="m-0 flex items-baseline gap-1.5">
            <Numeral value={s.value} size="d30" label={s.valueLabel ?? `${s.value}${s.unit ? ` ${s.unit}` : ""}`} />
            {s.unit ? (
              <span aria-hidden className="type-label text-ink-muted">
                {s.unit}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
