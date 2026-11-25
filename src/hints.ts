// One short line under each section name before the first explainer, so the empty page says what you'll get
// instead of showing grey placeholder lines. Same order as HEADINGS / COMPARE_HEADINGS in prompt.ts.

import type { Lang } from "./prompt.ts";

const TODAY: Record<Lang, string[]> = {
  en: [
    "The whole text in one line anyone can follow.",
    "The main points, in plain words.",
    "Facts and numbers worth a second look, each with a button to check it.",
    "Who gains, who loses and who pays.",
    "The jargon, in everyday words.",
    "What the text leaves out: questions worth asking.",
  ],
  it: [
    "Tutto il testo in una riga che chiunque capisce.",
    "I punti principali, in parole semplici.",
    "Fatti e numeri da ricontrollare, ognuno con un pulsante per verificarlo.",
    "Chi ci guadagna, chi ci perde e chi paga.",
    "Il gergo, in parole di tutti i giorni.",
    "Quello che il testo non dice: le domande da fare.",
  ],
  fr: [
    "Tout le texte en une ligne que chacun peut suivre.",
    "Les points principaux, en mots simples.",
    "Des faits et des chiffres à revérifier, chacun avec un bouton pour le vérifier.",
    "Qui y gagne, qui y perd et qui paie.",
    "Le jargon, en mots de tous les jours.",
    "Ce que le texte ne dit pas : les questions à poser.",
  ],
  es: [
    "Todo el texto en una línea que cualquiera entiende.",
    "Los puntos principales, en palabras sencillas.",
    "Datos y cifras que conviene revisar, cada uno con un botón para comprobarlo.",
    "Quién gana, quién pierde y quién paga.",
    "La jerga, en palabras de todos los días.",
    "Lo que el texto no dice: las preguntas que hacer.",
  ],
  de: [
    "Der ganze Text in einer Zeile, die jeder versteht.",
    "Die wichtigsten Punkte, in einfachen Worten.",
    "Fakten und Zahlen zum Nachprüfen, jeweils mit einem Knopf zum Prüfen.",
    "Wer gewinnt, wer verliert und wer zahlt.",
    "Fachbegriffe, in Alltagssprache.",
    "Was der Text offenlässt: Fragen, die man stellen kann.",
  ],
};

// History mode adds two sections: how it persuades, and the historical context.
const HISTORY_EXTRA: Record<Lang, string[]> = {
  en: ["The techniques it uses to win people over.", "What was happening at the time."],
  it: ["Le tecniche che usa per convincere.", "Cosa succedeva in quel periodo."],
  fr: ["Les techniques qu'il utilise pour convaincre.", "Ce qui se passait à l'époque."],
  es: ["Las técnicas que usa para convencer.", "Qué pasaba en aquella época."],
  de: ["Die Mittel, mit denen der Text überzeugen will.", "Was damals geschah."],
};

const COMPARE: Record<Lang, string[]> = {
  en: ["Both texts, in one line.", "What both texts say.", "Point by point, side by side.", "Who gains or loses under each.", TODAY.en[2], "What neither text answers."],
  it: ["I due testi, in una riga.", "Cosa dicono entrambi.", "Punto per punto, uno accanto all'altro.", "Chi ci guadagna o ci perde con ciascuno.", TODAY.it[2], "Le domande a cui nessuno dei due risponde."],
  fr: ["Les deux textes, en une ligne.", "Ce que disent les deux textes.", "Point par point, côte à côte.", "Qui y gagne ou y perd avec chacun.", TODAY.fr[2], "Les questions auxquelles aucun des deux ne répond."],
  es: ["Los dos textos, en una línea.", "Lo que dicen los dos.", "Punto por punto, uno al lado del otro.", "Quién gana o pierde con cada uno.", TODAY.es[2], "Las preguntas que ninguno de los dos responde."],
  de: ["Beide Texte in einer Zeile.", "Was beide Texte sagen.", "Punkt für Punkt, nebeneinander.", "Wer bei jedem gewinnt oder verliert.", TODAY.de[2], "Die Fragen, die keiner der beiden beantwortet."],
};

export function sectionHints(lang: Lang, history: boolean, compare: boolean): string[] {
  if (compare) return COMPARE[lang];
  return history ? [...TODAY[lang], ...HISTORY_EXTRA[lang]] : TODAY[lang];
}
