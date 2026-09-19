import type { PixelGlyph } from "./PixelIcon";

export interface NavItem {
  href: string;
  label: string;
  glyph: PixelGlyph;
}

/** Every top-level page, in nav order. */
export const NAV: readonly NavItem[] = [
  { href: "/", label: "Home", glyph: "home" },
  { href: "/scores", label: "Scores", glyph: "scores" },
  { href: "/standings", label: "Standings", glyph: "standings" },
  { href: "/teams", label: "Teams", glyph: "teams" },
  { href: "/odds", label: "Odds", glyph: "odds" },
  { href: "/draft", label: "Draft", glyph: "draft" },
  { href: "/trades", label: "Trades", glyph: "trades" },
  { href: "/shame", label: "Shame", glyph: "shame" },
  { href: "/newsletter", label: "Issues", glyph: "issues" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
