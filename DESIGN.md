---
name: MSTP Dynasty
description: The stadium message board for ten friends' fantasy league, printed as a bitmap type specimen.
colors:
  paper: "#F2F0EB"
  ink: "#0A0A0A"
  scoreboard-red: "#E5011A"
  ink-muted: "#4A4945"
  rule: "#0A0A0A"
  paper-shade: "#E4E1D8"
typography:
  display:
    fontFamily: "'Jersey 10', 'Silkscreen', monospace"
    fontSize: "clamp(3rem, 11vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.86
    letterSpacing: "0"
  headline:
    fontFamily: "'Jersey 10', monospace"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 400
    lineHeight: 0.9
  label:
    fontFamily: "'Silkscreen', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.04em"
  numeral:
    fontFamily: "'Doto', monospace"
    fontWeight: 900
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    fontFeature: "'tnum' 1"
  row:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  numeral-solid:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "'tnum' 1"
rounded:
  none: "0px"
spacing:
  unit: "4px"
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  xl: "56px"
components:
  bar-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    padding: "10px 16px"
  button-primary:
    backgroundColor: "{colors.scoreboard-red}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "12px 20px"
  button-secondary-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "20px"
---

# Design System: MSTP Dynasty

## Direction contract

- **THESIS:** The site is the stadium message board for ten friends. The roast flashes in giant pixel type and the numbers underneath prove it. It refuses the category default (dark fantasy dashboard, neon accent, avatar cards) and its predictable opposite (cream editorial newspaper with an italic serif).
- **OWN-WORLD:** Newsprint paper, true black ink, one scoreboard red. Heavy black bars with reversed pixel caps, ruled panels, square corners, 2px ink borders, hard offset shadows on active controls, halftone and 9x9 dot-matrix textures as ornament blocks that never carry text. Pixel faces scale only in whole steps.
- **STORY:** You see who got roasted and the stat that earned it, then the live scores and odds, then you screenshot it into the group chat.
- **FIRST VIEWPORT:** A black top bar with MSTP DYNASTY in pixel caps and the week or draft status. On the left two thirds, the latest roast: the victim and the stat in huge pixel type, the roast in grotesk under it, and a red square plus timestamp. On the right third, a live scoreboard of five matchups with dot-matrix scores and dot-row win bars. On a phone the roast goes full width with the scoreboard directly below it.
- **FORM:** Emigre bitmap specimen fused with stadium message boards (the chosen alternate). Staging: a roast-first broadside. Seed fd65bdc4.

## Overview

**Creative North Star: "The Jumbotron Specimen"**

A stadium message board set as a type specimen. Everything important is shouted in coarse bitmap letters, the way a scoreboard flashes a name, and everything that proves it is set small, dense and exact in a newspaper grotesk underneath. The page is paper, the ink is black, and red is reserved for the scoreboard's alarm: the loser, the live game, the shame.

Density is a feature. This is a sports page for people who read box scores, so tables are real tables, rules divide panels, and there are no floating cards on empty space. The bitmap faces are loud but never used for anything longer than a headline, a label or a number.

It is not retro-gamer nostalgia (no 8-bit sprites, no CRT glow, no scanline filters) and not a fantasy app clone (no dark mode neon, no rounded avatar cards, no glassy panels). No medical or school imagery anywhere.

**Key Characteristics:**
- Coarse pixel display type at poster scale, fine grotesk for reading.
- Paper, ink and exactly one red.
- Black header bars with reversed pixel caps label every panel.
- Halftone and dot-matrix textures stand in for imagery. They are drawn with CSS or SVG, never raster filler, and no text ever sits on them.
- Square corners, 2px rules, hard offset shadows only on things you can press.

## Colors

Three inks and a paper, like a one-color print job with a spot red.

