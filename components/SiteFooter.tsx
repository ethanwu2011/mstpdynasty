import Link from "next/link";
import { BrandMark } from "./BrandMark";

/** One ruled line at the bottom of every page. */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <p className="type-label m-0 flex flex-wrap items-center gap-x-5 gap-y-2 text-ink-muted">
        <span className="flex items-center gap-2 text-ink">
          <BrandMark size={16} />
          MSTP Dynasty
        </span>
        <span>Written by The Roast</span>
        <span>Data from Sleeper, ESPN and FantasyCalc</span>
        <span>All times Eastern</span>
        <Link href="/subscribe" className="link-ink px-0.5 text-ink">
          Get the emails
        </Link>
      </p>
    </footer>
  );
}
