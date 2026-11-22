# Plain Politics style guide: "Broadsheet"

Plain Politics looks like the front page of a quality newspaper: black ink on warm paper, a big serif
masthead, hairline rules and small-capital labels. Two touches come from a ballot paper: you mark the level
of detail with an X, and a stamp says where the text was explained. It takes no party's colour, because the
app takes no side. (Chosen 22 Nov 2026 from six directions; it replaced "Ink & Paper".)

## Principles
1. **Plain first.** Every element must help someone understand a text. No decoration for its own sake.
2. **Neutral colour.** No red, blue, orange, yellow, green or turquoise as brand colours: in the UK each
   reads as a party. Ink and paper carry the design.
3. **One accent, one meaning.** Rust is used only for "pay attention": checking a claim, personal details
   found, warnings. Nothing else is rust.
4. **Show where the AI ran.** The stamp and the route strip always say device or cloud.
5. **No emoji in the interface.** Words, rules and boxes do the work.

## Colour
| Token | Light | Dark | Use |
|---|---|---|---|
| Paper | `#f3efe6` | `#141311` | Page background |
| Slip | `#faf8f3` | `#1c1a17` | Ballot box, text box, claim drawer |
| Ink | `#111111` | `#f1ece2` | Text, rules, primary button, device stamp |
| Ink 2 | `#3b3833` | `#d4cdbf` | Secondary text |
| Muted | `#736d65` | `#a39b8c` | Labels, hints |
| Rule | `#cfc8ba` | `#3a352e` | Hairlines |
| Rust | `#a8431a` / soft `#f4e3d8` | `#e0875c` / `#3a2418` | Check this claim, personal details, errors |
| Slate | `#3e4a5b` | `#9fb0c6` | "Ran in the cloud" only |

## Type (all bundled with the site through npm/Fontsource, OFL; never loaded from Google)
- **UnifrakturMaguntia** (blackletter): the masthead only, 84 px (50 px on phones). The old-newspaper
  nameplate, so the page reads as a newspaper at a glance. Never used for anything else.
- **Literata** (variable, optical size): the one-sentence headline 42 px weight 700, reading text 15-17 px,
  italic for the tagline and notes, weight 800 for the big reading-age number. Built for long
  reading on screens.
- **Libre Franklin** (variable): small-capital labels 11-12 px, weight 600-800, letter-spacing 0.1-0.16em
  ("THE EXPLAINER", "WHAT IT SAYS", "CHECK THIS CLAIM"), buttons, the stamp, meta text.
- (22 Nov 2026: a blackletter masthead + Literata replaced Newsreader, which read as a generic AI-site font.)

## Layout
- **Top bar:** date · PRIVATE · NEUTRAL · PLAIN · on-device status, over a 1 px ink rule.
- **Masthead:** "Plain Politics" centred, italic tagline, then a double rule (3 px + 1 px).
- **Section bar:** TODAY | HISTORY tabs (selected = 2 px ink underline) and MY LIBRARY.
- **Two columns (desktop):** left 340 px "Your text" (samples as underlined links, the text box, privacy
  line, ballot, Language / Run on as ruled rows, EXPLAIN IT); right "The explainer".
- **The explainer as a front page:** "In one sentence" is the headline. Below it, What it says | Who it
  affects side by side; Claims worth checking across the page under a 3 px rule, one column per claim;
  Words explained | Questions to ask; History sections across. Reading age (big "14 → 9" plus the gauge)
  and LISTEN · SAVE · COPY at the foot.
- **Phone, narrow windows and the extension panel:** one column in reading order; the panel shows the
  icon next to the masthead.

## Components
- **Ballot:** 2 px ink box, "HOW MUCH DETAIL · MARK ONE", one row per level with a 28 px square; the
  chosen level is marked with an X.
- **Stamp:** 2.5 px border, rotated -1.5°, "RAN ON YOUR DEVICE · 15.9 S · NOTHING SENT" (ink) or
  "RAN IN THE CLOUD · 2.6 S · GOOGLE GEMINI" (slate). While running: "WORKING ON YOUR DEVICE · 3 S".
- **Route strip:** Your text — Privacy guard — Your device — Cloud; used steps filled ink, others struck through.
- **Check this claim:** rust small-caps link with an empty box; once checked the box gets an X. The drawer
  has a 3 px rust left rule and always says what was sent.
- **Buttons:** primary = solid ink, square corners, small caps. Secondary = 1.5 px ink outline. Actions =
  underlined small caps.
- **Corners:** square everywhere. No shadows.

## Icon
"Full stop": an ink rounded square; four paper lines of uneven length curve into one line ending in a rust
full stop. Used for the favicon, the extension and the side panel. Files in `submission/style/icons/final/`.

## Video and gallery
Same paper, ink and type. Cards use the masthead (double rule, Newsreader title) and small-caps kickers.
Screen recordings sit in a browser frame on paper. Mock-ups of all six directions: `submission/style/redesign/`.
