// Everything that talks to Firebase lives here:
// App Check (required for AI Logic), AI Logic (hybrid models),
// Remote Config (settings we can change without a new release),
// Anonymous Auth + Firestore (the optional "My library").

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, type GenerativeModel } from "firebase/ai";
import { getRemoteConfig, fetchAndActivate, getValue } from "firebase/remote-config";
import { getAuth, signInAnonymously, type User } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.ts";
import type { Lang } from "./prompt.ts";
import type { Mode } from "./route.ts";

export const isConfigured = !firebaseConfig.apiKey.startsWith("REPLACE");

export const app = initializeApp(firebaseConfig);

// App Check proves requests come from this app, not from someone copying
// the API key. Locally we use a debug token; the live site uses reCAPTCHA
// through Google Cloud Fraud Defense (formerly reCAPTCHA Enterprise).
if (import.meta.env.DEV) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
if (isConfigured) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

// ---------- Remote Config ----------
const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60 * 60 * 1000;
// Don't let a slow or missing connection hold up the page: the defaults below are good enough.
remoteConfig.settings.fetchTimeoutMillis = 5000;
remoteConfig.defaultConfig = {
  cloud_model: "gemini-3.5-flash-lite",
  device_char_limit: 20000,
  claim_grounding: false,
};

export interface Settings {
  cloudModel: string;
  deviceCharLimit: number;
  claimGrounding: boolean;
}

export async function loadSettings(): Promise<Settings> {
  if (isConfigured && navigator.onLine) {
    try {
      await fetchAndActivate(remoteConfig);
    } catch {
      // Offline or not set up yet: the defaults above are used.
    }
  }
  return {
    cloudModel: getValue(remoteConfig, "cloud_model").asString(),
    deviceCharLimit: getValue(remoteConfig, "device_char_limit").asNumber(),
    claimGrounding: getValue(remoteConfig, "claim_grounding").asBoolean(),
  };
}

// ---------- AI Logic ----------
const ai = getAI(app, { backend: new GoogleAIBackend() });

// One model object per request, because the mode and language can change.
export function makeModel(mode: Mode, lang: Lang, cloudModel: string): GenerativeModel {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: cloudModel,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1600 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en", lang] }],
        expectedOutputs: [{ type: "text", languages: [lang] }],
      },
    },
  });
}

// ---------- Check one claim ----------
// Two ways, switched by Remote Config ("claim_grounding"):
//  - grounded: only the chosen sentence goes to Gemini in the cloud with Google Search, and comes back with
//    sources (needs a paid Gemini tier);
//  - private (default): a hybrid call, on the device when it can, that says what kind of claim it is and
//    where the evidence would be, without guessing whether it is true. The page adds search links.
export interface ClaimCheck {
  text: string; // Markdown
  sources: { title: string; uri: string }[];
  suggestionsHtml?: string; // Google Search suggestions, which must be shown with grounded answers
  ranOn: "on_device" | "in_cloud";
  grounded: boolean;
}

export async function checkClaim(claim: string, lang: Lang, langName: string, cloudModel: string, grounded: boolean, mode: Mode = "prefer_on_device"): Promise<ClaimCheck> {
  const safeClaim = claim.replace(/"/g, "'");
  if (grounded) {
    const model = getGenerativeModel(ai, {
      model: cloudModel,
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    });
    const prompt = [
      "You help a reader check one claim from a political text. Search the web with Google Search.",
      `Answer in ${langName}. Start with exactly one verdict in bold: Supported, Disputed, Mixed, or Not enough information (translated into ${langName}).`,
      "Then write 2 or 3 short, plain sentences saying what reliable sources say, with dates when they matter.",
      "Be neutral: do not take sides, praise or criticise any party or person.",
      "If the claim is a prediction or an opinion, say it cannot be checked as a fact, and say what evidence exists.",
      "",
      `CLAIM: "${safeClaim}"`,
    ].join("\n");
    const result = await model.generateContent(prompt);
    const meta = result.response.candidates?.[0]?.groundingMetadata;
    const seen = new Set<string>();
    const sources = (meta?.groundingChunks ?? [])
      .map((c) => ({ title: c.web?.title ?? c.web?.domain ?? "Source", uri: c.web?.uri ?? "" }))
      .filter((x) => x.uri && !seen.has(x.uri) && seen.add(x.uri))
      .slice(0, 5);
    return { text: result.response.text(), sources, suggestionsHtml: meta?.searchEntryPoint?.renderedContent, ranOn: "in_cloud", grounded: true };
  }
  const model = makeModel(mode, lang, cloudModel);
  const prompt = [
    "You help a reader check one claim from a political text by themselves. Do not say whether the claim is true or false.",
    `Answer in ${langName}, in plain words, in this exact format:`,
    "**Kind of claim:** one short sentence: a fact that can be checked, a prediction, a promise, or an opinion.",
    "**How to check it:**",
    "- 2 or 3 bullet points: the kind of official or independent source that would have the evidence (for example a national statistics office, parliament records, the official budget, an independent fact-checker) and exactly what to look for there.",
    "Be neutral: do not take sides, praise or criticise any party or person.",
    "",
    `CLAIM: "${safeClaim}"`,
  ].join("\n");
  const result = await model.generateContent(prompt);
  const ranOn = result.response.inferenceSource === "on_device" ? "on_device" : "in_cloud";
  return { text: result.response.text(), sources: [], ranOn, grounded: false };
}

// ---------- Library (Anonymous Auth + Firestore) ----------
const auth = getAuth(app);
// The library keeps a copy on this device, so saved explainers open offline; saves made offline sync later.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

export interface SavedExplainer {
  id: string;
  title: string;
  snippet: string;
  lang: Lang;
  source: "on_device" | "in_cloud";
  markdown: string;
  createdAt: Date | null;
}

async function ensureUser(): Promise<User> {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function hasLibraryUser(): Promise<boolean> {
  if (!isConfigured) return false;
  await auth.authStateReady();
  return auth.currentUser !== null;
}

// Returns "queued" when offline: the save is kept on this device and sent when the connection is back.
export async function saveExplainer(e: Omit<SavedExplainer, "id" | "createdAt">): Promise<"saved" | "queued"> {
  const user = await ensureUser();
  const write = addDoc(collection(db, "users", user.uid, "explainers"), {
    ...e,
    createdAt: serverTimestamp(),
  });
  if (!navigator.onLine) {
    void write.catch(() => {});
    return "queued";
  }
  await write;
  return "saved";
}

export async function listExplainers(): Promise<SavedExplainer[]> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return [];
  const q = query(collection(db, "users", user.uid, "explainers"), orderBy("createdAt", "desc"), limit(20));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      snippet: data.snippet,
      lang: data.lang,
      source: data.source,
      markdown: data.markdown,
      createdAt: data.createdAt?.toDate?.() ?? null,
    } as SavedExplainer;
  });
}

export async function deleteExplainer(id: string): Promise<void> {
  const user = await ensureUser();
  await deleteDoc(doc(db, "users", user.uid, "explainers", id));
}
