// Every Firebase AI Logic call lives here. Hybrid mode: Apple's on-device model (Apple Intelligence) first, Gemini in
// the cloud as backup, or only one of them, as decided by chooseRoute (Core/Route.swift).

import Foundation
import FirebaseAILogic
import os

/// The cloud model, the same one the website uses by default (Remote Config "cloud_model").
let cloudModelName = "gemini-3.5-flash-lite"

enum DeviceAI: Equatable {
    case ready
    case checking          // the system says it's available; a tiny test request is checking that it really answers
    case notResponding     // the system says it's available, but the model didn't answer the test request
    case notEligible       // this device doesn't support Apple Intelligence
    case notEnabled        // Apple Intelligence is off in Settings
    case downloading       // the model is still downloading
    case unavailable(String)

    var ready: Bool { self == .ready }
    /// Worth trying on the device: ready, or still being checked (Firebase falls back to the cloud if it fails).
    var usable: Bool { self == .ready || self == .checking }

    /// The line at the top of the app.
    var status: String {
        switch self {
        case .ready: return "On-device AI ready"
        case .checking: return "Checking on-device AI…"
        case .notResponding: return "Using the cloud"
        case .notEligible: return "Using the cloud"
        case .notEnabled: return "Cloud for now (turn on Apple Intelligence)"
        case .downloading: return "Apple Intelligence downloading…"
        case .unavailable: return "Using the cloud"
        }
    }

    /// The help under the Explain button, when the device can't run it.
    var help: String? {
        switch self {
        case .ready, .checking: return nil
        case .notResponding: return "Apple Intelligence is on, but its model didn't answer (it may still be downloading), so the cloud is used. The app checks again when you come back to it."
        case .notEligible: return "This device can't run Apple Intelligence, so the cloud is used. On an iPhone 15 Pro or newer, explainers can stay on your device."
        case .notEnabled: return "Want it private? Turn on Apple Intelligence in Settings > Apple Intelligence & Siri. Until then the cloud is used."
        case .downloading: return "Apple Intelligence is still downloading its model. Until it's ready, the cloud is used."
        case .unavailable(let why): return "On-device AI isn't available here (\(why)), so the cloud is used."
        }
    }
}

@MainActor
final class Engine: ObservableObject {
    @Published var markdown = ""
    @Published var running = false
    @Published var ranOnDevice: Bool?
    @Published var seconds = 0.0
    @Published var error: String?

    /// Whether Apple's model really answered a test request (nil: not checked yet). The system can report it as
    /// available while it can't run yet, e.g. in the Simulator before the Mac's model has downloaded.
    @Published private(set) var deviceAnswers: Bool?
    private var checkingDevice = false

    private lazy var ai = FirebaseAI.firebaseAI(backend: .googleAI())

    var deviceAI: DeviceAI {
        switch FirebaseAI.SystemLanguageModel.default.availability {
        case .available:
            switch deviceAnswers {
            case true?: return .ready
            case false?: return .notResponding
            case nil: return .checking
            }
        case .unavailable(.deviceNotEligible): return .notEligible
        case .unavailable(.appleIntelligenceNotEnabled): return .notEnabled
        case .unavailable(.modelNotReady): return .downloading
        case .unavailable(let reason): return .unavailable(String(describing: reason))
        }
    }

    /// Asks Apple's model for one word, on the device, to see that it really answers. Also loads the model, so the
    /// first explainer starts faster. Runs when the app opens and when it comes back to the front.
    func checkDevice() async {
        guard !checkingDevice, deviceAnswers != true,
              case .available = FirebaseAI.SystemLanguageModel.default.availability else { return }
        checkingDevice = true
        defer { checkingDevice = false }
        let session = ai.generativeModelSession(model: FirebaseAI.SystemLanguageModel.default)
        let options: ResponseGenerationOptions = .hybrid(
            gemini: GenerationConfig(temperature: 0, maxOutputTokens: 5),
            foundationModels: FirebaseAI.GenerationOptions(temperature: 0, maximumResponseTokens: 5)
        )
        do {
            for try await _ in session.streamResponse(to: "Reply with one word: OK", options: options) {}
            deviceAnswers = true
        } catch {
            #if DEBUG
            Logger(subsystem: "com.grosolistudio.plainpolitics", category: "explain")
                .error("On-device check failed: \(String(reflecting: error), privacy: .public)")
            #endif
            deviceAnswers = false
        }
    }

