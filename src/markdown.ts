// A small, safe Markdown renderer for the AI's answer. It escapes all HTML
// first, so nothing in the model output can inject markup or scripts.
// Supports: "## " headings, "- " / "* " bullets, **bold**, and paragraphs.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>")
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
}

export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let inList = false;
  let inSection = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);

    if (heading) {
      closeList();
      if (inSection) out.push("</section>");
      out.push(`<section class="card"><h3>${inline(heading[1])}</h3>`);
      inSection = true;
    } else if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  closeList();
  if (inSection) out.push("</section>");
  return out.join("");
}

// The first sentence-like line, used as a title in the library.
export function firstLine(md: string): string {
  for (const line of md.split("\n")) {
    const t = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (t && !line.startsWith("#")) return t.slice(0, 140);
  }
  return "Explainer";
}
