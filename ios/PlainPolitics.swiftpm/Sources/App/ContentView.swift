// The one screen: your text, the choices, and the explainer laid out like a newspaper, the same as the website.

import SwiftUI

struct ContentView: View {
    @StateObject private var engine = Engine()
    @State private var mode: Mode = .today
    @State private var level: Level = .balanced
    @State private var lang: Lang = .en
    @State private var run: RunChoice = .auto
    @State private var text = ""
    @State private var refusal: (reason: String, privacy: Bool)?
    @State private var routeNote = ""
    @State private var explainedText = ""
    @State private var spinKind: SpinKind?
    @FocusState private var editing: Bool
    @Environment(\.scenePhase) private var scenePhase

    private var findings: [Finding] { findPersonalData(text) }
    private var deviceAI: DeviceAI { engine.deviceAI }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                masthead
                modeTabs
                yourText
                choices
                explainButton
                if let r = refusal { refusalBox(r) }
                if let e = engine.error { notice(e) }
                if engine.running || !engine.markdown.isEmpty { explainer }
                howItWorks
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            // A text editor has no Return-to-close, so give the keyboard a Done button.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { editing = false }.bold()
            }
        }
        .background(Color.paper.ignoresSafeArea())
        .foregroundStyle(Color.ink)
        .tint(.ink)
        // Make sure Apple's model really answers before the masthead says it's ready (checked again on return,
        // e.g. after turning on Apple Intelligence or once its model has downloaded).
        .task { await engine.checkDevice() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await engine.checkDevice() } }
        }
    }

    // ---------- Masthead ----------
    private var masthead: some View {
        VStack(spacing: 6) {
            AdaptiveStack {
                Text(Date.now.formatted(date: .long, time: .omitted).uppercased())
                Spacer()
                HStack {
                    Circle().stroke(lineWidth: 1.5).frame(width: 7, height: 7)
                        .background(Circle().fill(deviceAI.ready ? Color.ink : .clear))
                    Text(deviceAI.status.uppercased())
                }
            }
            .sans(10, .semibold).tracking(1.2).foregroundStyle(Color.ink2)
            Rectangle().fill(Color.ink).frame(height: 1)
            Text("Plain Politics")
                .serif(46, .black)
                .minimumScaleFactor(0.4).lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
                .accessibilityAddTraits(.isHeader)
            Text("Political text, explained in plain words.")
                .serif(16, italic: true).foregroundStyle(Color.ink2)
                .frame(maxWidth: .infinity)
            DoubleRule().padding(.top, 6)
        }
        .padding(.top, 8)
    }

    private var modeTabs: some View {
        HStack(spacing: 22) {
            ForEach(Mode.allCases) { m in
                Button { mode = m } label: {
                    Text(m.title.uppercased()).sans(12, .semibold).tracking(1.4)
                        .foregroundStyle(mode == m ? Color.ink : Color.muted)
                        .padding(.bottom, 4)
                        .overlay(alignment: .bottom) { Rectangle().fill(mode == m ? Color.ink : .clear).frame(height: 2) }
                }
                .accessibilityAddTraits(mode == m ? .isSelected : [])
            }
            Spacer()
        }
    }

    // ---------- Your text ----------
    private var yourText: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kicker(text: "Your text")
            Text(mode == .history
                 ? "A speech, declaration or letter from the past. Try a real speech:"
                 : "A news article, a speech, a bill or a manifesto. Or try a sample (made up, or one real press release):")
                .serif(15).foregroundStyle(Color.muted)
            FlowRow(samples.filter { $0.history == (mode == .history) }) { s in
                Button { text = s.text; refusal = nil } label: { Text(s.label).multilineTextAlignment(.leading) }
                    .serif(15, .medium).underline(color: .rule)
            }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .focused($editing)
                    .serif(15)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 170, maxHeight: 260)
                    .background(Color.slip)
                    .overlay(Rectangle().stroke(editing ? Color.ink : Color.rule, lineWidth: 1))
                    .accessibilityLabel("Text to explain")
                if text.isEmpty {
                    Text("Paste the text here…").serif(15).foregroundStyle(Color.muted)
                        .padding(.horizontal, 13).padding(.vertical, 16).allowsHitTesting(false)
                }
            }
            HStack(alignment: .top) {
                if findings.isEmpty {
                    Text("Privacy guard is on: personal details never go to the cloud.").foregroundStyle(Color.ink2)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(deviceAI.usable
                             ? "Found \(describeFindings(findings)). This text will only run on your device."
                             : "Found \(describeFindings(findings)). These never go to the cloud, and on-device AI isn't ready here, so remove them to explain this text.")
                        Button("Remove them") { text = redact(text) }.bold().underline()
                    }
                    .foregroundStyle(Color.rust)
                    .padding(8).background(Color.rustSoft)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.rust).frame(width: 3) }
                }
                Spacer()
                Text("\(text.count) characters").foregroundStyle(Color.muted)
            }
            .sans(12.5, .medium)
        }
    }

    // ---------- Choices: the ballot, language, where it runs ----------
    private var choices: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(spacing: 0) {
                HStack { Kicker(text: "How much detail", color: .ink); Spacer(); Kicker(text: "Mark one") }
                    .padding(.bottom, 6)
                ForEach(Level.allCases) { l in
                    Button { level = l } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.title).serif(18, .bold)
                                Text(l.hint).sans(12, .medium).foregroundStyle(Color.muted)
                            }
                            Spacer()
                            BallotBox(marked: level == l)
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .top) { Rectangle().fill(Color.ink).frame(height: 1) }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(level == l ? .isSelected : [])
                }
            }
            .padding(12)
            .background(Color.slip)
            .overlay(Rectangle().stroke(Color.ink, lineWidth: 2))

            row("Language") {
                Picker("Language", selection: $lang) { ForEach(Lang.allCases) { Text($0.menuName).tag($0) } }
            }
            row("Run on") {
                Picker("Run on", selection: $run) { ForEach(RunChoice.allCases) { Text($0.title).tag($0) } }
            }
        }
    }

    private func row(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        let picker = content()
        return AdaptiveStack {
            Text(label).sans(13, .medium).foregroundStyle(Color.muted)
            Spacer()
            picker.pickerStyle(.menu)
        }
        .padding(.vertical, 2)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.rule).frame(height: 1) }
    }

    // ---------- Explain ----------
    private var explainButton: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { Task { await explain() } } label: {
                Text(engine.running ? "EXPLAINING…" : "EXPLAIN IT")
                    .sans(14, .bold).tracking(1.2)
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
                    .foregroundStyle(Color.paper).background(Color.ink)
            }
            .disabled(engine.running)
            if let help = deviceAI.help {
                Text(help).sans(12.5, .medium).foregroundStyle(Color.muted)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.rule).frame(width: 2) }
            }
        }
    }

    private func explain() async {
        editing = false
        refusal = nil
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 40 else {
            refusal = ("Paste a longer text first (a paragraph or more), or pick a sample.", false)
            return
        }
        let route = chooseRoute(RouteInput(choice: run, chars: t.count, deviceReady: deviceAI.usable,
                                           personal: !findPersonalData(t).isEmpty, offline: !NetworkWatch.shared.online))
        switch route {
        case .refuse(let reason, let privacy):
            refusal = (reason, privacy)
        case .run(let place, let reason):
            routeNote = reason
            explainedText = t
            spinKind = nil
            await engine.explain(prompt: buildPrompt(t, lang: lang, level: level, mode: mode), where: place)
        }
    }

    private func refusalBox(_ r: (reason: String, privacy: Bool)) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            notice(r.reason)
            if r.privacy {
                Button("Remove personal details and continue") {
                    text = redact(text)
                    Task { await explain() }
                }
                .sans(13, .semibold)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .overlay(Rectangle().stroke(Color.ink, lineWidth: 1.5))
            }
        }
    }

    private func notice(_ message: String) -> some View {
        Text(message).sans(14, .medium).foregroundStyle(Color.rust)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10).background(Color.rustSoft)
            .overlay(alignment: .leading) { Rectangle().fill(Color.rust).frame(width: 3) }
    }

    // ---------- The explainer ----------
    private var explainer: some View {
        let sections = parseSections(engine.markdown)
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Kicker(text: "The explainer", color: .ink2)
                Spacer()
                Kicker(text: "Neutral · takes no side")
            }
            .padding(.bottom, 2)
            .overlay(alignment: .bottom) { Rectangle().fill(Color.ink).frame(height: 1).offset(y: 6) }

            Stamp(running: engine.running, onDevice: engine.ranOnDevice, seconds: engine.seconds)
            if !routeNote.isEmpty { Text(routeNote).serif(13.5, italic: true).foregroundStyle(Color.muted) }

            ForEach(sections) { s in
                if s.id == 0 {
                    VStack(alignment: .leading, spacing: 4) {
                        Kicker(text: s.title.isEmpty ? lang.headings[0] : s.title)
                        Text(md(s.lines.joined(separator: " "))).serif(30, .bold).fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    SectionView(section: s)
                }
            }
            if engine.running {
                ProgressView().tint(.ink).frame(maxWidth: .infinity)
            } else if !engine.markdown.isEmpty {
                SpinView(text: explainedText, kind: $spinKind)
                ShareLink(item: shareText(sections)) {
                    Text("SHARE").sans(12, .bold).tracking(1.2).underline()
                }
                .padding(.top, 4)
            }
        }
        .padding(.top, 8)
    }

    private func shareText(_ sections: [Section]) -> String {
        var out = ""
        for s in sections {
            out += "\(s.title.uppercased())\n"
            out += (s.lines + s.bullets.map { "• \($0)" }).joined(separator: "\n").replacingOccurrences(of: "**", with: "") + "\n\n"
        }
        return out + "Explained by Plain Politics: https://plain-politics-app.web.app"
    }

    // ---------- How it works ----------
    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Color.ink).frame(height: 3)
            Kicker(text: "How it works")
            Text("1. **Your text** stays in the app. 2. The **privacy guard** looks for emails, phone numbers, home addresses, postcodes, bank, card and National Insurance numbers and your own name, on your device. 3. **Apple Intelligence** explains it on your device when it can; **Gemini** in the cloud only when it can't, never with personal details. 4. A **stamp** says where it ran.")
                .serif(14).foregroundStyle(Color.ink2)
            Text("Spot the spin always runs on your device. AI can make mistakes, so check important claims against the original source.")
                .sans(12, .medium).foregroundStyle(Color.muted)
        }
        .padding(.top, 20)
    }
}

