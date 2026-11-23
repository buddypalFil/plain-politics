// Checks the iPhone app's core logic against the same cases as the website's tests.
// Run without Xcode: swiftc ios/PlainPolitics.swiftpm/Sources/Core/*.swift ios/PlainPolitics.swiftpm/CoreTests/main.swift -o /tmp/pp-core && /tmp/pp-core

import Foundation

var passed = 0
var failed = 0
func expect(_ cond: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
    if cond { passed += 1 } else { failed += 1; print("FAIL \(name) \(detail())") }
}

// Privacy guard
do {
    let t = "Dear MP, my name is Jordan Patel. Write to jordan.patel@example.com or call 07700 900123. I live at 12 Mill Lane, NV1 2AB. Jordan Patel"
    let f = findPersonalData(t)
    let kinds = Set(f.map(\.kind))
    expect(kinds.isSuperset(of: [.ownName, .email, .phone, .selfDescription]), "privacy finds name, email, phone, address", "\(f)")
    let r = redact(t, f)
    expect(!r.contains("Jordan") && !r.contains("@") && !r.contains("07700"), "redact removes all", r)
    expect(describeFindings(f).contains("email address"), "describe", describeFindings(f))
    let budget = "The plan costs £1,200,000,000 over 5 years, about 35% more than in 2019. Call it 2026-2030."
    expect(findPersonalData(budget).isEmpty, "budget numbers are not personal", "\(findPersonalData(budget))")
    let card = "Card 4111 1111 1111 1111 please"
    expect(findPersonalData(card).map(\.kind) == [.card], "valid card found")
    // A name given in one text is removed from the other (Compare on the web).
    let a = "My name is Jordan Patel and I live in Northvale."
    let b = "Jordan Patel says crime fell by 20%."
    let both = findPersonalData(a + "\n\n" + b)
    expect(!redactKnown(redact(b), both).contains("Jordan"), "name removed from the other text")
}

// Routing
do {
    let base = RouteInput(choice: .auto, chars: 1000, deviceReady: true)
    expect(chooseRoute(base) == .run(.deviceFirst, reason: "Device first, cloud only if needed."), "auto + ready -> device first")
    var i = base; i.choice = .cloud
    if case .run(.cloudOnly, _) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL cloud choice") }
    i = base; i.chars = 50_000
    if case .run(.cloudOnly, _) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL long -> cloud") }
    i = base; i.personal = true; i.choice = .cloud
    if case .refuse(_, true) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL personal + cloud refused") }
    i = base; i.personal = true
    if case .run(.deviceOnly, _) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL personal -> device only") }
    i = base; i.offline = true; i.choice = .cloud
    if case .run(.deviceOnly, _) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL offline -> device only") }
    i = base; i.offline = true; i.deviceReady = false
    if case .refuse = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL offline + no device refused") }
    i = base; i.deviceReady = false
    if case .run(.cloudOnly, _) = chooseRoute(i) { passed += 1 } else { failed += 1; print("FAIL no device -> cloud") }
}

// Spot the spin: the campaign speech sample finds the same 10 words as the website
do {
    let speech = samples.first { $0.label == "Campaign speech" }!.text
    let m = findSpin(speech)
    let counts = countByKind(m)
    expect(m.count == 10, "campaign speech has 10 spin words", "\(m.map(\.text))")
    expect(counts[.pressure] == 3 && counts[.soft] == 3 && counts[.emotion] == 2, "kinds match the web", "\(counts)")
    let t = "For too long we were forgotten. My opponents say nothing. We can’t afford to wait: it's time."
    expect(findSpin(t).map { $0.text.lowercased() } == ["for too long", "forgotten", "my opponents", "nothing", "can’t afford", "it's time"], "phrases, curly apostrophe", "\(findSpin(t).map(\.text))")
    expect(findSpin("Nevertheless the alwaysOn setting is fine.").isEmpty, "whole words only")
    expect(findSpin("They betrayed us. A betrayal.").map(\.text) == ["betrayed", "betrayal"], "wildcard endings")
}

// Prompts
do {
    for lang in Lang.allCases {
        let p = buildPrompt("Some text here.", lang: lang)
        expect(p.contains("## \(lang.headings[1])") && p.contains("in \(lang.name)."), "prompt headings \(lang)")
    }
    let h = buildPrompt("x", lang: .en, level: .quick, mode: .history)
    expect(h.contains("## How it tries to persuade") && h.contains("## Historical context") && h.contains("under 12 words"), "history prompt")
    expect(sectionNames(.de, .history).count == 8, "history has 8 sections")
}

// Sections
do {
    let md = "## In one sentence\nThe council will build homes.\n## What it says\n- 1,200 homes\n* **35%** affordable\n1. A loan\n## Claims worth checking\n- Paid by a loan"
    let s = parseSections(md)
    expect(s.count == 3 && s[0].lines == ["The council will build homes."] && s[1].bullets == ["1,200 homes", "**35%** affordable", "A loan"], "sections parse", "\(s)")
}

// Samples
expect(samples.count == 7 && samples.filter(\.history).count == 3, "7 samples, 3 history")

print("\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
