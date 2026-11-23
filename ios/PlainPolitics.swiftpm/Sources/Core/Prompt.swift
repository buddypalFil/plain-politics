// The instructions sent to the AI. The same prompt goes to Apple's on-device model and to Gemini in the cloud, so
// both give the same sections. Word for word the same as the website (src/prompt.ts), so web and iPhone agree.

enum Lang: String, CaseIterable, Identifiable {
    case en, it, fr, es, de
    var id: String { rawValue }
    var name: String {
        switch self {
        case .en: return "English"
        case .it: return "Italian"
        case .fr: return "French"
        case .es: return "Spanish"
        case .de: return "German"
        }
    }
    var menuName: String {
        switch self {
        case .en: return "English"
        case .it: return "Italiano"
        case .fr: return "Français"
        case .es: return "Español"
        case .de: return "Deutsch"
        }
    }
    var headings: [String] {
        switch self {
        case .en: return ["In one sentence", "What it says", "Claims worth checking", "Who it affects", "Words explained", "Questions to ask"]
        case .it: return ["In una frase", "Cosa dice", "Affermazioni da verificare", "Chi riguarda", "Parole spiegate", "Domande da porsi"]
        case .fr: return ["En une phrase", "Ce que dit le texte", "Affirmations à vérifier", "Qui est concerné", "Mots expliqués", "Questions à se poser"]
        case .es: return ["En una frase", "Qué dice", "Afirmaciones que conviene comprobar", "A quién afecta", "Palabras explicadas", "Preguntas que hacerse"]
        case .de: return ["In einem Satz", "Was drinsteht", "Aussagen zum Überprüfen", "Wen es betrifft", "Begriffe erklärt", "Fragen, die man stellen kann"]
        }
    }
    var persuadesHeading: String {
        switch self {
        case .en: return "How it tries to persuade"
        case .it: return "Come cerca di convincere"
        case .fr: return "Comment il cherche à convaincre"
        case .es: return "Cómo intenta convencer"
        case .de: return "Wie es zu überzeugen versucht"
        }
    }
    var contextHeading: String {
        switch self {
        case .en: return "Historical context"
        case .it: return "Contesto storico"
        case .fr: return "Contexte historique"
        case .es: return "Contexto histórico"
        case .de: return "Historischer Kontext"
        }
    }
    var contextNote: String {
        switch self {
        case .en: return "From the AI's general knowledge, not from the text. Check it."
        case .it: return "Dalle conoscenze generali dell'IA, non dal testo. Verificalo."
        case .fr: return "Tiré des connaissances générales de l'IA, pas du texte. À vérifier."
        case .es: return "Del conocimiento general de la IA, no del texto. Compruébalo."
        case .de: return "Aus dem Allgemeinwissen der KI, nicht aus dem Text. Bitte prüfen."
        }
    }
}

enum Level: String, CaseIterable, Identifiable {
    case quick, balanced, detailed
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var hint: String {
        switch self {
        case .quick: return "The key points only"
        case .balanced: return "The main points"
        case .detailed: return "Every section in full"
        }
    }
    fileprivate var bullets: String {
        switch self {
        case .quick: return "Exactly 1 bullet point"
        case .balanced: return "2 to 4 bullet points"
        case .detailed: return "3 to 6 bullet points"
        }
    }
    fileprivate var terms: String {
        switch self {
        case .quick: return "1 bullet point"
        case .balanced: return "Up to 3 bullet points"
        case .detailed: return "Bullet points"
        }
    }
    fileprivate var limit: String? {
        switch self {
        case .quick: return "- Keep every bullet point under 12 words."
        case .balanced: return "- Keep every bullet point under 20 words."
        case .detailed: return nil
        }
    }
}

/// "today": news, bills, manifestos. "history": speeches and documents from the past.
enum Mode: String, CaseIterable, Identifiable {
    case today, history
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

func sectionNames(_ lang: Lang, _ mode: Mode) -> [String] {
    lang.headings + (mode == .history ? [lang.persuadesHeading, lang.contextHeading] : [])
}

func buildPrompt(_ text: String, lang: Lang, level: Level = .balanced, mode: Mode = .today) -> String {
    let h = lang.headings
    let bullets = level.bullets
    let terms = level.terms
    let history = mode == .history
    var lines: [String] = [
        history
            ? "You explain historical political texts (speeches, declarations, letters, laws from the past) to students and ordinary readers in plain words."
            : "You explain political texts (news articles, speeches, bills, manifestos) to ordinary readers in plain words.",
        "Rules:",
        "- Be neutral. Do not take sides, praise or criticise anyone, or say how to vote.",
        history
            ? "- Use only what is in the text, except in the \"\(lang.contextHeading)\" section. Never add facts, numbers or names that are not in it."
            : "- Use only what is in the text. Never add facts, numbers or names that are not in it.",
        "- Copy every number, percentage and amount exactly as the text writes it. Never work out new numbers.",
        "- If the text does not say something, write that it does not say it.",
        "- Use short sentences and everyday words.",
    ]
    if let limit = level.limit { lines.append(limit) }
    lines += [
        "- Write the whole answer in \(lang.name).",
        "",
        "Answer in Markdown with exactly these \(history ? "eight" : "six") sections, in this order:",
        "## \(h[0])",
        "One sentence a 12-year-old would understand.",
        "## \(h[1])",
        "\(bullets) with the main points.",
        "## \(h[2])",
        history
            ? "\(bullets). Each one (do not start with the word \"Claim\"): a statement the speaker presents as a fact or as something everyone agrees on, then what a reader could check about it with history sources (for example whether it was true for everyone at the time). Pick statements about the world, not dates or arithmetic."
            : "\(bullets). Each one: the claim from the text (do not start with the word \"Claim\"), then why a reader should check it.",
        "## \(h[3])",
        history
            ? "\(bullets): the groups of people the speaker talks to or about, and what the text says about them or asks of them. Do not write that the text does not say; name who it addresses."
            : "\(bullets): which groups of people this affects and how, as the text describes it.",
        "## \(h[4])",
        history
            ? "\(terms): **term**: its plain meaning. Choose old-fashioned, formal or unusual words and phrases from the text first, the ones a student today would not know. Only terms that appear in the text."
            : "\(terms): **term**: its plain meaning. Only terms that appear in the text.",
        "## \(h[5])",
        history
            ? "\(bullets): questions a student could ask or look up to understand the text and its time better."
            : "\(bullets): fair questions a reader could ask to understand it better.",
    ]
    if history {
        lines += [
            "## \(lang.persuadesHeading)",
            "\(bullets). Each one starts with the name of a technique in bold (for example **Repetition**, **Emotional words**, **Us and them**, **Appeal to duty**), then a short quote from the text, then what it makes the listener feel or do. Describe the technique only; do not judge whether the cause was right or wrong.",
            "## \(lang.contextHeading)",
            "First line, in italics: _\(lang.contextNote)_",
            "Then \(bullets.lowercased()) of well-known background: when and where this was said or written, what was happening at the time, and what happened next. This is the only section where you may use knowledge from outside the text. Stay neutral and factual. If you are not sure of something, leave it out.",
        ]
    }
    lines += ["", "TEXT:", "\"\"\"", text.trimmingCharacters(in: .whitespacesAndNewlines), "\"\"\""]
    return lines.joined(separator: "\n")
}
