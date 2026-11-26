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
    expect(kinds.isSuperset(of: [.ownName, .email, .phone, .address]), "privacy finds name, email, phone, address", "\(f)")
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

// Street addresses (same cases as tests/privacy.test.ts)
do {
    for t in ["Send it to 14 Mill Lane, please.", "I'm at Flat 2, 30 Station Road now.",
              "We live on Mill Lane and the bus no longer stops.", "Deliver to 221B Baker Street."] {
        expect(findPersonalData(t).map(\.kind) == [.address], "address found", "\(t) -> \(findPersonalData(t))")
    }
    expect(redact("Write to 14 Mill Lane.") == "Write to [address].", "address redacted", redact("Write to 14 Mill Lane."))
    expect(describeFindings(findPersonalData("Write to 14 Mill Lane.")) == "1 street address", "address described")
    for t in ["A spokesperson at 10 Downing Street said no.", "Protesters marched to 1600 Pennsylvania Avenue.", "The Treasury, at 1 Horse Guards Road, and the Home Office at 2 Marsham Street.",
              "In 2019 Parliament Square filled with protesters.", "On 12 May Parliament Square was closed.",
              "The 12 High Court judges disagreed.", "There are 3 Death Row inmates left.",
              "Downing Street confirmed it. Wall Street fell.", "I live in Northvale, where the buses were cut."] {
        expect(findPersonalData(t).isEmpty, "not an address", "\(t) -> \(findPersonalData(t))")
    }
    for s in samples where !s.text.contains("Jordan Patel") {
        expect(findPersonalData(s.text).isEmpty, "sample has no personal details", s.label)
    }
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
    // Same claim and number rules as the web (src/prompt.ts).
    let t = buildPrompt("x", lang: .it)
    expect(t.contains("in bold, the claim in a few words close to the text's own; then one short sentence on what to check and where"), "claims: bold lead + one sentence, like the web")
    expect(t.contains("Write the words around a number in Italian too") && !t.contains("figure of speech"), "numbers rule; no history-only rule in Today")
    expect(t.contains("keep words like \"half\" or \"one in four\" as words, never as percentages"), "numbers rule: half and one in four stay words")
    expect(h.contains("in bold, a statement the speaker presents") && h.contains("figure of speech"), "history claims and figure-of-speech rule")
}

// Sections
do {
    let md = "## In one sentence\nThe council will build homes.\n## What it says\n- 1,200 homes\n* **35%** affordable\n1. A loan\n## Claims worth checking\n- Paid by a loan"
    let s = parseSections(md)
    expect(s.count == 3 && s[0].lines == ["The council will build homes."] && s[1].bullets == ["1,200 homes", "**35%** affordable", "A loan"], "sections parse", "\(s)")
    // Apple's model writes a claim, then what to check on the next line: they must stay together.
    let c = parseSections("## Claims worth checking\n- **Bus routes will come back**\n  Check official transport data.\n- **Rates frozen.**\nCheck council records.\n- **Schools**\n\n  Check school place data.\n\nA note after the list.")
    expect(c[0].bullets == ["**Bus routes will come back**: Check official transport data.", "**Rates frozen.** Check council records.", "**Schools**: Check school place data."]
           && c[0].lines == ["A note after the list."], "a line under a bullet stays with it", "\(c)")
}

// Samples
expect(samples.count == 7 && samples.filter(\.history).count == 3, "7 samples, 3 history")

// Phones, postcodes and names written other ways and in other languages (same cases as tests/privacy.test.ts)
do {
    let k = { (t: String) in findPersonalData(t).map(\.kind) }
    expect(k("please call me on +44 (0)7700 900123") == [.phone], "phone with (0)", "\(findPersonalData("please call me on +44 (0)7700 900123"))")
    expect(k("Appelez-moi au 06 12 34 56 78 ou au +33 6 12 34 56 78") == [.phone, .phone], "French phones")
    expect(k("Llámame al 612 345 678") == [.phone], "Spanish phone after a cue")
    expect(k("Il mio numero: 333 1234567") == [.phone], "Italian mobile")
    expect(k("Ruf mich an unter 0151 12345678") == [.phone], "German phone")
    expect(k("3 Elm Rd, postcode ne1 4st") == [.address, .postcode], "lower-case postcode after a cue", "\(findPersonalData("3 Elm Rd, postcode ne1 4st"))")
    expect(k("Mi chiamo Giulia Rossi e scrivo per il bus.") == [.ownName], "Italian name")
    expect(k("Je m'appelle Claire Martin.") == [.ownName], "French name")
    expect(k("Ich heiße Jonas Weber.") == [.ownName], "German name")
    expect(describeFindings(findPersonalData("I was born on 3 May 1990.")) == "1 date of birth", "birth date label")
    expect(redact("I live at 14 Mill Lane, Northvale.") == "I live at [address].", "I live at -> address", redact("I live at 14 Mill Lane, Northvale."))
    for t in ["The Prime Minister spoke at 10 Downing St and 11 Downing St.", "A speech at 1600 Pennsylvania Ave.",
              "Write to your MP at the House of Commons, London SW1A 0AA.", "At the G7 5th summit, co2 2nd targets were set.",
              "They call it 2019 2020 2021: three bad years.", "Le budget est de 612 345 678 euros.",
              "Section 12 of the Act costs £1,200 per household."] {
        expect(findPersonalData(t).isEmpty, "public text left alone", "\(t) -> \(findPersonalData(t))")
    }
}

print("\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
