"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PixelArrow } from "./Button";
import { cx } from "./cx";
import { isActive, NAV, type NavItem } from "./nav";
import { PixelIcon } from "./PixelIcon";

export interface MobileNavProps {
  /** Second slot: the draft board before and during the draft, scores in season. */
  focus: "draft" | "scores";
}

const byHref = (href: string) => NAV.find((n) => n.href === href) as NavItem;

/**
 * Phones: a bottom-fixed bar of four pixel labels. The fourth opens a plain list of every other
 * page: one page per row, solid paper, big targets, nothing behind the text.
 */
export function MobileNav({ focus }: MobileNavProps) {
  const pathname = usePathname() ?? "/";
  // The list is open only on the path it was opened on, so any navigation closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const bar = [byHref("/"), byHref(focus === "draft" ? "/draft" : "/scores"), byHref("/standings")];
  const rest = NAV.filter((n) => !bar.includes(n));
  const moreActive = rest.some((n) => isActive(pathname, n.href));

  return (
    <div className="md:hidden">
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setOpenOn(null)}
            className="fixed inset-0 z-30 block cursor-default bg-ink/60"
          />
          <nav
            id="more-sheet"
            aria-label="More pages"
            className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t-2 border-ink bg-paper text-ink"
          >
            <ul className="m-0 list-none p-0">
              {rest.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href} className="border-b border-ink last:border-b-0">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex min-h-14 items-center justify-between gap-4 px-4 text-[1.0625rem] font-bold no-underline focus-visible:outline-offset-[-4px]",
                        active ? "on-ink bg-ink text-paper" : "active:bg-paper-shade",
                      )}
                    >
                      {item.label}
                      <PixelArrow />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      ) : null}

      <nav aria-label="Main" className="on-ink fixed inset-x-0 bottom-0 z-50 border-t-2 border-paper bg-ink pb-[env(safe-area-inset-bottom)] text-paper">
        <ul className="m-0 grid list-none grid-cols-4 p-0">
          {bar.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-15 w-full flex-col items-center justify-center gap-2 no-underline focus-visible:outline-offset-[-4px]",
                    active ? "bg-paper text-ink focus-visible:outline-ink" : "text-paper",
                  )}
                >
                  <PixelIcon glyph={item.glyph} />
                  <span className="type-label tracking-normal">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button
              type="button"
              aria-expanded={open}
              aria-controls="more-sheet"
              onClick={() => setOpenOn(open ? null : pathname)}
              className={cx(
                "flex h-15 w-full flex-col items-center justify-center gap-2 focus-visible:outline-offset-[-4px]",
                open || moreActive ? "bg-paper text-ink focus-visible:outline-ink" : "text-paper",
              )}
            >
              <PixelIcon glyph={open ? "close" : "more"} />
              <span className="type-label tracking-normal">{open ? "Close" : "More"}</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
