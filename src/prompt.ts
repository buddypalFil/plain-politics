// Builds the instructions we send to the AI. The same prompt is used on the
// device and in the cloud, so both give the same kind of answer.

export type Lang = "en" | "it" | "fr" | "es" | "de";
// Speed vs detail. Gemini Nano writes more slowly than the cloud, so shorter
// answers arrive sooner on the device (measured on a MacBook: Balanced 15 s, Detailed 25 s).
export type Level = "quick" | "balanced" | "detailed";
// "today": news, bills, manifestos. "history": speeches and documents from the past.
// "compare": two texts on the same topic, side by side.
export type Mode = "today" | "history" | "compare";

export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: "English",
  it: "Italian",
  fr: "French",
  es: "Spanish",
  de: "German",
};

// The six sections of every explainer, in each language.
export const HEADINGS: Record<Lang, string[]> = {
  en: ["In one sentence", "What it says", "Claims worth checking", "Who it affects", "Words explained", "Questions to ask"],
  it: ["In una frase", "Cosa dice", "Affermazioni da verificare", "Chi riguarda", "Parole spiegate", "Domande da porsi"],
  fr: ["En une phrase", "Ce que dit le texte", "Affirmations à vérifier", "Qui est concerné", "Mots expliqués", "Questions à se poser"],
  es: ["En una frase", "Qué dice", "Afirmaciones que conviene comprobar", "A quién afecta", "Palabras explicadas", "Preguntas que hacerse"],
  de: ["In einem Satz", "Was drinsteht", "Aussagen zum Überprüfen", "Wen es betrifft", "Begriffe erklärt", "Fragen, die man stellen kann"],
};

// The six sections of a comparison. The claims section is fifth here (index 4).
export const COMPARE_HEADINGS: Record<Lang, string[]> = {
  en: ["In one sentence", "Where they agree", "Where they differ", "Who each would affect", "Claims worth checking", "Questions to ask"],
  it: ["In una frase", "Dove sono d'accordo", "Dove sono diversi", "Chi riguarda ciascuno", "Affermazioni da verificare", "Domande da porsi"],
  fr: ["En une phrase", "Où ils sont d'accord", "Où ils diffèrent", "Qui chacun concerne", "Affirmations à vérifier", "Questions à se poser"],
  es: ["En una frase", "En qué coinciden", "En qué se diferencian", "A quién afectaría cada uno", "Afirmaciones que conviene comprobar", "Preguntas que hacerse"],
  de: ["In einem Satz", "Worin sie übereinstimmen", "Worin sie sich unterscheiden", "Wen jeder Text betreffen würde", "Aussagen zum Überprüfen", "Fragen, die man stellen kann"],
};

// Two more sections in History mode.
export const PERSUADES_HEADING: Record<Lang, string> = {
  en: "How it tries to persuade",
  it: "Come cerca di convincere",
  fr: "Comment il cherche à convaincre",
  es: "Cómo intenta convencer",
  de: "Wie es zu überzeugen versucht",
};
export const CONTEXT_HEADING: Record<Lang, string> = {
  en: "Historical context",
  it: "Contesto storico",
  fr: "Contexte historique",
  es: "Contexto histórico",
  de: "Historischer Kontext",
};
const CONTEXT_NOTE: Record<Lang, string> = {
  en: "From the AI's general knowledge, not from the text. Check it.",
  it: "Dalle conoscenze generali dell'IA, non dal testo. Verificalo.",
  fr: "Tiré des connaissances générales de l'IA, pas du texte. À vérifier.",
  es: "Del conocimiento general de la IA, no del texto. Compruébalo.",
  de: "Aus dem Allgemeinwissen der KI, nicht aus dem Text. Bitte prüfen.",
};

const LEVELS: Record<Level, { bullets: string; terms: string; limit: string | null }> = {
  quick: { bullets: "Exactly 1 bullet point", terms: "1 bullet point", limit: "- Keep every bullet point under 12 words." },
  balanced: { bullets: "2 to 4 bullet points", terms: "Up to 3 bullet points", limit: "- Keep every bullet point under 20 words." },
  detailed: { bullets: "3 to 6 bullet points", terms: "Bullet points", limit: null },
};

