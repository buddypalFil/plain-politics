// Reading age, worked out on the device (no AI): the Flesch-Kincaid grade level,
// turned into a UK-style reading age (US grade + 5). English only; other languages
// get no number rather than a wrong one.

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface ReadingAge {
  age: number; // years, 5 to 20
  words: number;
}

export function readingAge(text: string): ReadingAge | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (words.length < 30) return null;
  const sentences = Math.max(1, (clean.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
  const age = Math.round(Math.min(20, Math.max(5, grade + 5)));
  return { age, words: words.length };
}
