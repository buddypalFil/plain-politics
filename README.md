# Plain Politics

**Political text, explained in plain words. On your device when it can, in the cloud when it needs to.**

Paste a news article, a speech, a bill or a manifesto, or read one from a photo, a speech video or a YouTube
link. Plain Politics gives back a short, neutral explainer laid out like a newspaper front page:

1. **In one sentence**: what the text is about, simply put.
2. **What it says**: the main points.
3. **Claims worth checking**: each claim, and why a reader should check it.
4. **Who it affects**: which groups of people, as the text describes them.
5. **Words explained**: jargon from the text, in everyday words.
6. **Questions to ask**: fair questions that help a reader understand more.

It works in English, Italian, French, Spanish and German, and never takes sides or tells anyone how to vote.

- **Live site:** https://plain-politics-app.web.app (best in desktop Chrome; installable, works offline)
- **iPhone app:** native SwiftUI, with Apple's on-device model first and Gemini as backup ([see below](#iphone-app))
- **Demo video:** _link added at submission_
- Built for the Firebase **#BuildHybridAI 2026** hackathon: web (Chrome) + Chrome extension + iPhone, one hybrid design.

## What it does

| Feature | What it does | Runs |
|---|---|---|
| **Explain** (Today) | The six-part explainer for news, bills and manifestos, at Quick, Balanced or Detailed length | Device first, cloud if needed |
| **History mode** | For speeches from the past (Lincoln 1863, Pankhurst 1913, Roosevelt 1941): adds **How it tries to persuade** (named techniques, each with a quote) and **Historical context**, marked as the AI's general knowledge | Device first, cloud if needed |
| **Compare** | Two texts on the same topic side by side: where they agree, where they differ (an A and a B line per topic), who each would affect, claims from both, questions. Treats both the same and never says which is better | Device first, cloud if needed |
| **Spot the spin** | Marks loaded words in the original: emotional words, sweeping words, us and them, pressure, soft promises, no source. Filter by kind, with a plain reason for each. A fixed word list, no AI | Always on the device |
| **Check this claim** | Says what kind of claim it is (fact, prediction, promise, opinion) and where the evidence would be, plus Google Fact Check Explorer and Search links. Never guesses true or false. Only that one sentence can go to the cloud | Device first, cloud if needed |
| **Privacy guard** | Finds emails, phone numbers (UK and international, written any common way), home addresses, postcodes, card, bank and National Insurance numbers, dates of birth, and a name given as "my name is…" in all five languages, while leaving public places like 10 Downing Street alone. Such a text only runs on the device; if it can't, nothing is sent, and one button removes the details | Always on the device |
| **Read a photo** | Copies the text of a leaflet, poster or newspaper cutting into the box, where the reader checks it and the privacy guard scans it | Device first; asks before using the cloud |
| **Read a video, recording or YouTube link** | Writes out what is said in a speech, then it is explained like any text | Cloud only (asks first for files) |
| **Reading age** | The reading age of the original and of the explainer (English), e.g. 14 → 9 | Always on the device |
| **Share as a front page** | The explainer as a 1080×1350 newspaper-style picture (never the original text) | Always on the device |
| **Print edition, Listen, Copy, Save** | A clean A4 newspaper page; read aloud with the browser's voice; a private library per browser | — |
| **Reading options** | Larger text, and easy reading (sans font, more spacing) for readers with dyslexia | — |
| **Works offline** | Installable app; offline, explainers and claim checks run on the device only | Device only |
| **Chrome extension** | Explains the article you are reading in a side panel, from the toolbar or the right-click menu | Device first, cloud if needed |

Every explainer carries a sticker saying where it ran and how long it took (**RAN ON YOUR DEVICE · GEMINI NANO ·
NOTHING SENT · 15.9 S** or **RAN IN THE CLOUD · GOOGLE GEMINI · FIREBASE AI LOGIC · 2.6 S**), and a route strip: Your text → Privacy guard → Your device or
Cloud.

## Why hybrid AI fits this app

Political reading is personal. Many people would rather not send what they read, or what they think about it, to
a server. So Plain Politics runs **Gemini Nano inside Chrome first**, and the text never leaves the computer. When
the device can't run the model (another browser, a phone, an unsupported language, a very long text, a video), it
falls back to **Gemini in the cloud** through Firebase AI Logic, so everyone still gets an answer. With no
connection at all, the installed app keeps working on the device.

