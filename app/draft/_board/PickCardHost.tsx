"use client";

/**
 * The one roast card on the draft board. Every made pick is a button that shows this popover
 * (popovertarget, so it opens by tap, click or keyboard, never hover); the click fills it with
 * that pick's roast before it appears and anchors it to the pick on a wide screen. Escape, a
 * tap outside or Close hides it. /draft#pick-17 scrolls to pick 17 and opens its card.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { HeaderBar } from "@/components/HeaderBar";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import type { PickCardData } from "./card";
import s from "./board.module.css";

export const CARD_ID = "pick-card";

function buttonFor(n: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card="${n}"]`);
}

export function PickCardHost({ cards }: { cards: PickCardData[] }) {
  const byNo = useMemo(() => new Map(cards.map((c) => [c.pickNo, c])), [cards]);
  const [openNo, setOpenNo] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  // The live draft refreshes the page every 30 seconds: keep the listeners (and the one-time
  // hash jump) mounted once, reading the latest cards through a ref.
  const cardsRef = useRef(byNo);
  useEffect(() => {
    cardsRef.current = byNo;
  }, [byNo]);

  useEffect(() => {
    const card = ref.current;
    if (!card) return;

    const mark = (n: number | null) => {
      if (active.current !== null) buttonFor(active.current)?.removeAttribute("data-active");
      active.current = n;
      if (n !== null) buttonFor(n)?.setAttribute("data-active", "");
    };

    // Fill the card before the button's default action shows it.
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.<HTMLElement>("[data-card]");
      if (!btn) return;
      const n = Number(btn.dataset.card);
      if (!Number.isFinite(n)) return;
      flushSync(() => setOpenNo(n));
      mark(n);
    };

    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") mark(null);
    };

    const openFromHash = () => {
      const m = /^#pick-(\d+)$/.exec(window.location.hash);
      if (!m) return;
      const n = Number(m[1]);
      const cell = document.getElementById(`pick-${n}`);
      // On the grid, center the pick so its card has room; in the phone list, bring it to the top.
      cell?.scrollIntoView({ block: window.matchMedia("(min-width: 64rem)").matches ? "center" : "start" });
      if (!cardsRef.current.has(n) || typeof card.showPopover !== "function") return;
      // A microtask, so the synchronous fill never runs inside React's effect phase.
      queueMicrotask(() => {
        flushSync(() => setOpenNo(n));
        mark(n);
        try {
          if (!card.matches(":popover-open")) card.showPopover();
        } catch {
          // The pick is still scrolled into view.
        }
      });
    };

    document.addEventListener("click", onClick, true);
    card.addEventListener("toggle", onToggle);
    window.addEventListener("hashchange", openFromHash);
    openFromHash();
    return () => {
      document.removeEventListener("click", onClick, true);
      card.removeEventListener("toggle", onToggle);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, []);

  const c = openNo !== null ? (byNo.get(openNo) ?? null) : null;
  const style = { "--anchor": c ? `--pick-${c.pickNo}` : "none" } as CSSProperties;
  const paragraphs = c
    ? c.text
        .split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return (
    <div ref={ref} id={CARD_ID} popover="auto" role="dialog" aria-labelledby="pick-card-title" className={s.card} style={style}>
      <HeaderBar
        as="div"
        label={c ? `Pick ${c.label} · Round ${c.round}` : "Pick"}
        right={
          <button
            type="button"
            popoverTarget={CARD_ID}
            popoverTargetAction="hide"
            className="type-label -my-1 px-1 py-1 text-paper underline decoration-2 underline-offset-[3px] hover:bg-paper hover:text-ink"
          >
            Close
          </button>
        }
      />
      {c ? (
        <div className="flex flex-col gap-4 px-4 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Tag>{c.position}</Tag>
            <span className="font-bold">{c.player}</span>
            <span className="type-label text-ink-muted">{c.nflTeam}</span>
            {c.via ? <Tag tone="outline">Via {c.via}</Tag> : null}
            {c.source === "sample" ? <SampleMark /> : c.source === "facts" ? <Tag tone="outline">Facts only</Tag> : null}
          </div>

          <h4 id="pick-card-title" className="type-display m-0 break-words text-j2">
            <span className="block">{c.manager}</span>
            <span className="sr-only">: </span>
            <span className="block">{c.stat}</span>
          </h4>

          <div className="flex flex-col gap-2.5 text-body">
            {paragraphs.map((t, i) => (
              <p key={i} className="m-0">
                {t}
              </p>
            ))}
          </div>

          <dl className="m-0 grid grid-cols-2 border-y-2 border-ink">
            {c.receipt.map((r, i) => (
              <div key={r.label} className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 ${i % 2 ? "border-l border-ink" : ""} ${i >= 2 ? "border-t border-ink" : ""}`}>
                <dt className="type-label text-ink-muted">{r.label}</dt>
                <dd className="type-data m-0 truncate text-[1.0625rem] font-semibold">{r.value}</dd>
              </div>
            ))}
          </dl>

          <footer className="type-label flex flex-wrap items-center gap-x-3 gap-y-2">
            <LiveSquare size={12} />
            {c.atIso ? <time dateTime={c.atIso}>{c.atLabel}</time> : null}
            <span className="text-ink-muted">By {c.byline}</span>
            <span className="ml-auto flex gap-3">
              <Link href={`/teams/${c.rosterId}`} className="link-ink px-0.5">
                Team
              </Link>
              <a href={`#pick-${c.pickNo}`} className="link-ink px-0.5">
                Permalink
              </a>
            </span>
          </footer>
        </div>
      ) : (
        <p className="type-label m-0 px-4 py-5 text-ink-muted">Pick a square on the board to see its roast.</p>
      )}
    </div>
  );
}
