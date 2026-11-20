# Plain Politics style guide: "Ink & Paper"

Plain Politics reads like a quality newspaper: black ink on warm paper, hairline rules, a serif for
headlines and a plain sans for reading. It takes no party's colour, because the app takes no side.

## Principles
1. **Plain first.** Every element must help someone understand a text. No decoration for its own sake.
2. **Neutral colour.** No red, blue, orange, yellow, green or turquoise as brand colours: in the UK each
   reads as a party. Ink and paper carry the design.
3. **One accent, one meaning.** Rust is used only for "pay attention": checking a claim, personal details
   found, warnings. Nothing else is rust.
4. **Show where the AI ran.** Device or cloud is always visible (route strip, stamps).

## Colour
| Token | Hex | Use |
|---|---|---|
| Paper | `#f4f0e8` | Page background |
| Sheet | `#fffdf8` | Cards, masthead, inputs |
| Ink | `#161513` | Text, primary buttons, "on your device" stamp, rules under headings |
| Ink 2 | `#3a3731` | Secondary text |
| Muted | `#6b655a` | Labels, hints, meta |
| Rule | `#d9d1c0` | Hairlines between sections, borders |
| Tint | `#efe7d6` | Quiet fills (selected states, gauges) |
| Rust | `#a8431a` / soft `#f6e6dc` | Check this claim, personal details, warnings |
| Slate | `#3e4a5b` / soft `#e6e9ee` | "Ran in the cloud" only |

Dark mode inverts paper and ink: background `#141311`, sheet `#1c1a17`, ink `#f1ece2`, rule `#34302a`,
rust `#e0875c`, slate `#9fb0c6`.

## Type
- **Headlines, section titles, pull quotes, the logo:** Source Serif 4 (variable, bundled with the site,
  OFL licence; never loaded from Google). Weights 600-700; pull quotes italic 500.
- **Reading text and UI:** the system sans (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
- **Labels:** sans, 10-11 px, bold, UPPERCASE, letter-spacing 0.12-0.18em ("SOURCE", "IN ONE SENTENCE").
- Sizes: masthead 19-22 px, section titles 15-17 px, pull quote 19-20 px, body 14-16 px.

## Layout and components
- **Masthead:** logo + "Plain Politics" in serif, a 3 px double rule underneath, then the strapline
  "PRIVATE · NEUTRAL · PLAIN" in small caps.
- **Sections:** no boxes in the explainer. Hairline rule above each, a small number ("01", "02") and a
  serif title. "In one sentence" is a pull quote: italic serif, larger, no number.
- **Source:** a 3 px ink rule on the left, label "SOURCE", serif title, muted character count.
- **Tabs (Today / History):** text tabs, the selected one underlined 2 px in ink.
- **Speed (Quick / Balanced / Detailed):** small text options; selected = 1 px ink outline, radius 3 px.
- **Route strip:** dots joined by lines: Your text — Privacy guard — Your device — Cloud. Steps used are
  filled ink; steps not used are pale and struck through.
- **Stamps:** small caps, 3 px radius. Device = solid ink on paper. Cloud = slate outline. Personal
  details = rust on rust-soft.
- **Buttons:** primary = solid ink, paper text, radius 6 px. Secondary = text link or 1 px rule outline.
- **Check this claim:** rust underlined link; the drawer has a 3 px rust left rule and always says what
  was sent ("Only this sentence was sent to the cloud").
- **Reading-age gauge:** one ink line from 5 to 20; explainer = filled ink dot, original = hollow muted dot.
- **Corners:** cards 12 px, controls 3-6 px. Shadows only on floating surfaces, very soft.

## Icon
"Full stop": an ink rounded square; four paper lines of uneven length (a ragged paragraph) curve together
into one line that ends in a rust full stop. Meaning: long political text, boiled down to one plain point.
Two drawings: `icon-full.svg` (48 px and up) and `icon-small.svg` (16-32 px: three thicker lines, bigger dot).
Sources and renders (16 to 1024 px) in `submission/style/icons/final/`; the favicon is the small drawing.
Rust here is `#c4562a`, a touch brighter than the UI rust so the dot reads on ink.

## Video
Same paper and ink. Title and chapter cards use the masthead: double rule, serif title, small-caps
kicker "FIREBASE #BUILDHYBRIDAI 2026 · WEB · CHROME". Screen recordings sit in a rounded browser frame on
paper. Captions in the system sans on a sheet-coloured bar.
