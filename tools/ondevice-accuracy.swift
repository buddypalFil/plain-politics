// On-device accuracy check for the iPhone app's first choice: Apple's on-device model (Foundation Models).
// Same idea as tools/accuracy.mjs: explain each built-in sample with the app's own prompt (Core/Prompt.swift),
// then check that every number in the explainer appears in the original and that every section is there.
// "Historical context" is skipped: it is the one section allowed to use outside knowledge.
//
// It calls Apple's model directly (the iPhone app reaches the same model through Firebase AI Logic's
// hybridModel(primary: SystemLanguageModel.default, …)), with the app's settings: temperature 0.3, 1,600 tokens.
// Needs a Mac with Apple Intelligence turned on. Nothing leaves the Mac.
//
//   swiftc -parse-as-library ios/PlainPolitics.swiftpm/Sources/Core/*.swift tools/ondevice-accuracy.swift -o "$TMPDIR/pp-ondevice"
//   "$TMPDIR/pp-ondevice"            # prints one line per explainer and a total, writes ondevice-results.json
import Foundation
import FoundationModels

private struct Run { let label: String; let mode: Mode; let times: Int }
private let runs = [
    Run(label: "Council housing plan", mode: .today, times: 2),
    Run(label: "Campaign speech", mode: .today, times: 2),
    Run(label: "Bill summary", mode: .today, times: 2),
    Run(label: "Minimum wage (real, GOV.UK)", mode: .today, times: 1),
    Run(label: "Lincoln, 1863", mode: .history, times: 1),
    Run(label: "Pankhurst, 1913", mode: .history, times: 1),
    Run(label: "Roosevelt, 1941", mode: .history, times: 1),
]

// "£40 million" -> "40", "1,200" -> "1200", "35%" -> "35"; years and decimals kept (same as tools/accuracy.mjs).
private let numberPattern = try! NSRegularExpression(pattern: #"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"#)
private func numbers(_ s: String) -> [String] {
    let ns = s as NSString
    return numberPattern.matches(in: s, range: NSRange(location: 0, length: ns.length))
        .map { ns.substring(with: $0.range).replacingOccurrences(of: ",", with: "") }
}

private struct Result: Codable {
    let sample: String; let run: Int; let seconds: Double
    let sections: Int; let sectionsExpected: Int
    let numbers: Int; let matched: Int; let missing: [String]
    let error: String?; let markdown: String
}

@main struct OnDeviceAccuracy {
    static func main() async {
        guard case .available = SystemLanguageModel.default.availability else {
            print("Apple's on-device model isn't available here: \(SystemLanguageModel.default.availability)")
            exit(2)
        }
        let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: 1600)
        var results: [Result] = []
        for r in runs {
            guard let sample = samples.first(where: { $0.label == r.label }) else { continue }
            let expected = sectionNames(.en, r.mode).count
            for i in 1...r.times {
                let prompt = buildPrompt(sample.text, lang: .en, level: .balanced, mode: r.mode)
                let start = Date()
                do {
                    let answer = try await LanguageModelSession().respond(to: prompt, options: options).content
                    let secs = Date().timeIntervalSince(start)
                    let sections = parseSections(answer)
                    let checked = sections.filter { !$0.title.localizedCaseInsensitiveContains("Historical context") }
                    let found = checked.flatMap { numbers(([$0.title] + $0.lines + $0.bullets).joined(separator: "\n")) }
                    let inOriginal = Set(numbers(sample.text))
                    let missing = found.filter { !inOriginal.contains($0) }
                    results.append(Result(sample: r.label, run: i, seconds: secs, sections: sections.count, sectionsExpected: expected,
                                          numbers: found.count, matched: found.count - missing.count, missing: missing, error: nil, markdown: answer))
                    print("\(r.label) #\(i): \(found.count - missing.count)/\(found.count) numbers in the original, \(sections.count)/\(expected) sections, \(String(format: "%.1f", secs)) s on the device")
                } catch {
                    results.append(Result(sample: r.label, run: i, seconds: Date().timeIntervalSince(start), sections: 0, sectionsExpected: expected,
                                          numbers: 0, matched: 0, missing: [], error: String(describing: error), markdown: ""))
                    print("\(r.label) #\(i): FAILED: \(error)")
                }
            }
        }
        let ok = results.filter { $0.error == nil }
        let total = ok.reduce(0) { $0 + $1.numbers }, matched = ok.reduce(0) { $0 + $1.matched }
        let complete = ok.filter { $0.sections == $0.sectionsExpected }.count
        let secs = ok.map(\.seconds).sorted()
        let median = secs.isEmpty ? 0 : secs[secs.count / 2]
        print("\nTOTAL: \(ok.count) explainers on the device, \(matched)/\(total) numbers found in the original, sections complete in \(complete)/\(ok.count), median \(String(format: "%.1f", median)) s")
        for o in ok where !o.missing.isEmpty { print("NOT IN THE ORIGINAL: \(o.sample) #\(o.run): \(o.missing.joined(separator: ", "))") }
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted]
        try? enc.encode(results).write(to: URL(fileURLWithPath: "ondevice-results.json"))
        exit(matched == total && complete == ok.count && ok.count == results.count ? 0 : 1)
    }
}
