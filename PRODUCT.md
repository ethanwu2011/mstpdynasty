# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The ten managers of the MSTP Dynasty fantasy football league: MD/PhD students who are friends. They use the site equally in two situations. On phones during NFL games, checking live scores and win odds and screenshotting roasts into the league group chat. On laptops during the week, reading the latest roast, standings, trades and odds. Ethan, the commissioner, also reviews newsletters before they go out.

## Product Purpose
A live tracker and roast machine for one private dynasty league. Every trade, waiver bid, lineup mistake and loss gets roasted, and every roast is backed by a real number from the league. Success looks like the group chat screenshotting it every week and people opening it during games alongside Sleeper.

## Positioning
Sleeper shows the numbers. This site says what they mean about you. Roasts are written only from facts computed about this league (points left on the bench, the swap that would have won, $0 bids that lost, dynasty value given away in a trade), so every joke is true and specific to these ten people. It also has models Sleeper does not: live win probability and season-long playoff, title and last-place odds.

## Operating Context
- League platform: Sleeper, league 1406497799725424640 ("MSTP Dynasty"): 10-team dynasty, true 2QB, 3 WR, full PPR, +0.5 TE premium, 6-point passing TDs.
- The league group chat is where things get shared, mostly as phone screenshots.
- Newsletters by email, from "MSTP Dynasty" with no byline: The Daily (daily, only when something happened), Thursday Night Fallout (Fridays in season), Week N Recap (Tuesdays, full recap), Draft Grades (once, after the startup draft). Recipients come from a private env list (LEAGUE_EMAILS); there is no public sign-up.
- Season states the site must handle: pre-draft (now, 2026-09-18), startup draft in progress, in season, offseason.

## Capabilities and Constraints
- Data: public Sleeper API, ESPN game clocks, FantasyCalc dynasty values. No logins or private data.
- Next.js on Vercel Hobby (one daily cron; instant roasts are triggered by page visits).
- The GitHub repo is public: no lore, secrets or other leagues' data in code.
- Everything must work with no API keys set. Roast text needs an Anthropic key (Ethan is creating one). Loser-of-the-week images wait for an image provider; never real faces.
- Home page in season: the latest roast leads, live scores and win odds follow.

## Brand Commitments
- Name: MSTP Dynasty, at mstpdynasty.com.
- Voice: an unnamed, merciless fantasy football columnist. Savage about fantasy decisions, never about identity (race, religion, sexuality, gender, bodies, family). It never announces itself: no copy, label, issue name or byline says roast, burn or cooked. Labels name the event ("PICK 3.01", "WEEK 5 FINAL", "TRADE, SEP 21").
- No medical or school theme anywhere, in copy or design. Ethan decided this explicitly.
- The owner strongly dislikes anything that looks AI-generated.

## Evidence on Hand
- Real league data from Sleeper: 10 managers and their usernames (Alex AK742, Anish agk100, Brandon bgong99, Carlos KomicalKomodo, Devante DBanner12, Ethan ZachWilsonFan5, Justin Justin919, Matthew mattsolo20, Navid navidx2, Peter Peteros). Rosters exist only after the startup draft.
- A completed 2025 season from Ethan's other league is available locally as test data only. It must never appear on the site.
- No lore yet (Ethan will supply it privately), no logos, no photos. Do not invent quotes, stats or history for the managers.

## Product Principles
1. Every joke is backed by a real number from this league.
2. The roast leads and the data proves it.
3. Built to be screenshotted: a single roast, matchup or table reads on its own in one phone screenshot.
4. Specific to these ten people. Nothing a generic fantasy site could say.
5. Nothing configured still means a working site. It degrades to plain facts, never to a broken page.
