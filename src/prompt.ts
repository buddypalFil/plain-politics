// Builds the instructions we send to the AI. The same prompt is used on the
// device and in the cloud, so both give the same kind of answer.

export type Lang = "en" | "it" | "fr";
export type Detail = "short" | "full";

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  it: "Italian",
  fr: "French",
};

// The six sections of every explainer, in each language.
export const HEADINGS: Record<Lang, string[]> = {
  en: ["In one sentence", "What it says", "Claims worth checking", "Who it affects", "Words explained", "Questions to ask"],
  it: ["In una frase", "Cosa dice", "Affermazioni da verificare", "Chi riguarda", "Parole spiegate", "Domande da porsi"],
  fr: ["En une phrase", "Ce que dit le texte", "Affirmations à vérifier", "Qui est concerné", "Mots expliqués", "Questions à se poser"],
};

export function buildPrompt(text: string, lang: Lang, detail: Detail): string {
  const h = HEADINGS[lang];
  const bullets = detail === "short" ? "2 to 3" : "3 to 6";
  return [
    "You explain political texts (news articles, speeches, bills, manifestos) to ordinary readers in plain words.",
    "Rules:",
    "- Be neutral. Do not take sides, praise or criticise anyone, or say how to vote.",
    "- Use only what is in the text. Never add facts, numbers or names that are not in it.",
    "- Copy every number, percentage and amount exactly as the text writes it. Never work out new numbers.",
    "- If the text does not say something, write that it does not say it.",
    "- Use short sentences and everyday words.",
    `- Write the whole answer in ${LANGUAGE_NAMES[lang]}.`,
    "",
    "Answer in Markdown with exactly these six sections, in this order:",
    `## ${h[0]}`,
    "One sentence a 12-year-old would understand.",
    `## ${h[1]}`,
    `${bullets} bullet points with the main points.`,
    `## ${h[2]}`,
    `${bullets} bullet points. Each one: a claim from the text, then why a reader should check it.`,
    `## ${h[3]}`,
    "Bullet points: which groups of people this affects and how, as the text describes it.",
    `## ${h[4]}`,
    "Bullet points: **term**: its plain meaning. Only terms that appear in the text.",
    `## ${h[5]}`,
    `${bullets} bullet points: fair questions a reader could ask to understand it better.`,
    "",
    "TEXT:",
    '"""',
    text.trim(),
    '"""',
  ].join("\n");
}

// A rough token estimate (about 4 characters per token for English).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
