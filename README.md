# Plain Politics

**Political text, explained in plain words. On your device when it can, in the cloud when it needs to.**

Paste a news article, a speech, a bill or a manifesto. Plain Politics gives back a short, neutral explainer
with six parts:

1. **In one sentence**: what the text is about, simply put.
2. **What it says**: the main points.
3. **Claims worth checking**: each claim, and why a reader should check it.
4. **Who it affects**: which groups of people, as the text describes them.
5. **Words explained**: jargon from the text, in everyday words.
6. **Questions to ask**: fair questions that help a reader understand more.

It works in English, Italian and French, and never takes sides or tells anyone how to vote. A **History mode**
turns it into a study tool for speeches from the past (see below).

Two extras make the hybrid choice matter:

- **Privacy guard.** If a text holds personal details (a name given as "my name is…", a home address, an email,
  a phone number, a postcode, a card, bank or National Insurance number), it only ever runs on the device. If
  the device can't run it, nothing is sent, and one button removes the details so the cloud can be used safely.
- **Chrome extension.** One click on the toolbar icon explains the article you are reading, in a side panel next
  to it. The page text goes straight from the page to the panel, with no server in between.

- **Live site:** https://plain-politics-app.web.app (best in desktop Chrome)
- **Demo video:** _link added at submission_
- Built for the Firebase **#BuildHybridAI 2026** hackathon (web / Chrome track).

## Why hybrid AI fits this app

Political reading is personal. Many people would rather not send what they read, or what they think about it,
to a server. So Plain Politics runs **Gemini Nano inside Chrome first**, and the text never leaves the computer.
When the device can't run the model (another browser, a phone, an unsupported language, or a very long text),
it falls back to **Gemini in the cloud** through Firebase AI Logic, so everyone still gets an answer.

A badge on every explainer says where it ran: **"🔒 Ran on your device"** or **"☁️ Ran in the cloud"**,
with the time it took.

## How the routing works

The choice is made in [`src/route.ts`](src/route.ts) (no Firebase code in it, so it is unit-tested), and passed to
Firebase AI Logic as the hybrid `mode`:

| Situation | What happens | Firebase AI Logic mode |
|---|---|---|
| Personal details found (privacy guard) | Device only; if the device can't run it, nothing is sent | `only_on_device` |
| "Auto", on-device model ready | Runs on the device; cloud only if the device fails | `prefer_on_device` |
| "Auto", model not downloaded yet | Cloud answers now; the user can download the model with one button | `prefer_on_device` |
| "Auto", text longer than the device limit | Straight to the cloud | `only_in_cloud` |
| "Auto", no on-device AI in this browser or language | Cloud | `only_in_cloud` |
| "This device only" | Device, or a clear message saying why it can't | `only_on_device` |
| "Cloud only" | Cloud | `only_in_cloud` |

The same prompt ([`src/prompt.ts`](src/prompt.ts)) is used on the device and in the cloud, so both give the
same sections. A **Speed vs detail** choice sets how long the answer is, which matters on the device because
Gemini Nano writes more slowly than the cloud. Measured on a MacBook with a page-long text: **Quick 8 s, Balanced
15 s, Detailed 25 s**, with the first words on screen after about 2 s (the answer streams in). The cloud takes a
few seconds at any level. When the model is already downloaded, the page loads it into memory in the background,
so the first run is as quick as later ones.

**Two modes.** *Today* is for news, bills and manifestos. *History* is for speeches and documents from the past
(samples: Lincoln 1863, Pankhurst 1913, Roosevelt 1941, all public domain). It adds two sections: **How it tries to
persuade** (techniques such as repetition or "us versus them", each with a short quote, without judging the
cause) and **Historical context**, clearly marked as coming from the AI's general knowledge rather than from the
text.

## Firebase products used

| Product | What it does here | Where |
|---|---|---|
| **Firebase AI Logic** (hybrid inference) | Runs the explainer on Gemini Nano in Chrome, or on Gemini in the cloud (Gemini Developer API); streams the answer; reports `inferenceSource` for the badge; downloads the on-device model on request | [`src/firebase.ts`](src/firebase.ts) `makeModel()`, [`src/main.ts`](src/main.ts) `generateContentStream()` and `initializeDeviceModel()` |
| **App Check** (reCAPTCHA through Google Cloud Fraud Defense; debug token locally) | Only this app can call the AI | [`src/firebase.ts`](src/firebase.ts) |
| **Remote Config** | The cloud model name and the device text limit can change without a new release | [`remoteconfig.template.json`](remoteconfig.template.json) |
| **Anonymous Authentication** | A private library for each browser, with no sign-up | [`src/firebase.ts`](src/firebase.ts) |
| **Cloud Firestore** | Stores saved explainers; rules let each user see only their own, and check every field | [`firestore.rules`](firestore.rules) |
| **Hosting** | Serves the live site | [`firebase.json`](firebase.json) |

