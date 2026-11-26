// Splits the AI's Markdown answer into sections ("## Heading", then bullets and lines). The views show each line
// with AttributedString(markdown:), which only understands bold, italics and links, never HTML or code, so model
// output can't inject anything. Same idea as the website's safe renderer (src/markdown.ts).

struct Section: Identifiable, Equatable {
    let id: Int
    let title: String
    var bullets: [String] = []
    var lines: [String] = []
}

func parseSections(_ markdown: String) -> [Section] {
    var out: [Section] = []
    var afterBullet = false  // the last text line was a bullet (or a line added to one)
    var blank = false        // a blank line came since then
    for raw in markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { blank = true; continue }
        let indented = raw.first == " " || raw.first == "\t"
        defer { blank = false }
        if line.hasPrefix("#") {
            let title = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
            out.append(Section(id: out.count, title: title))
            afterBullet = false
            continue
        }
        // Text before the first heading goes into an untitled section.
        if out.isEmpty { out.append(Section(id: 0, title: "")) }
        let i = out.count - 1
        if let bullet = bulletText(line) {
            out[i].bullets.append(bullet)
            afterBullet = true
        } else if afterBullet, !out[i].bullets.isEmpty, !blank || indented {
            // A line right under a bullet belongs to it, as in Markdown: e.g. a claim, then what to check.
            // Without this the line was shown apart from its claim, above the whole list.
            out[i].bullets[out[i].bullets.count - 1] = joined(out[i].bullets[out[i].bullets.count - 1], line)
        } else {
            out[i].lines.append(line)
            afterBullet = false
        }
    }
    return out
}

/// "**A claim**" + "Check X." -> "**A claim**: Check X."; no extra colon when the bullet already ends a sentence.
private func joined(_ bullet: String, _ next: String) -> String {
    let plain = bullet.hasSuffix("**") ? String(bullet.dropLast(2)) : bullet
    let ends = plain.last.map { ".:;!?".contains($0) } ?? true
    return bullet + (ends ? " " : ": ") + next
}

private func bulletText(_ line: String) -> String? {
    for prefix in ["- ", "* ", "• "] where line.hasPrefix(prefix) {
        return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
    // "1. text" or "1) text"
    let digits = line.prefix(while: \.isNumber)
    if !digits.isEmpty {
        let rest = line.dropFirst(digits.count)
        if rest.hasPrefix(". ") || rest.hasPrefix(") ") { return String(rest.dropFirst(2)) }
    }
    return nil
}
