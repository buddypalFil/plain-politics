// Asks Chrome whether its built-in model (Gemini Nano) can run here.
// Chrome exposes this as the global `LanguageModel` (the Prompt API).

import type { DeviceStatus } from "./route.ts";
import type { Lang } from "./prompt.ts";

interface LanguageModelLike {
  availability(options?: unknown): Promise<string>;
}

export function hasPromptApi(): boolean {
  return typeof (globalThis as { LanguageModel?: unknown }).LanguageModel !== "undefined";
}

export async function getDeviceStatus(lang: Lang): Promise<DeviceStatus> {
  const LM = (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;
  if (!LM?.availability) return "unavailable";
  try {
    const s = await LM.availability({
      expectedInputs: [{ type: "text", languages: ["en", lang] }],
      expectedOutputs: [{ type: "text", languages: [lang] }],
    });
    // Older Chrome builds used different words for the same states.
    if (s === "available" || s === "readily") return "available";
    if (s === "downloadable" || s === "after-download") return "downloadable";
    if (s === "downloading") return "downloading";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

// Loads the on-device model into memory in the background, so the first explainer
// starts as fast as later ones. Only when the model is already downloaded.
export async function warmUpDevice(lang: Lang): Promise<void> {
  const LM = (globalThis as { LanguageModel?: { create?(o: unknown): Promise<{ destroy(): void }> } }).LanguageModel;
  if (!LM?.create) return;
  try {
    const s = await LM.create({
      expectedInputs: [{ type: "text", languages: ["en", lang] }],
      expectedOutputs: [{ type: "text", languages: [lang] }],
    });
    s.destroy();
  } catch {
    // Not important: the real request will load the model anyway.
  }
}
