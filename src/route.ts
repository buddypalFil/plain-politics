// Decides where each request runs: on this device, in the cloud, or
// "device first, cloud if needed". Kept free of Firebase so it can be tested.

export type RunChoice = "auto" | "device" | "cloud";
export type DeviceStatus = "available" | "downloadable" | "downloading" | "unavailable";
export type Mode = "prefer_on_device" | "only_on_device" | "only_in_cloud";

export interface RouteInput {
  choice: RunChoice;
  chars: number;
  deviceCharLimit: number;
  deviceStatus: DeviceStatus;
  // True when the privacy guard found personal details (email, phone, address…).
  personal?: boolean;
  // True when the browser has no internet: only the on-device model can run.
  offline?: boolean;
}

export type Route =
  | { ok: true; mode: Mode; reason: string }
  | { ok: false; reason: string; privacy?: true };

export function chooseRoute(input: RouteInput): Route {
  const { choice, chars, deviceCharLimit, deviceStatus, personal, offline } = input;

  // Offline: the cloud can't be reached, so the on-device model is the only way, whatever was chosen.
  if (offline) {
    if (deviceStatus === "available" && chars <= deviceCharLimit) {
      return { ok: true, mode: "only_on_device", reason: "You're offline, so this ran on your device." };
    }
    const why =
      deviceStatus !== "available"
        ? "on-device AI isn't ready in this browser"
        : `this text is too long for the on-device model (limit about ${deviceCharLimit.toLocaleString("en-GB")} characters)`;
    return { ok: false, reason: `You're offline, and ${why}. Connect to the internet to use the cloud${deviceStatus === "available" ? ", or shorten the text" : ""}.` };
  }

  // Privacy guard: a text with personal details never goes to the cloud.
  // It runs on this device only (no cloud fallback), or the details must be removed first.
  if (personal) {
    const deviceReady = deviceStatus === "available" && chars <= deviceCharLimit;
    if (deviceReady && choice !== "cloud") {
      return { ok: true, mode: "only_on_device", reason: "Personal details found, so this stays on your device. Nothing is sent to the cloud." };
    }
    const why =
      choice === "cloud"
        ? "you chose the cloud"
        : chars > deviceCharLimit
          ? "it is too long for the on-device model"
          : "on-device AI isn't ready in this browser";
    return {
      ok: false,
      privacy: true,
      reason: `This text has personal details, and ${why}, so it was not sent anywhere. Remove the personal details to use the cloud${choice === "cloud" ? ", or choose Auto to keep it on your device" : ""}.`,
    };
  }

  if (choice === "cloud") {
    return { ok: true, mode: "only_in_cloud", reason: "You chose the cloud." };
  }

  const tooLong = chars > deviceCharLimit;
  if (tooLong) {
    if (choice === "device") {
      return {
        ok: false,
        reason: `This text is too long for the on-device model (limit about ${deviceCharLimit.toLocaleString("en-GB")} characters). Shorten it, or choose Auto or Cloud.`,
      };
    }
    return { ok: true, mode: "only_in_cloud", reason: "Long text, so it went to the cloud." };
  }

  if (deviceStatus === "unavailable") {
    if (choice === "device") {
      return {
        ok: false,
        reason: "This browser can't run the on-device model for this language. Choose Auto or Cloud.",
      };
    }
    return { ok: true, mode: "only_in_cloud", reason: "On-device AI isn't available here, so it went to the cloud." };
  }

  if (choice === "device") {
    // Not ready yet: say so now, rather than wait for a multi-GB download and time out.
    if (deviceStatus !== "available") {
      return {
        ok: false,
        reason: deviceStatus === "downloading"
          ? "The on-device model is still downloading. Wait for it to finish, or choose Auto."
          : "The on-device model isn't set up yet. Press Set up on-device AI, or choose Auto.",
      };
    }
    return { ok: true, mode: "only_on_device", reason: "You chose this device only." };
  }

  if (deviceStatus === "available") {
    return { ok: true, mode: "prefer_on_device", reason: "Device first, cloud only if needed." };
  }
  // Model not downloaded yet: Firebase falls back to the cloud without waiting.
  return { ok: true, mode: "prefer_on_device", reason: "On-device model not ready yet, so the cloud stepped in." };
}

// When the on-device model fails partway through an Auto (device first) run, the cloud may take over. Firebase AI Logic
// only falls back when the device model is unavailable before the request starts, so the page does this itself.
// Only in Auto: a text with personal details runs in "only_on_device" mode and never reaches the cloud. Only once,
// and only online.
export function shouldFallBackToCloud(o: { mode: Mode; ranOnDevice: boolean; online: boolean; alreadyFellBack: boolean }): boolean {
  return o.mode === "prefer_on_device" && o.ranOnDevice && o.online && !o.alreadyFellBack;
}

// Which on-device model the browser's built-in AI is, for the sticker: Chrome's is Gemini Nano; Microsoft Edge offers
// the same built-in AI with its own model, so the sticker must not say Gemini Nano there.
export function deviceModelName(userAgent: string): string {
  return /\bEdg\//.test(userAgent) ? "Edge's built-in model" : "Gemini Nano";
}