- **Paper (#F2F0EB):** the page. Never pure white.
- **Ink (#0A0A0A):** text, rules, header bars, filled dots.
- **Scoreboard Red (#E5011A):** the alarm. Live indicators (a small square), the loser of the week, shame entries, the primary action. It never fills more than a small share of any screen, and it is never used for decoration.
- **Ink Muted (#4A4945):** secondary text on paper (about 8:1 contrast). Never lighter.
- **Paper Shade (#E4E1D8):** zebra rows and pressed states only.

Light only. The users read it on the couch during games and on laptops during the week, and the world is newsprint.

## Typography

- **Display (Jersey 10):** the roast headline, the victim's name, the big score. Sizes step by whole multiples of the pixel grid (for example 48, 72 and 96px) so the pixels stay crisp. Line height is tight, words are set in caps, and nothing longer than about 12 words goes in it.
- **Label (Silkscreen):** header bars, nav, table headers, status tags. Solid caps at 12px on desktop and 13px on phones. Small text is always Silkscreen or the grotesk, never a dotted face.
- **Numeral (Doto, weight 900):** big scores, odds and records only, at 32px and up (the Numeral component switches to Doto at 40px). Dot-matrix digits, tabular. Below that, numbers are solid: Jersey 10 or the grotesk, bold and tabular. Dotted digits turn to grey fuzz on a phone.
- **Body and data (Schibsted Grotesk):** roast text, newsletter issues, tables. 17px body, 65-75ch measure, tabular numbers in tables. On phones nothing you read is under 16px: body and table data 16px or more, fine print 14px. A row's one-liner (and the names in the draft board's team header) is the 16px `row` step at every width; small numerals that must stay solid are the 18px bold `numeral-solid` step.
- **Sentences are never pixel caps.** Silkscreen is for labels and tags of four words or fewer. An empty state's line, a legend or an explanation is set in the grotesk.
- No italics for emphasis. Emphasis comes from weight, size or a switch to the pixel face.

## Layout

- A ruled broadsheet grid of panels divided by 2px ink rules. The content lives inside panels, and panels touch each other with no gutters.
- Desktop: a 12-column grid, the roast spans 8 and the scoreboard 4. Standings and tables go full width.
- Phone (375px): single column in reading order (roast, scoreboard, then everything else). The nav becomes a bottom-fixed bar of four pixel labels. Tables scroll horizontally inside their panel with the first column pinned.
- Spacing is on a 4px unit. There is more space above a panel's content than inside its header bar.
- Every panel, matchup and roast must read on its own in one phone screenshot.

## Elevation & Depth

Flat print. Depth appears only as a hard offset shadow (4px 4px 0 ink, no blur) on pressable controls and the active or selected panel. That is the one sanctioned exception to "shadows need blur": it is the world's native device, the offset registration of the specimen board. There are no ambient shadows, no glass and no gradients.

## Shapes

Square corners everywhere (radius 0). 2px ink borders on panels, inputs and buttons. The one ornament vocabulary is halftone dots and a 9x9 dot-matrix pattern, used as bar fills, loading states, empty-state art and the texture block in the top bar. A texture is a block of its own: text goes beside or below it on plain paper, never on top of it.

## Components

- **Header bar:** a black strip with reversed solid Silkscreen caps. It labels every panel by the event or the table ("PICK 3.01", "WEEK 5 FINAL", "TRADE, SEP 21", "SCOREBOARD", "STANDINGS"), never by the genre: no label, issue name or byline ever says roast, burn or cooked.
- **Roast block:** a Jersey 10 headline made of the victim and the stat, a grotesk paragraph, and a footer line with a red square, the time and a permalink. Plain paper behind all of it. No byline and no badge that says what kind of writing it is.
- **One-liner:** the one mean line under a stat row (standings, odds, power rankings, matchups, team pages, trades, shame entries, draft picks). Grotesk, 16px or more, no label or badge: it reads as the row's caption. When there is no line (no API key yet) nothing renders, never a canned joke.
- **Matchup row:** two team lines with scores (Doto at 40px and up, solid Jersey 10 below) and a 20-dot win-probability row (filled ink dots for one side, hollow for the other). A red square blinks slowly beside games in progress, and the winner's line goes bold when the game is final.
- **Tables:** Silkscreen headers on a black bar, grotesk tabular data, zebra rows in Paper Shade, the leader marked in bold, the last place marked with a red square.
- **Buttons:** red primary and paper secondary, both with 2px ink borders. On hover and focus they shift up-left and show the 4px hard shadow. On press the shadow disappears and they sit flush.
- **Status tags:** tiny Silkscreen caps in an ink box (LIVE, FINAL, TRADE, WAIVER, $0 BID).
- **Draft board:** a grid of cells, 10 team columns by 34 round rows. Each pick shows its number and the player in Silkscreen and grotesk. Reaches are marked with a red square and steals with a filled ink square.
- **Empty and loading states:** dot-matrix fields that fill in as data arrives, plus one plain line of copy below the field (never on it) that says what is missing.

## Do's and Don'ts

- Do shout the name and the stat, and prove it in small type.
- Do keep red for alarms: live games, losers, shame, the primary action.
- Do scale pixel faces in whole steps and keep them to headlines, labels and numbers.
- Don't use rounded corners, soft shadows, gradients, glass, emoji, stock icons or avatar circles.
- Don't use monospace as decoration. Big numbers use Doto because they are scores; small numbers stay solid.
- Don't set text on a halftone or dot texture, and don't use Doto or any dotted rendering below 32px.
- Don't announce the joke. Nothing a reader sees calls itself a roast, a burn or cooked: state it flat.
- Don't add a subscribe button. The newsletter goes to the league from a private list.
- Don't add a second accent color, a dark mode, or a colored left border on cards.
- Don't use medical or school imagery or wording, ever.
