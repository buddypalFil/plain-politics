// The name of a text in a comparison, for the A/B key above it: the part of its first line before a colon
// ("Riverside Party (fictional): Our plan for buses" -> "Riverside Party (fictional)"), or the first line, shortened.
// Pure, so it can be tested.
export function compareName(text: string, fallback: string): string {
  const first = text.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const beforeColon = first.includes(":") ? first.slice(0, first.indexOf(":")).trim() : first;
  const name = beforeColon.length >= 3 ? beforeColon : first;
  if (!name) return fallback;
  return name.length > 60 ? name.slice(0, 57).trimEnd() + "…" : name;
}
