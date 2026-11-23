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
    for raw in markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { continue }
        if line.hasPrefix("#") {
            let title = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
            out.append(Section(id: out.count, title: title))
            continue
        }
        // Text before the first heading goes into an untitled section.
        if out.isEmpty { out.append(Section(id: 0, title: "")) }
        if let bullet = bulletText(line) {
            out[out.count - 1].bullets.append(bullet)
        } else {
            out[out.count - 1].lines.append(line)
        }
    }
    return out
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
