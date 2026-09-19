/**
 * One issue, the same content as the email: a pixel masthead, then every section under its own
 * header bar in a 68ch grotesk column, with the table of contents and the subscribe link beside it.
 * Issue text is plain (no HTML, no markdown), so it renders exactly as the facts engine wrote it.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, PixelArrow } from "@/components/Button";
import { cx } from "@/components/cx";
import { DataTable } from "@/components/DataTable";
import { Dither } from "@/components/Dither";
import { HeaderBar } from "@/components/HeaderBar";
import { Board, Panel } from "@/components/Panel";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import type { Issue, IssueBlock, IssueSection } from "@/lib/types";
import { CADENCE, dayLabel, issueName, WHEN } from "../issue-kinds";

export interface IssueViewProps {
  issue: Issue;
  older: Issue | null;
  newer: Issue | null;
}

function sectionId(s: IssueSection, i: number): string {
  const slug = s.heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `s${i + 1}-${slug || "section"}`;
}

/* ------------------------------ blocks ------------------------------ */

type Cell = string | number;

const NUMERIC = /^[-+]?\$?\d[\d,]*(\.\d+)?%?$/;
const isNumeric = (v: Cell) => typeof v === "number" || NUMERIC.test(String(v).trim());
const cellText = (v: Cell) =>
  typeof v === "number" ? (Number.isFinite(v) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) : "") : v;

function IssueTable({ block, fallbackCaption }: { block: Extract<IssueBlock, { type: "table" }>; fallbackCaption: string }) {
  const numeric = block.columns.map(
    (_, c) => block.rows.length > 0 && block.rows.every((r) => r[c] === undefined || r[c] === "" || isNumeric(r[c])),
  );
  return (
    <div className="-mx-4 border-y-2 border-ink md:-mx-8">
      <DataTable<Cell[]>
        caption={block.caption ?? fallbackCaption}
        showCaption={Boolean(block.caption)}
        rows={block.rows}
        rowKey={(_, i) => String(i)}
        dense
        minWidth={Math.max(320, block.columns.length * 110)}
        columns={block.columns.map((col, c) => ({
          key: `${c}-${col}`,
          header: col,
          // The pinned first column always reads left, header included.
          align: numeric[c] && c > 0 ? ("right" as const) : ("left" as const),
          className: cx(numeric[c] && "whitespace-nowrap", c === 0 && "font-semibold"),
          cell: (row: Cell[]) => cellText(row[c] ?? ""),
        }))}
      />
    </div>
  );
}

