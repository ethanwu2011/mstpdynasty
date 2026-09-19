"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./cx";
import { isActive, NAV } from "./nav";

/** Desktop nav: Silkscreen caps on the ink bar; the current page is a paper box. */
export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  return (
    <ul className={cx("no-scrollbar m-0 flex min-w-0 list-none items-stretch overflow-x-auto p-0", className)}>
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href} className="flex">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "type-label flex items-center whitespace-nowrap px-2.5 py-3 no-underline focus-visible:outline-offset-[-4px] lg:px-4",
                active ? "bg-paper text-ink focus-visible:outline-ink" : "text-paper hover:bg-paper-shade hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