## How the routing works

The choice is made in [`src/route.ts`](src/route.ts) (no Firebase code in it, so it is unit-tested), and passed to
Firebase AI Logic as the hybrid `mode`:

| Situation | What happens | Firebase AI Logic mode |
|---|---|---|
| Offline | Device only; if it can't run, a clear message and nothing is lost | `only_on_device` |
| Personal details found (privacy guard) | Device only; if the device can't run it, nothing is sent | `only_on_device` |
| "Auto", on-device model ready | Runs on the device; cloud only if the device fails | `prefer_on_device` |
| "Auto", model not downloaded yet | Cloud answers now; the user can download the model with one button | `prefer_on_device` |
| "Auto", text longer than the device limit | Straight to the cloud | `only_in_cloud` |
| "Auto", no on-device AI in this browser or language | Cloud | `only_in_cloud` |
| "This device only" | Device, or a clear message saying why it can't | `only_on_device` |
| "Cloud only" | Cloud | `only_in_cloud` |
| A photo | Device when Chrome's model takes images; otherwise the reader is asked first | `only_on_device` / `only_in_cloud` |
| A video, a recording, a YouTube link | Cloud (the on-device model can't take video or sound) | cloud model |

The same prompt ([`src/prompt.ts`](src/prompt.ts)) is used on the device and in the cloud, so both give the same
sections. The length choice matters on the device, where Gemini Nano writes more slowly than the cloud. Measured on a
MacBook with a page-long text: **Quick 8 s, Balanced 15 s, Detailed 25 s**, with the first words on screen after
about 2 s (the answer streams in). The cloud takes a few seconds at any level. When the model is already downloaded,
the page loads it into memory in the background, so the first run is as quick as later ones.

## Firebase products used

| Product | What it does here | Where |
|---|---|---|
| **Firebase AI Logic** (hybrid inference) | Explainers, comparisons and claim checks on Gemini Nano in Chrome or Gemini in the cloud (Gemini Developer API); streams the answer; reports `inferenceSource` for the stamp; reads photos on the device (images passed to the Prompt API) and videos, recordings and YouTube links in the cloud; downloads the on-device model on request | [`src/firebase.ts`](src/firebase.ts), [`src/main.ts`](src/main.ts) |
| **App Check** (reCAPTCHA through Google Cloud Fraud Defense; debug token locally) | Only this app can call the AI. Started on first use, so opening the page sets no Google cookie | [`src/firebase.ts`](src/firebase.ts) |
| **Remote Config** | The cloud model name, the device text limit and the claim-check mode can change without a new release | [`remoteconfig.template.json`](remoteconfig.template.json) |
| **Anonymous Authentication** | A private library for each browser, with no sign-up | [`src/firebase.ts`](src/firebase.ts) |
| **Cloud Firestore** | Stores saved explainers, with an offline copy on the device; rules let each user see only their own, and check every field | [`firestore.rules`](firestore.rules) |
| **Hosting** | Serves the live site and its offline service worker | [`firebase.json`](firebase.json) |

The iPhone app uses **Firebase AI Logic** (hybrid, with Apple's on-device model) and **App Check** too: see
[iPhone app](#iphone-app).

## Privacy and safety

- **On the device**, the text stays on the computer. **In the cloud**, it is sent to Google's Gemini API through
  Firebase AI Logic, and the stamp says so.
- **Privacy guard** ([`src/privacy.ts`](src/privacy.ts), unit-tested): a text with personal details stays on the
  device, and so do the claims checked from it; in Compare, both texts are checked together. Political texts full
  of numbers, dates and money are not flagged (cards need a valid Luhn check, phones a real dialling format).
- Photos are read on the device when possible; photos, videos and recordings that would go to the cloud are only
  sent after the reader agrees, because the privacy guard can't check them.
- **No Google cookie until it's needed**: App Check (reCAPTCHA) starts the first time the page talks to the AI or
  the library, never on page load.
- The library saves the explainer and the first 280 characters of the text, never the whole text, with personal
  details replaced by labels first. Unsent text survives a reload in that tab only (`sessionStorage`).
- Model output, Spot the spin marks and library entries go through renderers that escape all HTML
  ([`src/markdown.ts`](src/markdown.ts), [`src/spin.ts`](src/spin.ts)), so nothing can inject markup or scripts.
- The prompts tell the model to stay neutral and to use only what is in the text; Compare treats both texts the
  same and never says which is better. The modern samples are made up, so no living politician is quoted; the
  History samples are real speeches in the public domain.

## Quality

- **Lighthouse** on the live site: **100 / 100 / 100 / 100** (performance, accessibility, best practices, SEO) on
  mobile and on desktop; first paint 0.9 s on a simulated slow phone.
- **39 unit tests** (routing including offline, privacy guard, prompts in every language, Spot the spin, YouTube
  links, error messages, reading age, safe Markdown, giving up on a silent answer) and an end-to-end browser check
  of every feature before each release. The iPhone app's core logic has 67 checks of its own, on the same cases.
- **Never stuck waiting**: if the cloud goes silent mid-answer, the page gives up after 25 seconds and tries again
  ([`src/stream.ts`](src/stream.ts)).
- **Rides out Google's busy spells**: when Gemini is overloaded it can send half an explainer and then a "high demand"
  error. The page tries again: twice as a stream, then twice asking for the whole answer at once, which got through
  more often when we measured a busy spell. Only after four tries does it say so in plain words, keeping the most text
  that arrived.

## Run it yourself

Needs Node.js 22.18 or newer (the tests run the TypeScript files directly).

```bash
npm install
npm test        # 39 unit tests
npm run dev     # http://localhost:5173
```

The repo is already connected to the Firebase project `plain-politics-app` (see
[`src/firebase-config.ts`](src/firebase-config.ts); these values are public by design). To use your own project:

1. Create a Firebase project, add a web app and paste its config into `src/firebase-config.ts`.
2. In the console: **AI Logic > Get started > Gemini Developer API**; **Authentication > Anonymous**; **Firestore**.
3. `npx firebase deploy --only firestore:rules,remoteconfig`
4. **App Check** is required by Firebase AI Logic:
   - Locally: run `npm run dev`, press **Explain it** once, copy the **App Check debug token** printed in the browser
     console, and add it under **App Check > Apps > Manage debug tokens**. To keep the same token every time, put it
     in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN=...` (see [`.env.example`](.env.example)).
   - Live: create a score-based reCAPTCHA key for your domain (google.com/recaptcha/admin), register its site key
     under **App Check > Apps > Fraud Defense**, and set `recaptchaSiteKey` in `src/firebase-config.ts`.
5. `npm run build && npx firebase deploy --only hosting`

### Trying the on-device model

On-device AI is built into desktop Chrome 148 and newer (Windows 10/11, macOS 13+, Linux, Chromebook Plus), with no
flags. Chrome needs 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM. Open the
site and press **Set up on-device AI** once to download Gemini Nano; after that the top of the page says
"On-device AI ready" and explainers show "Ran on your device". To see the offline app: open the site once, turn
Wi-Fi off, reload, and press **Explain it**.

## Chrome extension

The [`extension/`](extension) folder is a small Manifest V3 extension. It shows the live site in Chrome's side
panel and hands it the text of the page you are reading.

To install it (it is not on the Chrome Web Store):

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. On any article, click the Plain Politics icon in the toolbar, or right-click the page (or a selection) and choose
   **Explain this page with Plain Politics**.

How it works: clicking the icon gives the extension Chrome's one-time permission for that tab (`activeTab`), so it
asks for no access to your browsing in general. It reads the article text (or your selection) and passes it to the
side panel with `postMessage`; the page only accepts text from the extension panel that embeds it. The panel's
iframe is allowed to use Chrome's built-in model (`allow="language-model"`), so the explainer still runs on the
device when it can.

## iPhone app

[`ios/PlainPolitics.swiftpm`](ios/PlainPolitics.swiftpm) is a native SwiftUI app with the same idea and the same
newspaper look. It uses **Firebase AI Logic's hybrid model for Apple platforms**: **Apple's on-device model** (Apple
Intelligence, through Foundation Models) answers first, and **Gemini in the cloud** is the backup
([`Sources/App/Engine.swift`](ios/PlainPolitics.swiftpm/Sources/App/Engine.swift)).

It has the Today and History tabs with the same samples, Quick / Balanced / Detailed, all five languages, the privacy
guard, Spot the spin, the stamp saying where it ran, and Share. Compare, photos and videos, claim checks and the
library are on the website only.

Where it runs follows the website's rules
([`Sources/Core/Route.swift`](ios/PlainPolitics.swiftpm/Sources/Core/Route.swift)):

| Situation | What happens |
|---|---|
| "Auto", Apple's model ready | `hybridModel(primary: SystemLanguageModel.default, secondary: geminiModel)`: on the device; Gemini only if the device fails |
| "Auto", no Apple Intelligence here, or a text over about 9,000 characters | Gemini in the cloud |
| Personal details found | Device only; if the device can't run it, nothing is sent, and one button removes the details |
| Offline | Device only, or a clear message |
| "This device only" / "Cloud only" | As chosen, or a clear message saying why not |

- **Checks the model really answers.** Settings can say Apple Intelligence is on while its model is still
  downloading. So when the app opens (and when you come back to it), it asks Apple's model for one word. Until the
  model answers, the top of the screen says "Using the cloud" and explains why, instead of "On-device AI ready".
- **Never stuck waiting.** A cloud request gives up after 30 seconds of silence. A busy or silent cloud is tried three
  times: twice as a stream, then once asking for the whole answer at once (same idea as the website).
- **App Check** protects the cloud calls (the debug provider in development builds).
- The privacy guard, Spot the spin and the routing are plain Swift with no Firebase, checked by 67 tests on the same
  cases as the website ([`CoreTests/main.swift`](ios/PlainPolitics.swiftpm/CoreTests/main.swift)).

**Run it.** The app targets iOS 26 and was built and tested with Xcode 27.2 and the iOS 27.2 Simulator. Open
`ios/PlainPolitics.swiftpm` in Xcode, pick an iPhone simulator and press Run. Or from the command line (use any iPhone
simulator you have):

```bash
cd ios/PlainPolitics.swiftpm
xcodebuild -scheme "Plain Politics" -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath ../DerivedData CODE_SIGNING_ALLOWED=NO build
```

On the first run, Xcode's console prints an **App Check debug token**: add it in the Firebase console under **App
Check > Apps** (the iOS app) **> Manage debug tokens**, as for the website. The core checks run without Xcode:

```bash
swiftc ios/PlainPolitics.swiftpm/Sources/Core/*.swift ios/PlainPolitics.swiftpm/CoreTests/main.swift -o /tmp/pp-core && /tmp/pp-core
```

**On-device answers** need Apple Intelligence: an iPhone 15 Pro or newer with it turned on. In the Simulator, the app
borrows the Mac's model, so the Mac needs Apple Intelligence on and its model downloaded. Tip: the Mac's language
and Siri's language must match (System Settings > Siri says so), or the model never finishes downloading.

## Project layout

```
src/main.ts           the page: input, streaming output, stamp, Compare, photo/video reading, library
src/firebase.ts       every Firebase call (App Check, AI Logic, Remote Config, Auth, Firestore)
src/route.ts          device vs cloud decision, including offline (pure, tested)
src/privacy.ts        privacy guard: finds and removes personal details (pure, tested)
src/spin.ts           Spot the spin word list and safe highlighting (pure, tested)
src/share.ts          the front-page picture, drawn on a canvas
src/readability.ts    reading age, worked out on the device (pure, tested)
src/errors.ts         plain-language error messages (pure, tested)
src/stream.ts         gives up on an answer that goes silent (pure, tested)
src/youtube.ts        YouTube link check (pure, tested)
src/device.ts         asks Chrome whether Gemini Nano is available (text and images)
src/prompt.ts         the shared prompts (explain, History, Compare), in five languages
src/markdown.ts       safe Markdown renderer
src/samples.ts        made-up sample texts, public-domain speeches, Compare pairs
public/sw.js          service worker for the offline app
tests/                unit tests
extension/            Chrome extension (side panel, right-click menu)
ios/                  iPhone app (SwiftUI; Sources/App: screen and Firebase, Sources/Core: routing, privacy, spin)
firestore.rules       database rules
remoteconfig.template.json
```

## How it was built

Built from scratch in November 2026 during the hackathon period, with TypeScript, Vite and the Firebase JS SDK
(website) and SwiftUI with the Firebase Apple SDK (iPhone app), using Claude Code as the coding assistant.

## Licence

[Apache-2.0](LICENSE)