/// Bold and italics from the model's Markdown; never HTML, links open in the browser.
func md(_ s: String) -> AttributedString {
    (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
}

// ---------- Pieces ----------
struct BallotBox: View {
    let marked: Bool
    var body: some View {
        ZStack {
            Rectangle().stroke(Color.ink, lineWidth: 2)
            if marked {
                Path { p in p.move(to: .init(x: 5, y: 5)); p.addLine(to: .init(x: 23, y: 23)); p.move(to: .init(x: 23, y: 5)); p.addLine(to: .init(x: 5, y: 23)) }
                    .stroke(Color.ink, style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }
        .frame(width: 28, height: 28)
        .accessibilityHidden(true)
    }
}

struct Stamp: View {
    let running: Bool
    let onDevice: Bool?
    let seconds: Double
    var body: some View {
        let device = onDevice ?? true
        let color: Color = device ? .ink : .slate
        AdaptiveStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(running ? "WORKING…" : device ? "RAN ON YOUR DEVICE" : "RAN IN THE CLOUD").sans(15, .heavy)
            if !running {
                Text(String(format: "%.1f S · %@", seconds, device ? "NOTHING SENT" : "GOOGLE GEMINI")).sans(11, .semibold)
            }
        }
        .tracking(0.8).foregroundStyle(color)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .overlay(Rectangle().stroke(color, lineWidth: 2.5))
        .rotationEffect(.degrees(-1.5))
        .opacity(running ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }
}

struct SectionView: View {
    let section: Section
    @ScaledMetric(relativeTo: .largeTitle) private var dot: CGFloat = 6 // grows gently with the text size
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Color.rule).frame(height: 1)
            Kicker(text: section.title, color: .ink)
            ForEach(Array(section.lines.enumerated()), id: \.offset) { _, line in
                Text(md(line)).serif(16).foregroundStyle(Color.ink2)
            }
            ForEach(Array(section.bullets.enumerated()), id: \.offset) { _, b in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Rectangle().fill(Color.ink).frame(width: dot, height: dot).alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                    Text(md(b)).serif(16.5).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Spot the spin: the original text with loaded words marked in rust, filtered by kind.
struct SpinView: View {
    let text: String
    @Binding var kind: SpinKind?
    var body: some View {
        let matches = findSpin(text)
        let counts = countByKind(matches)
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(Color.ink).frame(height: 3)
            HStack {
                Kicker(text: "Spot the spin", color: .ink)
                Spacer()
                Kicker(text: "On your device · nothing sent")
            }
            if matches.isEmpty {
                Text("No loaded words from our list in this text.").serif(15, italic: true).foregroundStyle(Color.ink2)
            } else {
                FlowRow([nil] + SpinKind.allCases.filter { counts[$0] != nil }) { (k: SpinKind?) in
                    Button { kind = k } label: {
                        Text("\(k?.name ?? "All") \(k.flatMap { counts[$0] } ?? matches.count)")
                            .sans(12, .semibold).multilineTextAlignment(.leading)
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .foregroundStyle(kind == k ? Color.paper : Color.ink)
                            .background(kind == k ? Color.ink : .clear)
                            .overlay(Rectangle().stroke(Color.ink, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
                Text(kind?.why ?? "Pick a kind to see only those words, and why they matter.")
                    .serif(15, italic: true).foregroundStyle(Color.ink2)
                Text(highlighted(matches))
                    .serif(15).lineSpacing(4)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.slip).overlay(Rectangle().stroke(Color.rule, lineWidth: 1))
            }
            Text("Loaded words aren't wrong, and every side uses them. This word list only helps you notice them.")
                .sans(12, .medium).foregroundStyle(Color.muted)
        }
    }

    private func highlighted(_ matches: [SpinMatch]) -> AttributedString {
        let ns = text as NSString
        var out = AttributedString()
        var at = 0
        for m in matches {
            out += AttributedString(ns.substring(with: NSRange(location: at, length: m.range.location - at)))
            var piece = AttributedString(m.text)
            if kind == nil || kind == m.kind {
                piece.backgroundColor = .rustSoft
                piece.underlineStyle = .single
                piece.underlineColor = UIColor(Color.rust)
                piece.foregroundColor = .ink
            }
            out += piece
            at = NSMaxRange(m.range)
        }
        return out + AttributedString(ns.substring(from: at))
    }
}

/// Lays out small views in rows that wrap, like words in a paragraph.
struct FlowRow<Item, Content: View>: View {
    let items: [Item]
    let content: (Item) -> Content
    init(_ items: [Item], @ViewBuilder content: @escaping (Item) -> Content) {
        self.items = items
        self.content = content
    }
    var body: some View {
        WrapLayout(spacing: 8, lineSpacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in content(item) }
        }
    }
}

struct WrapLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let laid = arrange(width: bounds.width, subviews)
        for (i, p) in laid.points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: ProposedViewSize(laid.sizes[i]))
        }
    }
    private func arrange(width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], sizes: [CGSize], size: CGSize) {
        var points: [CGPoint] = [], sizes: [CGSize] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            var size = s.sizeThatFits(.unspecified)
            // Wider than a whole line (a long label at a large text size): give it the line's width so it wraps.
            if size.width > width { size = s.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + lineSpacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y)); sizes.append(size)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, sizes, CGSize(width: maxX, height: y + rowHeight))
    }
}
