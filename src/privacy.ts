// Privacy guard: finds personal details in a text before anything is sent anywhere.
// If a text has personal details, it may only run on this device, or the details
// must be removed first. Kept free of Firebase and the DOM so it can be tested.

export type PersonalKind =
  | "email" | "phone" | "postcode" | "ni-number" | "card" | "iban" | "self-description" | "address" | "own-name";

export interface Finding {
  kind: PersonalKind;
  match: string;
  index: number;
}

export const KIND_LABEL: Record<PersonalKind, string> = {
  email: "email address",
  phone: "phone number",
  postcode: "home postcode",
  "ni-number": "National Insurance number",
  card: "card number",
  iban: "bank account number",
  "self-description": "home address or birth date",
  address: "street address",
  "own-name": "name",
};

const PLACEHOLDER: Record<PersonalKind, string> = {
  email: "[email]",
  phone: "[phone]",
  postcode: "[postcode]",
  "ni-number": "[NI number]",
  card: "[card number]",
  iban: "[bank account]",
  "self-description": "[address]",
  address: "[address]",
  "own-name": "[name]",
};

// Luhn check, so long numbers in budgets ("1,200,000,000") are not taken for cards.
function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Street types for home addresses ("14 Mill Lane", "Flat 2, 30 Station Road").
const STREET =
  "(?:Street|St|Road|Rd|Lane|Avenue|Ave|Close|Drive|Way|Crescent|Gardens|Grove|Place|Terrace|Square|Mews|Walk|Boulevard|Parade)";
// Not "Court" or "Row": "12 High Court judges" and "3 Death Row inmates" are politics, not homes.
// Addresses everyone knows are public, not a private person's home.
const PUBLIC_ADDRESS =
  /^(?:9|10|11|12) Downing Street$|^1600 Pennsylvania Avenue$|^1 Horse Guards Road$|^2 Marsham Street$|^(?:1|39) Victoria Street$|^100 Parliament Street$/i;

const MONTH = /^\d+[A-Za-z]?,? (?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;

// A house number followed by a street. Not a year ("In 2019 Parliament Square…"), not a date ("On 12 May Parliament
// Square…") and not a famous public address.
function looksLikeHomeAddress(m: string): boolean {
  const street = m.replace(/^(?:Flat|Apartment|Apt) \d+[A-Za-z]?,? /, "");
  if (MONTH.test(street)) return false;
  const nums = m.match(/\d+/g) ?? [];
  const house = Number(nums[nums.length - 1]);
  if (nums[nums.length - 1]?.length === 4 && house >= 1800 && house <= 2099) return false;
  return !PUBLIC_ADDRESS.test(street);
}

interface Rule {
  kind: PersonalKind;
  re: RegExp;
  check?: (m: string) => boolean;
  group?: number; // use this capture group as the personal detail
}

const RULES: Rule[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  {
    kind: "card",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    check: (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 19 && luhnOk(d);
    },
  },
  { kind: "ni-number", re: /\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi },
  // UK mobile/landline (07…, 01…, 02…, +44…) and international numbers written with a +.
  {
    kind: "phone",
    re: /(?:\+\d{1,3}[ -]?)?\(?0?\d{2,5}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b/g,
    check: (m) => {
      const d = m.replace(/\D/g, "");
      const looksLikePhone = m.trim().startsWith("+") || /^0[1-9]/.test(d);
      return looksLikePhone && d.length >= 10 && d.length <= 13;
    },
  },
  {
    kind: "self-description",
    // Only phrases that point at a private person's details (politicians often say "my name is…").
    re: /\b(?:I live at|my (?:home )?address is|my date of birth is|I was born on)\s+(\d[^.;\n]{0,60})/gi,
    group: 1,
  },
  // "I live on Mill Lane": a street given as where the writer lives, even without a house number.
  {
    kind: "address",
    re: new RegExp(`\\b(?:I|[Ww]e) live (?:on|in|at) ((?:[A-Z][a-z'’-]+ ){1,3}${STREET})\\b`, "g"),
    group: 1,
  },
  // "14 Mill Lane", "Flat 2, 30 Station Road", "221B Baker Street".
  {
    kind: "address",
    re: new RegExp(`\\b(?:(?:Flat|Apartment|Apt) \\d+[A-Za-z]?,? )?\\d{1,4}[A-Za-z]?,? (?:[A-Z][a-z'’-]+ ){1,3}${STREET}\\b`, "g"),
    check: looksLikeHomeAddress,
  },
  // A name someone gives as their own ("My name is Jordan Patel"). Every other mention of that name is removed too.
  { kind: "own-name", re: /\b[Mm]y name is ((?:[A-Z][a-z'’-]+)(?: [A-Z][a-z'’-]+){0,2})/g, group: 1 },
  { kind: "postcode", re: /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g },
];

export function findPersonalData(text: string): Finding[] {
  const found: Finding[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const raw = rule.group ? m[rule.group] : m[0];
      if (!raw) continue;
      const match = raw.trim();
      const index = (m.index ?? 0) + m[0].indexOf(match);
      if (rule.check && !rule.check(match)) continue;
      if (overlaps(index, index + match.length)) continue;
      taken.push([index, index + match.length]);
      found.push({ kind: rule.kind, match, index });
    }
  }
  // The same name may appear again (for example in a signature).
  for (const f of found.filter((x) => x.kind === "own-name")) {
    let i = text.indexOf(f.match);
    while (i !== -1) {
      if (!overlaps(i, i + f.match.length)) {
        taken.push([i, i + f.match.length]);
        found.push({ kind: "own-name", match: f.match, index: i });
      }
      i = text.indexOf(f.match, i + f.match.length);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// "1 email address and 2 phone numbers"
export function describeFindings(findings: Finding[]): string {
  const counts = new Map<PersonalKind, number>();
  const seen = new Set<string>();
  for (const f of findings) {
    const key = f.kind + "|" + f.match;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([k, n]) => `${n} ${KIND_LABEL[k]}${n > 1 ? "s" : ""}`);
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// Replaces every personal detail with a label like [email].
export function redact(text: string, findings: Finding[] = findPersonalData(text)): string {
  let out = "";
  let pos = 0;
  for (const f of [...findings].sort((a, b) => a.index - b.index)) {
    if (f.index < pos) continue;
    out += text.slice(pos, f.index) + PLACEHOLDER[f.kind];
    pos = f.index + f.match.length;
  }
  return out + text.slice(pos);
}

// Removes the same details wherever they appear in another text (e.g. the model's answer).
export function redactKnown(text: string, findings: Finding[]): string {
  let out = text;
  for (const f of findings) out = out.split(f.match).join(PLACEHOLDER[f.kind]);
  return out;
}
