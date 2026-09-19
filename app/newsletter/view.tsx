/** The newsletter archive: the latest issue up top, the four issues, then every issue by month. */
import Link from "next/link";
import { Button, PixelArrow } from "@/components/Button";
import { cx } from "@/components/cx";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { FilterLinks } from "@/components/FilterLinks";
import { Numeral } from "@/components/Numeral";
import { Board, Panel } from "@/components/Panel";
import { RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { SampleMark } from "@/components/Tag";
import { formatEt } from "@/lib/time";
import type { Issue, IssueKind, SeasonPhase } from "@/lib/types";
import { issueEvent, issueToBlock } from "../_lib/roast-view";
import { CADENCE, issueDay, issueLabel, ISSUE_ORDER, KIND_PLURAL, kindSlug, monthLabel } from "./issue-kinds";

export interface NewsletterViewProps {
  /** null when the archive could not be read. */
  issues: Issue[] | null;
  kind: IssueKind | null;
  phase: SeasonPhase;
  /** The week the recap is named by in lists ("Week 5 Recap"), from recapWeek(). */
  recapWeek: number;
}

const archiveHref = (k: IssueKind | null) => `/newsletter${k ? `?kind=${kindSlug(k)}` : ""}#archive`;

function nextIssueLine(phase: SeasonPhase, week: number): string {
  switch (phase) {
    case "pre_draft":
    case "drafting":
      return "The Daily goes out at 8 AM ET on any morning after something happened, draft picks included. Draft Grades lands the day the startup draft ends.";
    case "in_season":
      return `${issueLabel("weekly_recap", week)} goes out Tuesday. Thursday Night Fallout goes out Friday. The Daily shows up whenever somebody gives it material.`;
    default:
      return "The Daily shows up the morning after somebody makes a move.";
  }
}

function IssueTags({ issue }: { issue: Issue }) {
  if (issue.placeholder) return <SampleMark />;
  return null;
}

/** The latest issue as a lead: a real kicker, and the opening paragraphs without repeating the dek. */
function leadBlock(issue: Issue): RoastBlockData {
  const dek = (issue.dek ?? "").trim();
  const text = issue.sections
    .flatMap((sec) => sec.blocks)
    .flatMap((b) => (b.type === "paragraph" && b.text.trim() && b.text.trim() !== dek ? [b.text.trim()] : []))
    .slice(0, 2)
    .join("\n\n");
  return {
    ...issueToBlock(issue),
    kicker: issue.week && !/week/i.test(issue.title) ? `Week ${issue.week}` : undefined,
    text,
    tags: <IssueTags issue={issue} />,
  };
}

/* ------------------------------ the four issues ------------------------------ */

function Masthead({ issues, kind, recapWeek }: { issues: Issue[]; kind: IssueKind | null; recapWeek: number }) {
  return (
    <Panel label="The four issues" span={4} pad={false}>
      <ul className="m-0 list-none p-0">
        {ISSUE_ORDER.map((k) => {
          const mine = issues.filter((i) => i.kind === k);
          const last = mine[0];
          const selected = kind === k;
          const row = (
            <>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="type-display text-j2">{issueLabel(k, recapWeek)}</span>
                <span className={cx("text-fine", selected ? "text-paper-shade" : "text-ink-muted")}>
                  {CADENCE[k]}
                  {last ? `. Last: ${formatEt(issueDay(last), { month: "short", day: "numeric" })}` : ""}
                </span>
              </span>
              <Numeral value={mine.length} size="d30" tone={selected ? "paper" : mine.length ? "ink" : "muted"} label={`${mine.length} sent`} />
            </>
          );
          const cls = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3.5 md:px-6 lg:px-4 xl:px-6";
          return (
            <li key={k} className="border-b border-ink">
              {issues.length ? (
                <Link
                  href={selected ? archiveHref(null) : archiveHref(k)}
                  aria-current={selected ? "true" : undefined}
                  className={cx(
                    cls,
                    "no-underline focus-visible:outline-offset-[-4px]",
                    selected ? "on-ink bg-ink text-paper" : "hover:bg-paper-shade",
                  )}
                >
                  {row}
                </Link>
              ) : (
                <div className={cls}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-1 flex-col justify-end gap-4 px-4 pb-5 pt-5 md:px-6 lg:px-4 xl:px-6">
        <p className="m-0 text-data text-ink-muted">
          Every issue is written from this league&apos;s numbers and goes to the ten managers by email. A copy of each one stays here.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------ archive ------------------------------ */

function ArchiveRow({ issue }: { issue: Issue }) {
  const day = issueDay(issue);
  return (
    <li className="border-b border-ink last:border-b-0">
      <Link
        href={`/newsletter/${issue.slug}`}
        className="group grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 no-underline hover:bg-paper-shade focus-visible:outline-offset-[-4px] md:grid-cols-[5.5rem_minmax(0,15rem)_minmax(0,1fr)_auto] md:items-center md:px-6"
      >
        <span className="row-span-2 flex flex-col items-start gap-1 md:row-span-1">
          <span className="type-label text-ink-muted">{formatEt(day, { weekday: "short" })}</span>
          <Numeral
            value={Number(formatEt(day, { day: "numeric" }))}
            pad={2}
            size="d40"
            label={formatEt(day, { month: "long", day: "numeric" })}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="type-display text-j2 group-hover:underline group-hover:decoration-4">{issue.title}</span>
          <span className="type-label text-ink-muted">{issue.week ? `Week ${issue.week}` : `${issue.season} season`}</span>
        </span>
        <span className="col-start-2 flex min-w-0 flex-col gap-1 md:col-start-auto">
          {issue.dek ? <span className="measure text-body font-semibold">{issue.dek}</span> : null}
          <span className="flex flex-wrap items-center gap-2">
            <IssueTags issue={issue} />
          </span>
        </span>
        <span aria-hidden className="hidden text-ink md:block">
          <PixelArrow className="size-5" />
        </span>
      </Link>
    </li>
  );
}

function Archive({ issues, kind }: { issues: Issue[]; kind: IssueKind | null }) {
  const shown = kind ? issues.filter((i) => i.kind === kind) : issues;
  const months: Array<{ label: string; list: Issue[] }> = [];
  for (const i of shown) {
    const label = monthLabel(i);
    const last = months[months.length - 1];
    if (last && last.label === label) last.list.push(i);
    else months.push({ label, list: [i] });
  }
  const filters = [
    { href: archiveHref(null), label: "All", count: issues.length, selected: !kind },
    ...ISSUE_ORDER.map((k) => ({
      href: archiveHref(k),
      label: KIND_PLURAL[k],
      count: issues.filter((i) => i.kind === k).length,
      selected: kind === k,
    })),
  ];
  return (
    <Panel
      id="archive"
      label="The archive"
      labelRight={
        <span className="text-paper-shade">
          {shown.length} {shown.length === 1 ? "issue" : "issues"}
        </span>
      }
      pad={false}
    >
      <div className="px-4 pb-5 pt-6 md:px-6 md:pt-8">
        <FilterLinks label="Filter issues by name" items={filters} />
      </div>
      {months.length ? (
        months.map((m) => (
          <section key={m.label} aria-label={m.label} className="border-t-2 border-ink">
            <h3 className="type-label m-0 px-4 pb-2.5 pt-4 md:px-6">{m.label}</h3>
            <ol className="m-0 list-none border-t border-ink p-0">
              {m.list.map((i) => (
                <ArchiveRow key={i.slug} issue={i} />
              ))}
            </ol>
          </section>
        ))
      ) : (
        <div className="border-t-2 border-ink px-4 pb-6 pt-6 md:px-6">
          <DotMatrixFill label={kind ? `No ${kind === "weekly_recap" ? "recaps" : KIND_PLURAL[kind]} yet. ${CADENCE[kind]}.` : "The archive is empty."} rows={4} />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ page ------------------------------ */

export function NewsletterView({ issues, kind, phase, recapWeek }: NewsletterViewProps) {
  if (issues === null) {
    return (
      <Board>
        <Panel label="The newsletter" span={8}>
          <div className="flex flex-col gap-6">
            <h2 className="type-display m-0 text-j3 md:text-j4">The archive did not load</h2>
            <p className="measure m-0 text-body md:text-lede">
              The store that keeps every issue did not answer. Nothing was deleted. Try again in a minute.
            </p>
            <DotMatrixFill label="The archive store did not answer." rows={5} density={0.3} />
            <div>
              <Button href="/newsletter" variant="primary">
                Try again
              </Button>
            </div>
          </div>
        </Panel>
        <Masthead issues={[]} kind={null} recapWeek={recapWeek} />
      </Board>
    );
  }

  const latest = issues[0];
  return (
    <Board>
      <Panel label={latest ? issueEvent(latest) : "The newsletter"} labelRight={<span className="text-paper-shade">{latest ? "Latest" : "None yet"}</span>} span={8}>
        {latest ? (
          <div className="flex flex-1 flex-col gap-8">
            <RoastBlock {...leadBlock(latest)} eventInPanel size="hero" animate headingLevel={3} />
            <div>
              <Button href={`/newsletter/${latest.slug}`} variant="secondary">
                Read the whole issue
                <PixelArrow />
              </Button>
            </div>
          </div>
        ) : (
          <article className="flex flex-1 flex-col gap-6 md:gap-7">
            <h3 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
              <span className="board-wipe block">Nothing has</span>
              <span className="board-wipe block">gone out yet</span>
            </h3>
            <p className="measure m-0 text-body md:text-lede">{nextIssueLine(phase, recapWeek)}</p>
            <DotMatrixFill label="Every issue lands here the moment it is sent." rows={5} />
          </article>
        )}
      </Panel>
      <Masthead issues={issues} kind={kind} recapWeek={recapWeek} />
      {issues.length ? <Archive issues={issues} kind={kind} /> : null}
    </Board>
  );
}
