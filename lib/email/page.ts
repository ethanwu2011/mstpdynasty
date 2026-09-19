/**
 * Bare HTML pages for the signed-link routes (approve, unsubscribe, confirm). Deliberately
 * minimal and unstyled apart from a readable measure; the designer can restyle later.
 * Callers pass pre-escaped HTML for `body`.
 */
import { escapeHtml } from "./render";

export function htmlPage(title: string, body: string, status = 200): Response {
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{font-family:Georgia,'Times New Roman',serif;max-width:34rem;margin:3rem auto;padding:0 16px;line-height:1.55;color:#1a1a1a;background:#fff}button{font:inherit;padding:.4rem .9rem;cursor:pointer}</style>",
    "</head><body>",
    body,
    "</body></html>",
  ].join("\n");
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** A one-button POST form back to the same URL (link scanners only GET, so they never act). */
export function postButton(action: string, label: string, hidden: Record<string, string> = {}): string {
  const fields = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  return `<form method="post" action="${escapeHtml(action)}">${fields}<button type="submit">${escapeHtml(label)}</button></form>`;
}
