import { Button } from "./Button";
import { cx } from "./cx";

export interface FilterLink {
  href: string;
  label: string;
  /** Shown after the label in tabular digits. */
  count?: number;
  selected?: boolean;
}

export interface FilterLinksProps {
  items: FilterLink[];
  /** Accessible name of the group ("Filter by kind"). */
  label: string;
  className?: string;
}

/**
 * A row of filter links drawn as small secondary buttons. The selected one is filled ink and
 * carries aria-current. Links, not client state: every filter is a URL you can share.
 */
export function FilterLinks({ items, label, className }: FilterLinksProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {items.map((item) => (
          <li key={item.href}>
            <Button
              href={item.href}
              size="sm"
              selected={item.selected}
              aria-current={item.selected ? "true" : undefined}
              className="gap-2.5"
            >
              {item.label}
              {item.count !== undefined ? (
                <span className={cx("tnum font-sans text-fine font-bold", item.selected ? "text-paper" : "text-ink")}>
                  {item.count}
                </span>
              ) : null}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
