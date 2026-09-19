import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary";

interface ButtonCommon {
  children: ReactNode;
  /** primary = scoreboard red (the one main action on a screen); secondary = paper. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Selected state for secondary toggles: ink fill, paper text. */
  selected?: boolean;
  /** Sitting on an ink surface: the hard shadow flips to paper. */
  onInk?: boolean;
  className?: string;
}

export type ButtonAsLink = ButtonCommon & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;
export type ButtonAsButton = ButtonCommon & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
export type ButtonProps = ButtonAsLink | ButtonAsButton;

function classes({ variant = "secondary", size = "md", selected = false, onInk = false, className }: ButtonCommon): string {
  return cx(
    "type-label pressable inline-flex items-center justify-center gap-2 border-2 border-ink whitespace-nowrap no-underline",
    "disabled:pointer-events-none disabled:border-ink-muted disabled:bg-paper-shade disabled:text-ink-muted",
    size === "md" ? "min-h-12 px-5 py-3" : "min-h-9 px-3 py-2",
    variant === "primary" ? "bg-red text-on-red" : selected ? "bg-ink text-paper" : "bg-paper text-ink",
    onInk && "[--pressable-shadow:var(--shadow-hard-paper)]",
    className,
  );
}

/** Pixel arrow, drawn on the 1px grid. */
export function PixelArrow({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" className={cx("shrink-0", className)}>
      <path fill="currentColor" d="M3 0h1v1H3zM4 1h1v1H4zM5 2h1v1H5zM0 3h7v1H0zM5 4h1v1H5zM4 5h1v1H4zM3 6h1v1H3z" />
    </svg>
  );
}

/**
 * Square button with a 2px ink border. Hover and keyboard focus lift it up-left onto a hard
 * 4px shadow; pressing sits it flush. Pass `href` to render a Next link.
 */
export function Button(props: ButtonProps) {
  const { children, variant, size, selected, onInk, className, ...rest } = props;
  const cls = classes({ children, variant, size, selected, onInk, className });
  if (typeof rest.href === "string") {
    const { href, ...anchor } = rest as Omit<ButtonAsLink, keyof ButtonCommon>;
    return (
      <Link href={href} className={cls} {...anchor}>
        {children}
      </Link>
    );
  }
  const { type = "button", ...button } = rest as Omit<ButtonAsButton, keyof ButtonCommon>;
  return (
    <button type={type} className={cls} aria-pressed={selected === undefined || variant === "primary" ? undefined : selected} {...button}>
      {children}
    </button>
  );
}
