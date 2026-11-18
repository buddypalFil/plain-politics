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
  getFirestore,
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
remoteConfig.defaultConfig = {
  cloud_model: "gemini-3.5-flash-lite",
  device_char_limit: 20000,
};

export interface Settings {
  cloudModel: string;
  deviceCharLimit: number;
}

export async function loadSettings(): Promise<Settings> {
  if (isConfigured) {
    try {
      await fetchAndActivate(remoteConfig);
    } catch {
      // Offline or not set up yet: the defaults above are used.
    }
  }
  return {
    cloudModel: getValue(remoteConfig, "cloud_model").asString(),
    deviceCharLimit: getValue(remoteConfig, "device_char_limit").asNumber(),
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

// ---------- Library (Anonymous Auth + Firestore) ----------
const auth = getAuth(app);
const db = getFirestore(app);

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

export async function saveExplainer(e: Omit<SavedExplainer, "id" | "createdAt">): Promise<void> {
  const user = await ensureUser();
  await addDoc(collection(db, "users", user.uid, "explainers"), {
    ...e,
    createdAt: serverTimestamp(),
  });
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
