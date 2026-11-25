// Turns technical errors from Firebase, Gemini and the browser into plain advice for the reader.
// Kept free of Firebase and the DOM so it can be tested.

export function friendlyMessage(m: string, ctx: { deviceReady: boolean; online: boolean; dev: boolean; youtube?: boolean }): string {
  // Only suggest the on-device model where it can actually run.
  const orDevice = ctx.deviceReady ? ", or choose Run on: This device only" : "";
  // A missing, private or blocked YouTube video comes back as 400/403/404 ("caller does not have permission"), which
  // would otherwise read like an App Check failure. Real App Check errors name App Check or reCAPTCHA.
  if (ctx.youtube && !/app.?check|recaptcha/i.test(m) && /\b40[034]\b|PERMISSION_DENIED|INVALID_ARGUMENT|NOT_FOUND|not found|permission|private/i.test(m)) {
    return YOUTUBE_FAILED;
  }
  if (/app.?check|appCheck|recaptcha/i.test(m) || (/PERMISSION_DENIED|\b403\b/.test(m) && !/youtube|file|uri/i.test(m))) {
    return `Google's anti-abuse check couldn't confirm this browser, so the cloud AI was blocked. A strict ad or privacy blocker can cause this: allow google.com/recaptcha on this site and reload${orDevice}.`
      + (ctx.dev ? " (Running locally? Register the debug token from the console in Firebase > App Check.)" : "");
  }
  if (/offline-no-account/.test(m)) {
    return "You're offline, and this browser hasn't saved anything before: the first save needs a connection. Try again when you're online.";
  }
  if (/Failed to fetch|NetworkError|network error|network-request-failed|ERR_INTERNET|ERR_NETWORK|load failed/i.test(m) || !ctx.online) {
    return `The connection dropped before the answer arrived. Check your internet and try again${orDevice}.`;
  }
  if (/SAFETY|blocked|prohibited|RECITATION|PROHIBITED_CONTENT/i.test(m)) {
    return `Google's AI wouldn't answer because of its safety filters. Strong language in political texts can trigger this: try a shorter extract${orDevice}.`;
  }
  if (/youtube|fileUri|file_uri|uri/i.test(m) && /40[034]|not found|private|access|invalid/i.test(m)) {
    return YOUTUBE_FAILED;
  }
  if (/mime|unsupported|invalid.*(file|format)|Unable to process/i.test(m)) {
    return "Google's AI couldn't read this file. Try an MP4 video or an MP3 or M4A recording.";
  }
  if (/stream stalled|Timeout has expired/i.test(m)) {
    return `The AI stopped answering partway through, even after trying again. Wait a minute and try again${orDevice}.`;
  }
  if (/parse-failed|Failed to parse stream/i.test(m)) {
    return `Google's cloud AI is very busy right now and stopped before the answer finished. Wait a minute and try again${orDevice}.`;
  }
  if (/quota|RESOURCE_EXHAUSTED|\b429\b|rate.?limit/i.test(m)) {
    return `The cloud AI has reached its limit for the moment. Wait a minute and try again${orDevice}.`;
  }
  if (/high demand|overloaded|UNAVAILABLE|\b50[03]\b/i.test(m)) {
    return `Google's cloud AI is overloaded right now. Wait a minute and try again${orDevice}.`;
  }
  if (/on.?device|LanguageModel/i.test(m)) {
    return `On-device AI couldn't run this (${m}). Choose Run on: Auto or Cloud only.`;
  }
  return `Something went wrong: ${m}`;
}

const YOUTUBE_FAILED =
  "This YouTube video couldn't be opened. It may be private, age-restricted or removed. Try another public video, or upload the clip instead.";
