"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export interface AutoRefreshProps {
  /** Refresh the server components every N seconds (default 60). */
  seconds?: number;
  /** Only runs while true: live games, a live draft. */
  enabled: boolean;
}

/** Re-renders the page's server data on an interval while something is live and the tab is visible. */
export function AutoRefresh({ seconds = 60, enabled }: AutoRefreshProps) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [enabled, seconds, router]);
  return null;
}
