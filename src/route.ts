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
}

export type Route =
  | { ok: true; mode: Mode; reason: string }
  | { ok: false; reason: string; privacy?: true };

export function chooseRoute(input: RouteInput): Route {
  const { choice, chars, deviceCharLimit, deviceStatus, personal } = input;

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
    return { ok: true, mode: "only_on_device", reason: "You chose this device only." };
  }

  if (deviceStatus === "available") {
    return { ok: true, mode: "prefer_on_device", reason: "Device first, cloud only if needed." };
  }
  // Model not downloaded yet: Firebase falls back to the cloud without waiting.
  return { ok: true, mode: "prefer_on_device", reason: "On-device model not ready yet, so the cloud stepped in." };
}