    func explain(prompt: String, where place: Where) async {
        running = true
        error = nil
        markdown = ""
        ranOnDevice = nil
        let start = Date()
        defer {
            running = false
            seconds = Date().timeIntervalSince(start)
        }
        // timeout: the most the cloud may stay silent, before or during the answer (the library's default is 3 minutes);
        // a silent cloud then counts as busy below, and is tried once more.
        let cloud = ai.geminiModel(name: cloudModelName, requestOptions: RequestOptions(timeout: 30))
        let device = FirebaseAI.SystemLanguageModel.default
        // Same settings for both models: calm, factual answers of a sensible length.
        let options: ResponseGenerationOptions = .hybrid(
            gemini: GenerationConfig(temperature: 0.3, maxOutputTokens: 1600),
            foundationModels: FirebaseAI.GenerationOptions(temperature: 0.3, maximumResponseTokens: 1600)
        )
        // When Google's servers are overloaded, the cloud can stop mid-answer with a "high demand" error. Try again
        // after a short pause. The first two tries stream (fastest when Google is healthy); the last asks for the
        // whole answer in one go, which got through more often in busy spells (same as the website).
        let attempts = 3
        var longestPartial = ""
        var place = place
        var fellBack = false
        var attempt = 1
        while attempt <= attempts {
            defer { attempt += 1 }
            // A fresh session each time, so a failed attempt isn't part of the conversation.
            let session = switch place {
            case .deviceFirst: ai.generativeModelSession(model: .hybridModel(primary: device, secondary: cloud))
            case .deviceOnly: ai.generativeModelSession(model: device)
            case .cloudOnly: ai.generativeModelSession(model: cloud)
            }
            do {
                markdown = ""
                if attempt == attempts {
                    let whole = try await session.respond(to: prompt, options: options)
                    markdown = whole.content
                    ranOnDevice = whole.rawResponse.modelVersion.contains("apple-foundation-models")
                } else {
                    // The answer streams in; each snapshot holds the whole answer so far.
                    for try await snapshot in session.streamResponse(to: prompt, options: options) {
                        markdown = snapshot.content
                        // Firebase names Apple's on-device model "apple-foundation-models-system-language-model".
                        ranOnDevice = snapshot.rawResponse.modelVersion.contains("apple-foundation-models")
                    }
                }
                if ranOnDevice == nil { ranOnDevice = place == .deviceOnly }
                if ranOnDevice == true { deviceAnswers = true }
                return
            } catch {
                // Apple's model failed partway (device-first only): Gemini in the cloud takes over, once.
                if shouldFallBackToCloud(place: place, ranOnDevice: ranOnDevice ?? true, online: NetworkWatch.shared.online, alreadyFellBack: fellBack) {
                    fellBack = true
                    place = .cloudOnly
                    ranOnDevice = nil
                    markdown = ""
                    longestPartial = ""
                    attempt = 0
                    continue
                }
                if markdown.count > longestPartial.count { longestPartial = markdown }
                if attempt < attempts && Self.isBusy(error) {
                    try? await Task.sleep(for: .seconds(2 * attempt))
                    continue
                }
                // Show the most that ever arrived, not just what the last try managed.
                markdown = longestPartial
                self.error = friendly(error)
                return
            }
        }
    }

    /// Google's "high demand" / overloaded replies, or a cloud that went silent: temporary, worth one retry.
    private static func isBusy(_ e: Error) -> Bool {
        let m = String(reflecting: e)
        return m.localizedCaseInsensitiveContains("high demand") || m.localizedCaseInsensitiveContains("overloaded")
            || m.contains("httpResponseCode: 503") || m.contains("httpResponseCode: 500") || m.contains("UNAVAILABLE")
            || timedOut(e)
    }

    /// The request went 30 seconds without hearing from the cloud.
    private static func timedOut(_ e: Error) -> Bool {
        var error: NSError? = e as NSError
        while let n = error {
            if n.domain == NSURLErrorDomain && n.code == NSURLErrorTimedOut { return true }
            error = n.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return String(reflecting: e).localizedCaseInsensitiveContains("timed out")
    }

    private func friendly(_ e: Error) -> String {
        #if DEBUG
        Logger(subsystem: "com.grosolistudio.plainpolitics", category: "explain")
            .error("Explain failed: \(String(reflecting: e), privacy: .public)")
        #endif
        // Firebase wraps the server's reply inside its own error, so read the full description, not just the summary.
        let m = String(describing: e) + " " + String(reflecting: e) + " " + (e as NSError).userInfo.description
        if !NetworkWatch.shared.online { return "The connection dropped before the answer arrived. Check your internet and try again." }
        if m.localizedCaseInsensitiveContains("appcheck") || m.localizedCaseInsensitiveContains("app check")
            || m.contains("403") || m.contains("401") {
            return "Firebase couldn't confirm this app (App Check), so the cloud AI was blocked."
        }
        if m.contains("429") || m.localizedCaseInsensitiveContains("quota") { return "The cloud AI has reached its limit for the moment. Wait a minute and try again." }
        if Self.timedOut(e) {
            let cut = markdown.isEmpty ? "" : "The answer was cut short. "
            return cut + "Google's cloud AI stopped answering, even after trying again. Wait a minute and try again."
        }
        if Self.isBusy(e) {
            let cut = markdown.isEmpty ? "" : "The answer was cut short. "
            return cut + "Google's cloud AI is very busy right now. Wait a minute and try again."
        }
        if m.localizedCaseInsensitiveContains("safety") || m.localizedCaseInsensitiveContains("guardrail") {
            return "The AI wouldn't answer because of its safety filters. Strong language in political texts can trigger this: try a shorter extract."
        }
        if m.localizedCaseInsensitiveContains("context") || m.localizedCaseInsensitiveContains("exceeded") {
            return "This text is too long for the on-device model. Choose Run on: Auto or Cloud only."
        }
        return "Something went wrong: \(e.localizedDescription)"
    }
}
