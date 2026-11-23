// "Spot the spin": finds loaded words in the ORIGINAL text with a fixed word list. No AI, no network: instant,
// works offline, same result every time. Same list as the website (src/spin.ts). It doesn't judge: every side
// uses these words; it only helps the reader notice them.

import Foundation

enum SpinKind: String, CaseIterable, Identifiable {
    case emotion, sweeping, sides, pressure, soft, source
    var id: String { rawValue }
    var name: String {
        switch self {
        case .emotion: return "Emotional words"
        case .sweeping: return "Sweeping words"
        case .sides: return "Us and them"
        case .pressure: return "Pressure"
        case .soft: return "Soft promises"
        case .source: return "No source"
        }
    }
    var why: String {
        switch self {
        case .emotion: return "Words chosen to make you feel something, not only to tell you something."
        case .sweeping: return "All-or-nothing words. Real life is rarely \"never\", \"nobody\" or \"completely\"."
        case .sides: return "Splits people into sides, so you feel part of one group against another."
        case .pressure: return "Makes you feel you must agree or act right now."
        case .soft: return "Sounds like a promise, but doesn't commit to a result you could check."
        case .source: return "Says something is known or proven, without saying who says so."
        }
    }
    fileprivate var words: [String] {
        switch self {
        case .emotion: return [
            "forgotten", "abandoned", "betray*", "disaster*", "disgrace*", "shameful", "scandal*", "outrage*", "devastat*",
            "catastroph*", "chaos", "chaotic", "ruin*", "destroy*", "broken", "failing", "rip-off", "attack on", "war on",
            "cruel", "reckless", "heartless", "finally", "for too long", "for a generation", "historic", "brave", "proud",
            "hard-working", "struggling", "fight back", "stand up for", "nightmare", "shocking", "sacred", "glorious",
            "noble", "nobly", "perish", "tyrann*", "sacrifice*", "hallow*", "heroic", "betrayal",
        ]
        case .sweeping: return [
            "never", "always", "nothing", "nobody", "no one", "everyone", "everybody", "everything", "completely", "totally",
            "entirely", "absolutely", "guarantee*", "forever", "every single", "the only", "the biggest", "the best", "the worst",
        ]
        case .sides: return [
            "my opponents", "our opponents", "the other side", "the elite*", "the establishment", "ordinary people",
            "people like you", "people like us", "those people", "real people", "the likes of", "they want you", "their side",
            "outsiders", "enemies", "enemy",
        ]
        case .pressure: return [
            "now or never", "before it's too late", "before it is too late", "time is running out", "it's time", "it is time",
            "can't afford", "cannot afford", "can not afford", "urgent*", "emergency", "act now", "right now", "no choice",
            "no alternative", "crisis", "last chance",
        ]
        case .soft: return [
            "fight for", "push for", "work towards", "work toward", "aim to", "hope to", "look at", "look into", "consider",
            "explore", "make sure", "help to", "seek to", "commit to", "strive", "do everything",
        ]
        case .source: return [
            "experts say", "studies show", "research shows", "many people say", "people are saying", "some say",
            "it is said", "everyone knows", "it is well known", "clearly", "obviously", "of course", "undeniabl*",
            "the fact is", "the truth is", "widely",
        ]
        }
    }
}

struct SpinMatch: Equatable {
    let range: NSRange   // UTF-16 range in the original text
    let text: String
    let kind: SpinKind
}

// One regex per kind; whole words, ignoring case; "*" matches any ending; ' also matches the curly ’.
private let patterns: [(SpinKind, NSRegularExpression)] = SpinKind.allCases.map { kind in
    let alts = kind.words.map { w -> String in
        let wild = w.hasSuffix("*")
        var base = NSRegularExpression.escapedPattern(for: wild ? String(w.dropLast()) : w)
        base = base.replacingOccurrences(of: "'", with: "['’]").replacingOccurrences(of: " ", with: "\\s+")
        return wild ? base + "[a-z]*" : base
    }.sorted { $0.count > $1.count }
    let pattern = "(?<![\\w-])(?:\(alts.joined(separator: "|")))(?![\\w-])"
    return (kind, try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive]))
}

/// Every loaded word or phrase, in order, never overlapping (the longer match wins).
func findSpin(_ text: String) -> [SpinMatch] {
    let ns = text as NSString
    var all: [SpinMatch] = []
    for (kind, regex) in patterns {
        for m in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            all.append(SpinMatch(range: m.range, text: ns.substring(with: m.range), kind: kind))
        }
    }
    all.sort { $0.range.location != $1.range.location ? $0.range.location < $1.range.location : $0.range.length > $1.range.length }
    var out: [SpinMatch] = []
    for m in all where out.isEmpty || m.range.location >= NSMaxRange(out[out.count - 1].range) { out.append(m) }
    return out
}

func countByKind(_ matches: [SpinMatch]) -> [SpinKind: Int] {
    matches.reduce(into: [:]) { $0[$1.kind, default: 0] += 1 }
}