## Privacy and safety

- **On the device**, the text stays on the computer.
- **In the cloud**, the text is sent to Google's Gemini API through Firebase AI Logic, and the page says so.
- **Privacy guard** ([`src/privacy.ts`](src/privacy.ts), unit-tested): finds personal details before anything is
  sent. Such a text stays on the device; if it can't, the app explains why and offers to replace the details with
  labels like `[email]` or `[address]` first. Political texts full of numbers, dates and money are not flagged
  (cards need a valid Luhn check, phones a real dialling format).
- The library saves the explainer and the first 280 characters of the text, never the whole text, and personal
  details are replaced with labels before anything is saved.
- The model's answer is shown through a small renderer ([`src/markdown.ts`](src/markdown.ts)) that escapes all
  HTML first, so model output can't inject markup or scripts.
- The prompt tells the model to stay neutral and to use only what is in the text, and the footer reminds readers
  that AI can make mistakes.
- The modern samples on the page ([`src/samples.ts`](src/samples.ts)) are made up, so no living politician is
  quoted; the History samples are real speeches in the public domain.

## Run it yourself

Needs Node.js 22.18 or newer (the tests run the TypeScript files directly).

```bash
npm install
npm test        # 20 unit tests (routing, privacy guard, prompts, safe Markdown)
npm run dev     # http://localhost:5173
```

The repo is already connected to the Firebase project `plain-politics-app` (see
[`src/firebase-config.ts`](src/firebase-config.ts); these values are public by design). To use your own project:

1. Create a Firebase project, add a web app and paste its config into `src/firebase-config.ts`.
2. In the console: **AI Logic > Get started > Gemini Developer API**; **Authentication > Anonymous**; **Firestore**.
3. `npx firebase deploy --only firestore:rules,remoteconfig`
4. **App Check** is required by Firebase AI Logic:
   - Locally: run `npm run dev`, open the page, copy the **App Check debug token** printed in the browser console,
     and add it under **App Check > Apps > Manage debug tokens**. To keep the same token every time, put it in
     `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN=...` (see [`.env.example`](.env.example)).
   - Live: create a score-based reCAPTCHA key for your domain (google.com/recaptcha/admin), register its site key
     under **App Check > Apps > Fraud Defense**, and set `recaptchaSiteKey` in `src/firebase-config.ts`.
5. `npm run build && npx firebase deploy --only hosting`

### Trying the on-device model

On-device AI is built into desktop Chrome 148 and newer (Windows 10/11, macOS 13+, Linux, Chromebook Plus), with no
flags. Chrome needs 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM. Open the
site and press **Set up on-device AI** once to download Gemini Nano; after that the top of the page says
"On-device AI ready" and explainers show "Ran on your device". On older Chrome versions, turn on
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart.

## Chrome extension

The [`extension/`](extension) folder is a small Manifest V3 extension. It shows the live site in Chrome's side
panel and hands it the text of the page you are reading.

To install it (it is not on the Chrome Web Store):

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. On any article, click the **PP** icon in the toolbar, or right-click the page (or a selection) and choose
   **Explain this page with Plain Politics**.

How it works: clicking the icon gives the extension Chrome's one-time permission for that tab (`activeTab`), so it
asks for no access to your browsing in general. It reads the article text (or your selection) and passes it to the
side panel with `postMessage`; the app only accepts text from a `chrome-extension://` sender. The panel's iframe is
allowed to use Chrome's built-in model (`allow="language-model"`), so the explainer still runs on the device when
it can.

## Project layout

```
src/main.ts           the page: input, streaming output, badge, library
src/firebase.ts       every Firebase call (App Check, AI Logic, Remote Config, Auth, Firestore)
src/route.ts          device vs cloud decision (pure, tested)
src/privacy.ts        privacy guard: finds and removes personal details (pure, tested)
src/device.ts         asks Chrome whether Gemini Nano is available
src/prompt.ts         the shared prompt, in three languages
src/markdown.ts       safe Markdown renderer
src/samples.ts        made-up sample texts
tests/                unit tests
extension/            Chrome extension (side panel, right-click menu)
firestore.rules       database rules
remoteconfig.template.json
```

## How it was built

Built from scratch in November 2026 during the hackathon period, with TypeScript, Vite and the Firebase JS SDK,
using Claude Code as the coding assistant.

## Licence

[Apache-2.0](LICENSE)
