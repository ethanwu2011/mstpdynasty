/**
 * Email rendering. One text-first HTML email per issue plus a plain-text part.
 *
 * Design: single column, serif body, the league name in spaced capitals at the top, no
 * images, no colored buttons, links are plain underlined text. Tables are thin-ruled.
 *
 * Every string that reaches the HTML goes through escapeHtml(): issue text is built from
 * Sleeper team names, display names and nicknames, which are user-controlled. Control and
 * bidi-override characters are stripped from both parts, and the subject is forced onto
 * one line.
 */
import { etToMs, formatEt } from "@/lib/time";
import type { Issue, IssueBlock } from "@/lib/types";

export const LEAGUE_NAME = "MSTP Dynasty";
export const BYLINE = "The Roast";

const INK = "#1a1a1a";
const MUTED = "#5f5f5f";
const RULE = "#e3e1db";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Plain text with CR normalized and control / bidi-override characters removed. */
export function cleanText(input: unknown): string {
  const s = input === null || input === undefined ? "" : String(input);
  return s.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(BIDI, "");
}

/** Escape for HTML text and attribute values. */
export function escapeHtml(input: unknown): string {
  return cleanText(input).replace(/[&<>"']/g, (ch) => ESC[ch]);
}

function oneLine(input: unknown): string {
  return cleanText(input).replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 3);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}...`;
}

/** "Tuesday, September 29" for an ET "YYYY-MM-DD" date (falls back to the raw string). */
export function issueDateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return oneLine(date);
  const ms = etToMs(Number(m[1]), Number(m[2]), Number(m[3]), 12);
  return formatEt(ms, { weekday: "long", month: "long", day: "numeric" });
}

function metaLine(issue: Issue): string {
  const parts = [`By ${BYLINE}`, issueDateLabel(issue.date)];
  if (issue.week) parts.push(`Week ${issue.week}`);
  return parts.join(" \u00b7 ");
}

/**
 * The sender is already "The Roast", so a dek the model wrote is the whole subject (it is
 * written to be one). A code-written dek is a plain fact line, so it gets the issue title and
 * week in front: "The Weekly Roast, week 9: <fact>" (one colon), or "Draft Grades. <fact>".
 */
export function issueSubject(issue: Issue, review = false): string {
  const title = oneLine(issue.title);
  const dek = oneLine(issue.dek);
  const lead = issue.week ? `${title}, week ${issue.week}` : title;
  const base = truncate(dek && issue.dekSource === "model" && !issue.factsOnly ? dek : dek ? `${lead}${issue.week ? ":" : "."} ${dek}` : lead, 140);
  return review ? `[Review] ${base}` : base;
}

export interface IssueEmailOptions {
  /** Signed unsubscribe link for this recipient (every email carries one). */
  unsubscribeUrl: string;
  /** Review copy: signed approve link shown at the top. */
  approveUrl?: string | null;
  /** Public page for the issue (omitted on review copies: it is not published yet). */
  webUrl?: string | null;
  /** How long the approve link lives, for the note next to it. */
  approveValidDays?: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/* ------------------------------- HTML ------------------------------- */

const isNumeric = (v: string | number) => typeof v === "number" || /^[-+]?[$]?\d[\d,]*(\.\d+)?%?$/.test(String(v).trim());

function cellText(v: string | number): string {
  return typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : cleanText(v);
}

function htmlParagraphText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function htmlBlock(block: IssueBlock): string {
  switch (block.type) {
    case "heading":
      return `<h3 style="margin:22px 0 8px;font-size:17px;line-height:1.35;font-weight:bold;color:${INK};">${escapeHtml(block.text)}</h3>`;
    case "paragraph":
      return `<p style="margin:0 0 14px;">${htmlParagraphText(block.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 14px;font-style:italic;color:${MUTED};">${htmlParagraphText(block.text)}</p>`;
    case "list":
      return `<ul style="margin:0 0 14px;padding:0 0 0 20px;">${block.items
        .map((item) => `<li style="margin:0 0 6px;">${htmlParagraphText(item)}</li>`)
        .join("")}</ul>`;
    case "table": {
      const numericCol = block.columns.map((_, c) => block.rows.length > 0 && block.rows.every((r) => r[c] === undefined || r[c] === "" || isNumeric(r[c])));
      const align = (c: number) => (numericCol[c] ? "right" : "left");
      const pad = (c: number) => (c === block.columns.length - 1 ? "0" : "0 10px 0 0");
      const head = block.columns
        .map(
          (col, c) =>
            `<th align="${align(c)}" style="text-align:${align(c)};padding:${pad(c)};padding-bottom:4px;border-bottom:1px solid ${INK};font-size:13px;font-weight:bold;">${escapeHtml(col)}</th>`,
        )
        .join("");
      const body = block.rows
        .map(
          (row) =>
            `<tr>${block.columns
              .map((_, c) => {
                const v = row[c] ?? "";
                return `<td align="${align(c)}" style="text-align:${align(c)};padding:${pad(c)};padding-top:5px;padding-bottom:5px;border-bottom:1px solid ${RULE};font-variant-numeric:tabular-nums;vertical-align:top;">${escapeHtml(cellText(v))}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("");
      const caption = block.caption
        ? `<p style="margin:0 0 6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${escapeHtml(block.caption)}</p>`
        : "";
      return `${caption}<table role="table" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:0 0 18px;font-size:14px;line-height:1.4;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
  }
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

export function renderIssueHtml(issue: Issue, opts: IssueEmailOptions): string {
  const review = Boolean(opts.approveUrl);
  const preheader = oneLine(issue.dek) || oneLine(issue.title);
  const parts: string[] = [];

  parts.push(
    `<p style="margin:0 0 18px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(LEAGUE_NAME)}</p>`,
    `<h1 style="margin:0 0 6px;font-size:28px;line-height:1.2;font-weight:bold;color:${INK};">${escapeHtml(issue.title)}</h1>`,
  );
  if (oneLine(issue.dek)) parts.push(`<p style="margin:0 0 10px;font-size:19px;line-height:1.4;font-style:italic;">${escapeHtml(issue.dek)}</p>`);
  parts.push(`<p style="margin:0 0 26px;font-size:13px;color:${MUTED};">${escapeHtml(metaLine(issue))}</p>`);

  if (review && opts.approveUrl) {
    const days = opts.approveValidDays ?? 7;
    parts.push(
      `<div style="border:1px solid ${INK};padding:12px 14px;margin:0 0 26px;">` +
        `<p style="margin:0 0 6px;font-weight:bold;">Review copy. Nothing has gone to the league yet.</p>` +
        `<p style="margin:0;">${link(opts.approveUrl, "Approve and send to the league")} <span style="color:${MUTED};">(works once, for ${days} days)</span></p>` +
        `</div>`,
    );
  }

  if (issue.note) parts.push(`<p style="margin:0 0 18px;font-style:italic;color:${MUTED};">${htmlParagraphText(issue.note)}</p>`);

  for (const section of issue.sections) {
    if (oneLine(section.heading)) {
      parts.push(`<h2 style="margin:30px 0 10px;font-size:21px;line-height:1.3;font-weight:bold;color:${INK};">${escapeHtml(section.heading)}</h2>`);
    }
    for (const block of section.blocks) parts.push(htmlBlock(block));
  }

  parts.push(`<hr style="border:0;border-top:1px solid ${RULE};margin:34px 0 16px;">`);
  if (opts.webUrl) parts.push(`<p style="margin:0 0 8px;font-size:13px;color:${MUTED};">${link(opts.webUrl, "Read it on the site")}</p>`);
  parts.push(
    `<p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(`${BYLINE} writes this for ${LEAGUE_NAME}.`)} ${link(opts.unsubscribeUrl, "Unsubscribe")}, in case you can't take it.</p>`,
  );

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(issue.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:#ffffff;color:${INK};">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 16px 40px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td style="font-family:${SERIF};font-size:17px;line-height:1.6;color:${INK};text-align:left;">`,
    parts.join("\n"),
    "</td></tr></table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");
}

/* ---------------------------- plain text ---------------------------- */

function textTable(columns: string[], rows: Array<Array<string | number>>): string {
  const cells = [columns.map(oneLine), ...rows.map((r) => columns.map((_, c) => oneLine(cellText(r[c] ?? ""))))];
  const numericCol = columns.map((_, c) => rows.length > 0 && rows.every((r) => r[c] === undefined || r[c] === "" || isNumeric(r[c])));
  const widths = columns.map((_, c) => Math.max(...cells.map((row) => row[c].length)));
  const fmt = (row: string[]) =>
    row
      .map((v, c) => (numericCol[c] ? v.padStart(widths[c]) : v.padEnd(widths[c])))
      .join("  ")
      .replace(/\s+$/, "");
  const [head, ...body] = cells;
  return [fmt(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(fmt)].join("\n");
}

function textBlock(block: IssueBlock): string {
  switch (block.type) {
    case "heading":
      return oneLine(block.text).toUpperCase();
    case "paragraph":
      return cleanText(block.text).trim();
    case "note":
      return `(${cleanText(block.text).trim()})`;
    case "list":
      return block.items.map((i) => `- ${cleanText(i).trim().replace(/\n/g, "\n  ")}`).join("\n");
    case "table":
      return [block.caption ? oneLine(block.caption).toUpperCase() : null, textTable(block.columns, block.rows)].filter(Boolean).join("\n");
  }
}

export function renderIssueText(issue: Issue, opts: IssueEmailOptions): string {
  const out: string[] = [];
  out.push(LEAGUE_NAME.toUpperCase(), "", oneLine(issue.title));
  if (oneLine(issue.dek)) out.push(oneLine(issue.dek));
  out.push(metaLine(issue), "");
  if (opts.approveUrl) {
    const days = opts.approveValidDays ?? 7;
    out.push("REVIEW COPY. Nothing has gone to the league yet.", `Approve and send to the league (works once, for ${days} days):`, opts.approveUrl, "");
  }
  if (issue.note) out.push(`(${cleanText(issue.note).trim()})`, "");
  for (const section of issue.sections) {
    const h = oneLine(section.heading);
    if (h) out.push(h.toUpperCase(), "=".repeat(Math.min(h.length, 60)), "");
    for (const block of section.blocks) out.push(textBlock(block), "");
  }
  out.push("--");
  if (opts.webUrl) out.push(`Read it on the site: ${opts.webUrl}`);
  out.push(`${BYLINE} writes this for ${LEAGUE_NAME}.`, `Unsubscribe (in case you can't take it): ${opts.unsubscribeUrl}`);
  return out.join("\n");
}

export function renderIssueEmail(issue: Issue, opts: IssueEmailOptions): RenderedEmail {
  return {
    subject: issueSubject(issue, Boolean(opts.approveUrl)),
    html: renderIssueHtml(issue, opts),
    text: renderIssueText(issue, opts),
  };
}

/* ------------------------ confirmation email ------------------------ */

export function renderConfirmEmail(opts: { confirmUrl: string; managerName: string; validDays: number }): RenderedEmail {
  const name = oneLine(opts.managerName);
  const subject = `Confirm your subscription to ${BYLINE}`;
  const lines = [
    `You asked to get ${BYLINE}, the ${LEAGUE_NAME} newsletter, at this address (signed up as ${name}).`,
    "Confirm and you're in. If this wasn't you, ignore this email and nothing happens.",
  ];
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#ffffff;color:${INK};">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:28px 16px 40px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td style="font-family:${SERIF};font-size:17px;line-height:1.6;color:${INK};text-align:left;">`,
    `<p style="margin:0 0 18px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(LEAGUE_NAME)}</p>`,
    ...lines.map((l) => `<p style="margin:0 0 14px;">${escapeHtml(l)}</p>`),
    `<p style="margin:0 0 14px;">${link(opts.confirmUrl, "Confirm my subscription")}</p>`,
    `<p style="margin:0;font-size:13px;color:${MUTED};">${escapeHtml(`The link expires in ${opts.validDays} days.`)}</p>`,
    "</td></tr></table></td></tr></table></body></html>",
  ].join("\n");
  const text = [LEAGUE_NAME.toUpperCase(), "", ...lines, "", `Confirm my subscription: ${opts.confirmUrl}`, "", `The link expires in ${opts.validDays} days.`].join("\n");
  return { subject, html, text };
}
