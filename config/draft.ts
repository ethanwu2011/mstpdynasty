/**
 * Startup draft timing, as the commissioner set it. Picks resume at 8 AM Eastern after the
 * overnight pause. Never derive the time from Sleeper's autopause fields: they describe when the
 * pick timer restarts (10 AM ET), not when the league starts picking again. The autopause window
 * only tells lib/facts/draft.ts that the overnight pause is on.
 */
export const DRAFT_RESUMES_ET = "8 AM";

/** How the resume time reads in FACTS and on the site: "8 AM ET". */
export const DRAFT_RESUMES_LABEL = `${DRAFT_RESUMES_ET} ET`;