function Block({ block, caption, first }: { block: IssueBlock; caption: string; first: boolean }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p className="measure m-0 text-body">{block.text}</p>;
    case "heading":
      return (
        <h3 className={cx("measure m-0 text-lede font-bold leading-snug", !first && "mt-3 border-t-2 border-ink pt-5")}>{block.text}</h3>
      );
    case "list":
      return (
        <ul className="measure m-0 flex list-none flex-col gap-2 p-0 text-body">
          {block.items.map((item, i) => (
            <li key={i} className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-2">
              <span aria-hidden className="mt-[0.62em] block size-1.5 bg-ink" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return <IssueTable block={block} fallbackCaption={caption} />;
    case "note":
      return (
        <p className="measure m-0 flex items-baseline gap-2.5 text-fine text-ink-muted">
          <span className="type-label shrink-0 text-ink">Note</span>
          <span>{block.text}</span>
        </p>
      );
  }
}

function Section({ section, index }: { section: IssueSection; index: number }) {
  const id = sectionId(section, index);
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="scroll-mt-4">
      <HeaderBar as="h2" id={`${id}-h`} label={section.heading} className={index > 0 ? "border-t-2 border-paper" : undefined} />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
        {section.blocks.map((b, i) => (
          <Block key={i} block={b} caption={section.heading} first={i === 0} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ masthead ------------------------------ */

function Masthead({ issue }: { issue: Issue }) {
  const sent = issue.sentAt ? `Sent to ${issue.recipientCount ?? 0} ${issue.recipientCount === 1 ? "inbox" : "inboxes"}` : null;
  return (
    <Panel
      label="The newsletter"
      labelRight={<span className="text-paper-shade">{issue.week ? `Week ${issue.week}` : `${issue.season} season`}</span>}
      pad={false}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-7 md:px-8 md:pb-8 md:pt-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="type-label m-0">{CADENCE[issue.kind]}</p>
            {issue.placeholder ? <SampleMark /> : issue.factsOnly && !issue.note ? <Tag tone="outline">Facts only</Tag> : null}
          </div>
          <h1 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
            <span className="board-wipe block">{issue.title}</span>
          </h1>
          {issue.dek ? <p className="measure m-0 text-lede font-semibold">{issue.dek}</p> : null}
          <p className="type-label m-0 flex flex-wrap items-center gap-x-3 gap-y-2">
            <LiveSquare size={12} />
            <time dateTime={issue.date}>{dayLabel(issue)}</time>
            <span className="text-ink-muted">By The Roast</span>
            {sent ? <span className="text-ink-muted">{sent}</span> : null}
          </p>
        </div>
        <div aria-hidden className="hidden items-end justify-end p-8 text-ink lg:flex">
          <Dither cols={30} rows={14} cell={9} ramp="radial" from={0.04} to={0.9} curve={1.4} />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ neighbors ------------------------------ */

function Neighbor({ issue, label, align }: { issue: Issue; label: string; align: "left" | "right" }) {
  return (
    <Link
      href={`/newsletter/${issue.slug}`}
      className={cx(
        "group flex h-full flex-col gap-2 px-4 pb-6 pt-6 no-underline hover:bg-paper-shade focus-visible:outline-offset-[-4px] md:px-8",
        align === "right" && "md:items-end md:text-right",
      )}
    >
      <span className="type-label flex items-center gap-2 text-ink-muted">
        {align === "left" ? <PixelArrow className="rotate-180" /> : null}
        {label} · {dayLabel(issue)}
        {align === "right" ? <PixelArrow /> : null}
      </span>
      <span className="type-display text-j2 group-hover:underline group-hover:decoration-4">{issue.title}</span>
      {issue.dek ? <span className="measure text-data text-ink-muted">{issue.dek}</span> : null}
    </Link>
  );
}

/* ------------------------------ page ------------------------------ */

export function IssueView({ issue, older, newer }: IssueViewProps) {
  const sections = issue.sections.filter((s) => s.blocks.length > 0);
  return (
    <Board>
      <Masthead issue={issue} />

      <Panel as="article" span={8} pad={false}>
        {issue.note ? (
          <div className="px-4 pt-6 md:px-8 md:pt-8">
            <div role="note" className="measure flex flex-col gap-2 border-2 border-ink px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <Tag tone="ink" className="self-start sm:self-auto">
                {issue.factsOnly ? "Facts only" : "Note"}
              </Tag>
              <p className="m-0 text-data">{issue.note}</p>
            </div>
          </div>
        ) : null}
        {sections.length ? (
          <div className={cx(issue.note && "mt-6 md:mt-8")}>
            {sections.map((s, i) => (
              <Section key={i} section={s} index={i} />
            ))}
          </div>
        ) : (
          <p className="measure m-0 px-4 py-8 text-body md:px-8">This issue went out with no sections.</p>
        )}
      </Panel>

      <Panel label="In this issue" span={4} pad={false}>
        <div className="flex flex-1 flex-col lg:sticky lg:top-0 lg:w-full lg:flex-none lg:self-start">
          <nav aria-label="Sections" className="hidden lg:block">
            <ol className="m-0 list-none p-0">
              {sections.map((s, i) => (
                <li key={i} className="border-b border-ink">
                  <a
                    href={`#${sectionId(s, i)}`}
                    className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-2 px-4 py-2.5 text-data no-underline hover:bg-paper-shade focus-visible:outline-offset-[-4px] xl:px-6"
                  >
                    <span className="tnum text-fine text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-semibold">{s.heading}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex flex-col gap-4 px-4 pb-6 pt-6 xl:px-6">
            <p className="type-display m-0 text-j2">Get it by email</p>
            <p className="m-0 text-data text-ink-muted">
              {issueName(issue.kind)} goes out {WHEN[issue.kind]}. Same words, in your inbox, with an unsubscribe link for when you
              can&apos;t take it.
            </p>
            <Button href="/subscribe" variant="primary" className="w-full">
              Subscribe to the roast
              <PixelArrow />
            </Button>
            <Link href="/newsletter" className="type-label link-ink self-start px-0.5">
              Every issue
            </Link>
          </div>
        </div>
      </Panel>

      {older || newer ? (
        <>
          {older ? (
            <Panel as="div" label="Older issue" span={newer ? 6 : 12} mdSpan={newer ? 6 : 12} pad={false}>
              <Neighbor issue={older} label="Older" align="left" />
            </Panel>
          ) : null}
          {newer ? (
            <Panel as="div" label="Newer issue" span={older ? 6 : 12} mdSpan={older ? 6 : 12} pad={false}>
              <Neighbor issue={newer} label="Newer" align="right" />
            </Panel>
          ) : null}
        </>
      ) : null}
    </Board>
  );
}
