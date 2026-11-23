// Privacy guard: finds personal details in a text before anything is sent anywhere.
// A text with personal details only runs on this device, or the details are removed first.
// Same rules as the website (src/privacy.ts). No Firebase and no UI here, so it can be tested.

import Foundation

enum PersonalKind: String, CaseIterable {
    case email, phone, postcode, niNumber, card, iban, selfDescription, ownName

    var label: String {
        switch self {
        case .email: return "email address"
        case .phone: return "phone number"
        case .postcode: return "home postcode"
        case .niNumber: return "National Insurance number"
        case .card: return "card number"
        case .iban: return "bank account number"
        case .selfDescription: return "home address or birth date"
        case .ownName: return "name"
        }
    }

    var placeholder: String {
        switch self {
        case .email: return "[email]"
        case .phone: return "[phone]"
        case .postcode: return "[postcode]"
        case .niNumber: return "[NI number]"
        case .card: return "[card number]"
        case .iban: return "[bank account]"
        case .selfDescription: return "[address]"
        case .ownName: return "[name]"
        }
    }
}

struct Finding: Equatable {
    let kind: PersonalKind
    let match: String
    /// Position in UTF-16 units (NSString), so ranges stay right with accents and emoji.
    let index: Int
}

private struct Rule {
    let kind: PersonalKind
    let regex: NSRegularExpression
    var group = 0
    var check: ((String) -> Bool)? = nil
}

private func re(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
    // The patterns are fixed and tested, so a failure here is a programming error.
    try! NSRegularExpression(pattern: pattern, options: options)
}

private func digits(_ s: String) -> String { s.filter(\.isNumber) }

// Luhn check, so long numbers in budgets ("1,200,000,000") are not taken for cards.
private func luhnOK(_ d: String) -> Bool {
    var sum = 0
    var double = false
    for ch in d.reversed() {
        guard var n = ch.wholeNumberValue else { return false }
        if double { n *= 2; if n > 9 { n -= 9 } }
        sum += n
        double.toggle()
    }
    return sum % 10 == 0
}

private let rules: [Rule] = [
    Rule(kind: .email, regex: re(#"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#)),
    Rule(kind: .iban, regex: re(#"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b"#)),
    Rule(kind: .card, regex: re(#"\b(?:\d[ -]?){13,19}\b"#), check: { m in
        let d = digits(m)
        return (13...19).contains(d.count) && luhnOK(d)
    }),
    Rule(kind: .niNumber, regex: re(#"\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b"#, [.caseInsensitive])),
    // UK mobile/landline (07…, 01…, 02…, +44…) and international numbers written with a +.
    Rule(kind: .phone, regex: re(#"(?:\+\d{1,3}[ -]?)?\(?0?\d{2,5}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b"#), check: { m in
        let d = digits(m)
        let looksLikePhone = m.trimmingCharacters(in: .whitespaces).hasPrefix("+") || (d.hasPrefix("0") && d.count > 1 && d.dropFirst().first != "0")
        return looksLikePhone && (10...13).contains(d.count)
    }),
    // Only phrases that point at a private person's details (politicians often say "my name is…").
    Rule(kind: .selfDescription, regex: re(#"\b(?:I live at|my (?:home )?address is|my date of birth is|I was born on)\s+(\d[^.;\n]{0,60})"#, [.caseInsensitive]), group: 1),
    // A name someone gives as their own ("My name is Jordan Patel"). Every other mention is removed too.
    Rule(kind: .ownName, regex: re(#"\b[Mm]y name is ((?:[A-Z][a-z'’-]+)(?: [A-Z][a-z'’-]+){0,2})"#), group: 1),
    Rule(kind: .postcode, regex: re(#"\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b"#)),
]

func findPersonalData(_ text: String) -> [Finding] {
    let ns = text as NSString
    var found: [Finding] = []
    var taken: [NSRange] = []
    func overlaps(_ r: NSRange) -> Bool { taken.contains { NSIntersectionRange($0, r).length > 0 } }

    for rule in rules {
        for m in rule.regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let r = m.range(at: rule.group)
            guard r.location != NSNotFound, r.length > 0 else { continue }
            let raw = ns.substring(with: r)
            let match = raw.trimmingCharacters(in: .whitespaces)
            guard !match.isEmpty else { continue }
            let start = r.location + (raw as NSString).range(of: match).location
            let range = NSRange(location: start, length: (match as NSString).length)
            if let check = rule.check, !check(match) { continue }
            if overlaps(range) { continue }
            taken.append(range)
            found.append(Finding(kind: rule.kind, match: match, index: start))
        }
    }
    // The same name may appear again (for example in a signature).
    for f in found where f.kind == .ownName {
        var search = NSRange(location: 0, length: ns.length)
        while true {
            let r = ns.range(of: f.match, options: [], range: search)
            if r.location == NSNotFound { break }
            if !overlaps(r) {
                taken.append(r)
                found.append(Finding(kind: .ownName, match: f.match, index: r.location))
            }
            let next = r.location + r.length
            search = NSRange(location: next, length: ns.length - next)
        }
    }
    return found.sorted { $0.index < $1.index }
}

/// "1 email address and 2 phone numbers"
func describeFindings(_ findings: [Finding]) -> String {
    var order: [PersonalKind] = []
    var counts: [PersonalKind: Int] = [:]
    var seen = Set<String>()
    for f in findings where seen.insert("\(f.kind.rawValue)|\(f.match)").inserted {
        if counts[f.kind] == nil { order.append(f.kind) }
        counts[f.kind, default: 0] += 1
    }
    let parts = order.map { k in "\(counts[k]!) \(k.label)\(counts[k]! > 1 ? "s" : "")" }
    if parts.count <= 1 { return parts.joined() }
    return parts.dropLast().joined(separator: ", ") + " and " + parts.last!
}

/// Replaces every personal detail with a label like [email].
func redact(_ text: String, _ findings: [Finding]? = nil) -> String {
    let ns = text as NSString
    var out = ""
    var pos = 0
    for f in (findings ?? findPersonalData(text)).sorted(by: { $0.index < $1.index }) where f.index >= pos {
        out += ns.substring(with: NSRange(location: pos, length: f.index - pos)) + f.kind.placeholder
        pos = f.index + (f.match as NSString).length
    }
    return out + ns.substring(from: pos)
}

/// Removes the same details wherever they appear in another text (for example the model's answer).
func redactKnown(_ text: String, _ findings: [Finding]) -> String {
    findings.reduce(text) { $0.replacingOccurrences(of: $1.match, with: $1.kind.placeholder) }
}
