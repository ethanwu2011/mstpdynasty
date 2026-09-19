import Link from "next/link";
import { Button, PixelArrow } from "./Button";
import { Dither } from "./Dither";
import { NavLinks } from "./NavLinks";
import { LiveSquare, Tag } from "./Tag";

export interface HeaderStatus {
  /** "Week 9", "Startup draft", "Draft live", "Offseason". */
  primary: string;
  /** "2026 season", "Fri Sep 18 · 9:00 PM ET". */
  secondary?: string;
  /** Blinking red square: the draft or games are live. */
  live?: boolean;
}

export interface SiteHeaderProps {
  status: HeaderStatus;
  /** Any league other than MSTP (the RT fixture league in dev). */
  isDevLeague?: boolean;
}

/** The black top bar: MSTP DYNASTY in pixel caps, the week or draft status, a dithered texture block, and the desktop nav. */
export function SiteHeader({ status, isDevLeague = false }: SiteHeaderProps) {
  return (
    <header className="on-ink border-b-2 border-paper bg-ink text-paper">
      <div className="mx-auto flex max-w-[1440px] items-center gap-x-4 gap-y-2 px-4 pb-3 pt-3.5 max-sm:flex-wrap md:gap-x-6 md:px-6 md:py-4">
        <Link href="/" className="type-display shrink-0 text-j2 no-underline md:text-j3" aria-label="MSTP Dynasty, home">
          MSTP Dynasty
        </Link>

        <div className="order-3 flex min-w-0 basis-full items-center gap-3 sm:order-none sm:basis-auto sm:border-l-2 sm:border-paper sm:pl-4">
          {status.live ? <LiveSquare blink size={10} /> : null}
          <p className="type-label m-0 flex min-w-0 flex-wrap gap-x-2 sm:flex-col sm:gap-y-1 sm:whitespace-nowrap">
            <span className="text-paper">{status.primary}</span>
            {status.secondary ? (
              <span className="text-paper-shade">
                <span className="sm:hidden" aria-hidden>
                  ·{" "}
                </span>
                {status.secondary}
              </span>
            ) : null}
          </p>
          {isDevLeague ? (
            <Tag tone="alarm" title="LEAGUE_ID points at a dev league. Nothing here is published.">
              Dev league
            </Tag>
          ) : null}
        </div>

        <div className="ml-auto flex items-center text-paper">
          <Dither cols={12} rows={4} cell={6} ramp="ltr" curve={1.4} className="lg:hidden" />
          <Dither cols={24} rows={6} cell={8} ramp="ltr" curve={1.5} className="hidden lg:block xl:hidden" />
          <Dither cols={44} rows={6} cell={9} ramp="ltr" curve={1.6} className="hidden xl:block" />
        </div>
      </div>

      <nav aria-label="Main" className="hidden border-t-2 border-paper md:block">
        <div className="mx-auto flex max-w-[1440px] items-stretch justify-between gap-4 pl-1 pr-4 md:pr-6 lg:pl-2">
          <NavLinks />
          <div className="flex shrink-0 items-center py-1.5">
            <Button href="/subscribe" variant="primary" size="sm" onInk>
              Subscribe
              <PixelArrow />
            </Button>
          </div>
        </div>
      </nav>
    </header>
  );
}
