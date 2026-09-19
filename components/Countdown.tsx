"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cx";
import { Numeral, type NumeralSize } from "./Numeral";

/* One shared one-second clock for every Countdown on the page. */
let clockNow = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  clockNow = Date.now();
  if (!timer) {
    timer = setInterval(() => {
      clockNow = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => clockNow;

export interface CountdownProps {
  /** The moment to count to (mode "down") or from (mode "up"), epoch ms. */
  target: number;
  /** The server's clock at render, so server and first client paint match. */
  serverNow: number;
  /** down = time left until target; up = time elapsed since target (e.g. on the clock for). */
  mode?: "down" | "up";
  /** Doto size step for the digits. Omit to size with digitClassName. */
  size?: NumeralSize;
  /** Classes for the digits, e.g. responsive sizes "text-d40 md:text-d80". */
  digitClassName?: string;
  /** Unit captions under each group (default true). */
  units?: boolean;
  /** Unlit dots behind the digits. */
  ghost?: boolean;
  /** What to render once a "down" countdown reaches zero. Defaults to zeros. */
  expired?: ReactNode;
  /** Accessible description, e.g. "Draft starts Friday Sep 18 at 9:00 PM ET". */
  label: string;
  className?: string;
}

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** A scoreboard clock in Doto digits: DD HH:MM:SS, ticking every second. */
export function Countdown({
  target,
  serverNow,
  mode = "down",
  size,
  digitClassName,
  units = true,
  ghost = false,
  expired,
  label,
  className,
}: CountdownProps) {
  const now = useSyncExternalStore(subscribe, getSnapshot, () => serverNow);
  const diff = mode === "down" ? target - now : now - target;
  if (mode === "down" && diff <= 0 && expired) return <>{expired}</>;
  const p = parts(diff);
  const groups: Array<{ v: number; unit: string }> = [
    ...(p.days > 0 ? [{ v: p.days, unit: p.days === 1 ? "Day" : "Days" }] : []),
    { v: p.hours, unit: "Hrs" },
    { v: p.minutes, unit: "Min" },
    { v: p.seconds, unit: "Sec" },
  ];
  return (
    <div role="timer" aria-label={label} className={cx("inline-flex items-start", className)}>
      {groups.map((g, i) => (
        <div key={g.unit} className="flex items-start">
          {i > 0 ? (
            <span aria-hidden>
              <Numeral value=":" size={size} tone="muted" className={digitClassName} />
            </span>
          ) : null}
          <div className="flex flex-col items-start gap-2">
            <Numeral value={g.v} pad={2} size={size} ghost={ghost} className={digitClassName} />
            {units ? <span className="type-label text-ink-muted">{g.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
