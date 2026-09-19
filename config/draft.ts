/**
 * Startup draft timing, as the commissioner set it. Picks resume at 8 AM Eastern after the
 * overnight pause. Never derive this from Sleeper's autopause fields: they describe when the
 * pick timer restarts, not when the league starts picking again.
 */
export const DRAFT_RESUMES_ET = "8 AM";

/** How the resume time reads in FACTS and on the site: "8 AM ET". */
export const DRAFT_RESUMES_LABEL = `${DRAFT_RESUMES_ET} ET`;
