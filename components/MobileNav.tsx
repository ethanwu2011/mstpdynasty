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

/** Bottom-fixed four-item pixel nav for phones. The fourth item opens every other page. */
export function MobileNav({ focus }: MobileNavProps) {
  const pathname = usePathname() ?? "/";
  // The sheet is open only on the path it was opened on, so any navigation closes it.
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
            className="tex-halftone fixed inset-0 z-30 block cursor-default [--tex-dot:1.6px] [--tex-pitch:5px]"
          />
          <div
            id="more-sheet"
            className="on-ink fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t-2 border-paper bg-ink text-paper"
          >
            <ul className="m-0 grid list-none grid-cols-2 gap-[2px] bg-paper p-0 pb-[2px]">
              {rest.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href} className="flex [&:last-child:nth-child(odd)]:col-span-2">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "type-label flex min-h-13 w-full items-center gap-3 px-4 no-underline focus-visible:outline-offset-[-4px]",
                        active ? "bg-paper text-ink focus-visible:outline-ink" : "bg-ink text-paper",
                      )}
                    >
                      <PixelIcon glyph={item.glyph} dot={2} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="p-4">
              <Link
                href="/subscribe"
                className="type-label flex min-h-12 w-full items-center justify-center gap-2 border-2 border-paper bg-red text-on-red no-underline"
              >
                Subscribe to the roast
                <PixelArrow />
              </Link>
            </div>
          </div>
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
