// "Spot the spin": finds loaded words in the ORIGINAL text with a fixed word list.
// No AI and no network: it runs instantly on the device, works offline, and gives the same result every time.
// It doesn't judge: every side uses these words. It only helps the reader notice them.

import { escapeHtml } from "./markdown.ts";

export type SpinKind = "emotion" | "sweeping" | "sides" | "pressure" | "soft" | "source";

export const SPIN_KINDS: Record<SpinKind, { name: string; why: string }> = {
  emotion: { name: "Emotional words", why: "Words chosen to make you feel something, not only to tell you something." },
  sweeping: { name: "Sweeping words", why: "All-or-nothing words. Real life is rarely \"never\", \"nobody\" or \"completely\"." },
  sides: { name: "Us and them", why: "Splits people into sides, so you feel part of one group against another." },
  pressure: { name: "Pressure", why: "Makes you feel you must agree or act right now." },
  soft: { name: "Soft promises", why: "Sounds like a promise, but doesn't commit to a result you could check." },
  source: { name: "No source", why: "Says something is known or proven, without saying who says so." },
};

// Words and phrases, matched as whole words, ignoring case. "*" at the end matches any ending (betray* = betrayed,
// betrayal). Kept deliberately short and common, to avoid flagging ordinary words.
const WORDS: Record<SpinKind, string[]> = {
  emotion: [
    "forgotten", "abandoned", "betray*", "disaster*", "disgrace*", "shameful", "scandal*", "outrage*", "devastat*",
    "catastroph*", "chaos", "chaotic", "ruin*", "destroy*", "broken", "failing", "rip-off", "attack on", "war on",
    "cruel", "reckless", "heartless", "finally", "for too long", "for a generation", "historic", "brave", "proud",
    "hard-working", "struggling", "fight back", "stand up for", "nightmare", "shocking", "sacred", "glorious",
    "noble", "nobly", "perish", "tyrann*", "sacrifice*", "hallow*", "heroic", "betrayal",
  ],
  sweeping: [
    "never", "always", "nothing", "nobody", "no one", "everyone", "everybody", "everything", "completely", "totally",
    "entirely", "absolutely", "guarantee*", "forever", "every single", "the only", "the biggest", "the best", "the worst",
  ],
  sides: [
    "my opponents", "our opponents", "the other side", "the elite*", "the establishment", "ordinary people",
    "people like you", "people like us", "those people", "real people", "the likes of", "they want you", "their side",
    "outsiders", "enemies", "enemy",
  ],
  pressure: [
    "now or never", "before it's too late", "before it is too late", "time is running out", "it's time", "it is time",
    "can't afford", "cannot afford", "can not afford", "urgent*", "emergency", "act now", "right now", "no choice",
    "no alternative", "crisis", "last chance",
  ],
  soft: [
    "fight for", "push for", "work towards", "work toward", "aim to", "hope to", "look at", "look into", "consider",
    "explore", "make sure", "help to", "seek to", "commit to", "strive", "do everything",
  ],
  source: [
    "experts say", "studies show", "research shows", "many people say", "people are saying", "some say",
    "it is said", "everyone knows", "it is well known", "clearly", "obviously", "of course", "undeniabl*",
    "the fact is", "the truth is", "widely",
  ],
};

export interface SpinMatch {
  start: number;
  end: number;
  text: string;
  kind: SpinKind;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One regex per kind. Apostrophes in the list also match curly ones (’) from pasted text.
const PATTERNS: [SpinKind, RegExp][] = (Object.keys(WORDS) as SpinKind[]).map((kind) => {
  const alts = WORDS[kind]
    .map((w) => {
      const wild = w.endsWith("*");
      const base = escapeRe(wild ? w.slice(0, -1) : w).replace(/'/g, "['’]").replace(/ /g, "\\s+");
      return wild ? `${base}[a-z]*` : base;
    })
    .sort((a, b) => b.length - a.length);
  return [kind, new RegExp(`(?<![\\w-])(?:${alts.join("|")})(?![\\w-])`, "gi")];
});

// Every loaded word or phrase in the text, in order, never overlapping (the longer match wins).
export function findSpin(text: string): SpinMatch[] {
  const all: SpinMatch[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) all.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], kind });
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: SpinMatch[] = [];
  for (const m of all) if (!out.length || m.start >= out[out.length - 1].end) out.push(m);
  return out;
}

export function countByKind(matches: SpinMatch[]): Partial<Record<SpinKind, number>> {
  const c: Partial<Record<SpinKind, number>> = {};
  for (const m of matches) c[m.kind] = (c[m.kind] ?? 0) + 1;
  return c;
}

// The text as safe HTML, with each match wrapped in <mark>. Everything else is escaped.
export function highlightHtml(text: string, matches: SpinMatch[]): string {
  let html = "";
  let at = 0;
  for (const m of matches) {
    html += escapeHtml(text.slice(at, m.start));
    html += `<mark class="k-${m.kind}" title="${escapeHtml(SPIN_KINDS[m.kind].name)}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    at = m.end;
  }
  return html + escapeHtml(text.slice(at));
}
