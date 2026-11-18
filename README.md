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

It works in English, Italian and French, and never takes sides or tells anyone how to vote.

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
| "Auto", on-device model ready | Runs on the device; cloud only if the device fails | `prefer_on_device` |
| "Auto", model not downloaded yet | Cloud answers now; the user can download the model with one button | `prefer_on_device` |
| "Auto", text longer than the device limit | Straight to the cloud | `only_in_cloud` |
| "Auto", no on-device AI in this browser or language | Cloud | `only_in_cloud` |
| "This device only" | Device, or a clear message saying why it can't | `only_on_device` |
| "Cloud only" | Cloud | `only_in_cloud` |

The same prompt ([`src/prompt.ts`](src/prompt.ts)) is used on the device and in the cloud, so both give the
same six sections.

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
- The library saves the explainer and the first 280 characters of the text, never the whole text.
- The model's answer is shown through a small renderer ([`src/markdown.ts`](src/markdown.ts)) that escapes all
  HTML first, so model output can't inject markup or scripts.
- The prompt tells the model to stay neutral and to use only what is in the text, and the footer reminds readers
  that AI can make mistakes.
- The samples on the page ([`src/samples.ts`](src/samples.ts)) are made up, so no real politician is quoted.

## Run it yourself

Needs Node.js 22.18 or newer (the tests run the TypeScript files directly).

```bash
npm install
npm test        # 10 unit tests (routing, prompt, safe Markdown)
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

In desktop Chrome, turn on `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome, open the
site and press **Set up on-device AI**. Once the model has downloaded, the top of the page says
"On-device AI ready" and explainers show "Ran on your device".

## Project layout

```
src/main.ts           the page: input, streaming output, badge, library
src/firebase.ts       every Firebase call (App Check, AI Logic, Remote Config, Auth, Firestore)
src/route.ts          device vs cloud decision (pure, tested)
src/device.ts         asks Chrome whether Gemini Nano is available
src/prompt.ts         the shared prompt, in three languages
src/markdown.ts       safe Markdown renderer
src/samples.ts        made-up sample texts
tests/core.test.ts    unit tests
firestore.rules       database rules
remoteconfig.template.json
```

## How it was built

Built from scratch in November 2026 during the hackathon period, with TypeScript, Vite and the Firebase JS SDK,
using Claude Code as the coding assistant.

## Licence

[Apache-2.0](LICENSE)