export function buildPrompt(text: string, lang: Lang, level: Level = "balanced", mode: Mode = "today"): string {
  const h = HEADINGS[lang];
  const { bullets, terms, limit } = LEVELS[level];
  const history = mode === "history";
  return [
    history
      ? "You explain historical political texts (speeches, declarations, letters, laws from the past) to students and ordinary readers in plain words."
      : "You explain political texts (news articles, speeches, bills, manifestos) to ordinary readers in plain words.",
    "Rules:",
    "- Be neutral. Do not take sides, praise or criticise anyone, or say how to vote.",
    history
      ? `- Use only what is in the text, except in the "${CONTEXT_HEADING[lang]}" section. Never add facts, numbers or names that are not in it.`
      : "- Use only what is in the text. Never add facts, numbers or names that are not in it.",
    `- Copy every number, percentage and amount exactly as the text writes it, and never work out new numbers: keep words like "half" or "one in four" as words, never as percentages. Write the words around a number in ${LANGUAGE_NAMES[lang]} too (translate words like "miliardi" or "Millionen").`,
    ...(history ? ['- When the speaker uses a figure of speech (for example calling a campaign a war, or themselves a soldier), report it as the speaker\'s words, not as a fact, in every section including the first sentence: write "the speaker calls it a war", never that a war happened.'] : []),
    "- If the text does not say something, write that it does not say it.",
    "- Use short sentences and everyday words.",
    ...(limit ? [limit] : []),
    `- Write the whole answer in ${LANGUAGE_NAMES[lang]}.`,
    "",
    `Answer in Markdown with exactly these ${history ? "eight" : "six"} sections, in this order:`,
    `## ${h[0]}`,
    history
      ? 'One sentence a 12-year-old would understand. Report the speaker\'s view, not facts: start with the speaker (for example "The speaker says…"), and put words they use as a figure of speech, like "war" or "soldier", in quotation marks.'
      : "One sentence a 12-year-old would understand.",
    `## ${h[1]}`,
    `${bullets} with the main points.`,
    `## ${h[2]}`,
    history
      ? `${bullets}. Each one (do not start with the word "Claim"): in bold, a statement the speaker presents as a fact or as something everyone agrees on, in a few words close to the text's own; then one short sentence on what a reader could check about it with history sources (for example whether it was true for everyone at the time). Pick statements about the world, not dates or arithmetic.`
      : `${bullets}. Each one (do not start with the word "Claim"): in bold, the claim in a few words close to the text's own; then one short sentence on what to check and where (for example official figures).`,
    `## ${h[3]}`,
    history
      ? `${bullets}: the groups of people the speaker talks to or about, and what the text says about them or asks of them. Do not write that the text does not say; name who it addresses.`
      : `${bullets}: which groups of people this affects and how, as the text describes it.`,
    `## ${h[4]}`,
    history
      ? `${terms}: **term**: its plain meaning. Choose old-fashioned, formal or unusual words and phrases from the text first, the ones a student today would not know. Only terms that appear in the text.`
      : `${terms}: **term**: its plain meaning. Only terms that appear in the text.`,
    `## ${h[5]}`,
    history
      ? `${bullets}: questions a student could ask or look up to understand the text and its time better.`
      : `${bullets}: fair questions a reader could ask to understand it better.`,
    ...(history
      ? [
          `## ${PERSUADES_HEADING[lang]}`,
          `${bullets}. Each one starts with the name of a technique in bold (for example **Repetition**, **Emotional words**, **Us and them**, **Appeal to duty**), then a short quote from the text, then what it makes the listener feel or do. Describe the technique only; do not judge whether the cause was right or wrong.`,
          `## ${CONTEXT_HEADING[lang]}`,
          `First line, in italics: _${CONTEXT_NOTE[lang]}_`,
          `Then ${bullets.toLowerCase()} of well-known background: when and where this was said or written, what was happening at the time, and what happened next. This is the only section where you may use knowledge from outside the text. Stay neutral and factual. If you are not sure of something, leave it out.`,
        ]
      : []),
    "",
    "TEXT:",
    '"""',
    text.trim(),
    '"""',
  ].join("\n");
}

// Compare two texts on the same topic. Both are treated exactly the same way, and the answer never says
// which one is better: the reader decides.
export function buildComparePrompt(a: string, b: string, lang: Lang, level: Level = "balanced"): string {
  const h = COMPARE_HEADINGS[lang];
  const { bullets } = LEVELS[level];
  return [
    "You compare two political texts on the same topic (for example two parties' plans, or two speeches) for ordinary readers, in plain words. Call them Text A and Text B.",
    "Rules:",
    "- Be neutral. Treat both texts the same way, with the same depth and the same tone.",
    "- Never say which text is better, fairer, more convincing or more honest, and never say how to vote.",
    "- Use only what is in the two texts. Never add facts, numbers or names that are not in them.",
    `- Copy every number, percentage and amount exactly as the texts write it, and never work out new numbers: keep words like "half" or "one in four" as words, never as percentages. Write the words around a number in ${LANGUAGE_NAMES[lang]}.`,
    "- If one text does not cover a point, write that it does not say.",
    "- Use short sentences and everyday words.",
    // Comparing needs a little more room per bullet than explaining one text.
    ...(level === "quick" ? ["- Keep every bullet point under 20 words."] : level === "balanced" ? ["- Keep every bullet point under 30 words."] : []),
    `- Write the whole answer in ${LANGUAGE_NAMES[lang]}.`,
    "",
    "Answer in Markdown with exactly these six sections, in this order:",
    `## ${h[0]}`,
    "One sentence a 12-year-old would understand: what both texts are about and their biggest difference.",
    `## ${h[1]}`,
    `${bullets}: points that both texts share. If they agree on nothing, say so.`,
    `## ${h[2]}`,
    `${bullets}. Each one starts with the topic in bold, then what Text A says and what Text B says, like this: **Cost**: Text A: ... Text B: ... Always write the labels exactly as "Text A:" and "Text B:", in English and with the colon, whatever language the rest is in.`,
    `## ${h[3]}`,
    `${bullets}: which groups of people each text would affect and how. Say Text A or Text B each time.`,
    `## ${h[4]}`,
    `${bullets}, taken from both texts as evenly as possible. Each one (do not start with the word "Claim"): in bold, the claim in a few words close to the text's own; then (Text A) or (Text B); then one short sentence on what to check and where.`,
    `## ${h[5]}`,
    `${bullets}: fair questions a reader could ask the authors of both texts.`,
    "",
    "TEXT A:",
    '"""',
    a.trim(),
    '"""',
    "",
    "TEXT B:",
    '"""',
    b.trim(),
    '"""',
  ].join("\n");
}

// A rough token estimate (about 4 characters per token for English).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
