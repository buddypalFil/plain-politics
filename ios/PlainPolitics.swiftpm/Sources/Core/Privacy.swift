// Privacy guard: finds personal details in a text before anything is sent anywhere.
// A text with personal details only runs on this device, or the details are removed first.
// Same rules as the website (src/privacy.ts). No Firebase and no UI here, so it can be tested.

import Foundation

enum PersonalKind: String, CaseIterable {
    case email, phone, postcode, niNumber, card, iban, selfDescription, address, ownName

    var label: String {
        switch self {
        case .email: return "email address"
        case .phone: return "phone number"
        case .postcode: return "home postcode"
        case .niNumber: return "National Insurance number"
        case .card: return "card number"
        case .iban: return "bank account number"
        case .selfDescription: return "date of birth"
        case .address: return "street address"
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
        case .selfDescription: return "[date of birth]"
        case .address: return "[address]"
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

// Street types for home addresses ("14 Mill Lane", "Flat 2, 30 Station Road").
// Not "Court" or "Row": "12 High Court judges" and "3 Death Row inmates" are politics, not homes.
private let street = "(?:Street|St|Road|Rd|Lane|Avenue|Ave|Close|Drive|Way|Crescent|Gardens|Grove|Place|Terrace|Square|Mews|Walk|Boulevard|Parade)"
// Addresses everyone knows are public, not a private person's home.
private let publicAddress = re(#"^(?:9|10|11|12) Downing Street$|^1600 Pennsylvania Avenue$|^1 Horse Guards Road$|^2 Marsham Street$|^(?:1|39) Victoria Street$|^100 Parliament Street$"#, [.caseInsensitive])
// "10 Downing St" and "1600 Pennsylvania Ave" are the same public places.
private func longStreet(_ s: String) -> String {
    var t = s
    for (short, long) in [(#" St\.?$"#, " Street"), (#" Ave\.?$"#, " Avenue"), (#" Rd\.?$"#, " Road")] {
        t = re(short, [.caseInsensitive]).stringByReplacingMatches(in: t, range: NSRange(location: 0, length: (t as NSString).length), withTemplate: long)
    }
    return t
}
// Postcodes of public buildings that appear in political texts: Parliament, Downing Street, Buckingham Palace.
private let publicPostcode = re(#"^SW1A ?[012]AA$"#, [.caseInsensitive])
// A lower-case postcode ("ne1 4st") only counts after a word that says it is one, or after a street.
private let postcodeCue = re(#"(?:post ?code|postal code|zip|"# + street + #")\b[^\n]{0,40}$"#, [.caseInsensitive])
// Words that come before a phone number, in the app's five languages.
private let phoneCue = #"(?:call|phone|tel|telephone|mobile|cell|ring|whatsapp|chiama\w*|telefon\w*|cellulare|cel|tél\w*|portable|appel\w*|teléfono|móvil|lláma\w*|llam\w*|handy|anruf\w*|ruf)"#
private let yearsOnly = re(#"^(?:(?:19|20)\d{2}[ .-]?)+$"#)
/// Digits of a phone number, without the "(0)" of "+44 (0)7700…".
private func phoneDigits(_ m: String) -> String { digits(m.replacingOccurrences(of: "(0)", with: "")) }

private let flatPrefix = re(#"^(?:Flat|Apartment|Apt) \d+[A-Za-z]?,? "#)
private let month = re(#"^\d+[A-Za-z]?,? (?:January|February|March|April|May|June|July|August|September|October|November|December)\b"#)

private func matches(_ r: NSRegularExpression, _ s: String) -> Bool {
    r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
}

/// A house number followed by a street. Not a year ("In 2019 Parliament Square…"), not a date ("On 12 May Parliament
/// Square…") and not a famous public address. Same rule as the website.
private func looksLikeHomeAddress(_ m: String) -> Bool {
    let s = flatPrefix.stringByReplacingMatches(in: m, range: NSRange(location: 0, length: (m as NSString).length), withTemplate: "")
    if matches(month, s) { return false }
    let nums = m.split(whereSeparator: { !$0.isNumber }).map(String.init)
    if let house = nums.last, house.count == 4, let n = Int(house), (1800...2099).contains(n) { return false }
    return !matches(publicAddress, longStreet(s))
}

private let rules: [Rule] = [
    Rule(kind: .email, regex: re(#"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#)),
    Rule(kind: .iban, regex: re(#"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b"#)),
    Rule(kind: .card, regex: re(#"\b(?:\d[ -]?){13,19}\b"#), check: { m in
        let d = digits(m)
        return (13...19).contains(d.count) && luhnOK(d)
    }),
    Rule(kind: .niNumber, regex: re(#"\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b"#, [.caseInsensitive])),
    // Any number written with a country code: "+44 (0)7700 900123", "+33 6 12 34 56 78", "+39 333 1234567".
    Rule(kind: .phone, regex: re(#"\+\d{1,3}(?:[ .-]?\(0\))?(?:[ .-]?\(?\d{1,4}\)?){2,6}"#), check: { m in
        (9...15).contains(phoneDigits(m).count)
    }),
    // UK mobile/landline (07…, 01…, 02…).
    Rule(kind: .phone, regex: re(#"(?<![\d.,])\(?0\d{2,5}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b"#), check: { m in
        let d = digits(m)
        return d.hasPrefix("0") && d.count > 1 && d.dropFirst().first != "0" && (10...13).contains(d.count)
    }),
    // French numbers in pairs ("06 12 34 56 78") and Italian mobiles ("333 1234567").
    Rule(kind: .phone, regex: re(#"\b0[1-9](?:[ .-]?\d{2}){4}\b"#)),
    Rule(kind: .phone, regex: re(#"(?<![\d.,])\b3\d{2}[ .-]?\d{6,7}\b"#)),
    // After "call me on", "chiamami al", "llámame al", "ruf mich an unter"…: any 9-13 digits in groups (not a run of years).
    Rule(kind: .phone, regex: re(#"\b"# + phoneCue + #"\b[^\d\n]{0,25}(\(?\d{2,4}\)?(?:[ .-]?\d{2,4}){2,4})"#, [.caseInsensitive]), group: 1, check: { m in
        (9...13).contains(phoneDigits(m).count) && !matches(yearsOnly, m)
    }),
    // Only phrases that point at a private person's details (politicians often say "my name is…").
    Rule(kind: .address, regex: re(#"\b(?:I live at|my (?:home )?address is)\s+(\d[^.;\n]{0,60})"#, [.caseInsensitive]), group: 1),
    Rule(kind: .selfDescription, regex: re(#"\b(?:my date of birth is|I was born on)\s+(\d[^.;\n]{0,60})"#, [.caseInsensitive]), group: 1),
    // "I live on Mill Lane": a street given as where the writer lives, even without a house number.
    Rule(kind: .address, regex: re(#"\b(?:I|[Ww]e) live (?:on|in|at) ((?:[A-Z][a-z'’-]+ ){1,3}"# + street + #")\b"#), group: 1),
    // "14 Mill Lane", "Flat 2, 30 Station Road", "221B Baker Street".
    Rule(kind: .address, regex: re(#"\b(?:(?:Flat|Apartment|Apt) \d+[A-Za-z]?,? )?\d{1,4}[A-Za-z]?,? (?:[A-Z][a-z'’-]+ ){1,3}"# + street + #"\b"#), check: looksLikeHomeAddress),
    // A name someone gives as their own, in the five languages ("My name is Jordan Patel", "Mi chiamo Giulia Rossi").
    // Every other mention is removed too.
    Rule(kind: .ownName, regex: re(#"\b(?:[Mm]y name is|[Mm]i chiamo|[Ii]l mio nome è|[Jj]e m['’]appelle|[Mm]on nom est|[Mm]e llamo|[Mm]i nombre es|[Ii]ch hei(?:ß|ss)e|[Mm]ein Name ist) ((?:[A-ZÀ-Ý][a-zà-ÿ'’-]+)(?: [A-ZÀ-Ý][a-zà-ÿ'’-]+){0,2})"#), group: 1),
    Rule(kind: .postcode, regex: re(#"\b[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}\b"#)),
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
            if rule.kind == .postcode {
                // Upper-case postcodes count anywhere except public buildings; lower-case ones only after a cue.
                if matches(publicPostcode, match) { continue }
                let from = max(0, start - 60)
                let before = ns.substring(with: NSRange(location: from, length: start - from))
                if match != match.uppercased() && !matches(postcodeCue, before) { continue }
            }
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
