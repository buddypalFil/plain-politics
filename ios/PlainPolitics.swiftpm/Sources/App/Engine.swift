// Every Firebase AI Logic call lives here. Hybrid mode: Apple's on-device model (Apple Intelligence) first, Gemini in
// the cloud as backup, or only one of them, as decided by chooseRoute (Core/Route.swift).

import Foundation
import FirebaseAILogic
import os

/// The cloud model, the same one the website uses by default (Remote Config "cloud_model").
let cloudModelName = "gemini-3.5-flash-lite"

enum DeviceAI: Equatable {
    case ready
    case notEligible       // this device doesn't support Apple Intelligence
    case notEnabled        // Apple Intelligence is off in Settings
    case downloading       // the model is still downloading
    case unavailable(String)

    var ready: Bool { self == .ready }

    /// The line at the top of the app.
    var status: String {
        switch self {
        case .ready: return "On-device AI ready"
        case .notEligible: return "Using the cloud"
        case .notEnabled: return "Cloud for now (turn on Apple Intelligence)"
        case .downloading: return "Apple Intelligence downloading…"
        case .unavailable: return "Using the cloud"
        }
    }

    /// The help under the Explain button, when the device can't run it.
    var help: String? {
        switch self {
        case .ready: return nil
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

    private lazy var ai = FirebaseAI.firebaseAI(backend: .googleAI())

    var deviceAI: DeviceAI {
        switch FirebaseAI.SystemLanguageModel.default.availability {
        case .available: return .ready
        case .unavailable(.deviceNotEligible): return .notEligible
        case .unavailable(.appleIntelligenceNotEnabled): return .notEnabled
        case .unavailable(.modelNotReady): return .downloading
        case .unavailable(let reason): return .unavailable(String(describing: reason))
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
        let cloud = ai.geminiModel(name: cloudModelName)
        let device = FirebaseAI.SystemLanguageModel.default
        // Same settings for both models: calm, factual answers of a sensible length.
        let options: ResponseGenerationOptions = .hybrid(
            gemini: GenerationConfig(temperature: 0.3, maxOutputTokens: 1600),
            foundationModels: FirebaseAI.GenerationOptions(temperature: 0.3, maximumResponseTokens: 1600)
        )
        // If Google's servers are briefly overloaded, try once more after a short pause before showing an error.
        for attempt in 1...2 {
            // A fresh session each time, so a failed attempt isn't part of the conversation.
            let session = switch place {
            case .deviceFirst: ai.generativeModelSession(model: .hybridModel(primary: device, secondary: cloud))
            case .deviceOnly: ai.generativeModelSession(model: device)
            case .cloudOnly: ai.generativeModelSession(model: cloud)
            }
            do {
                markdown = ""
                // The answer streams in; each snapshot holds the whole answer so far.
                for try await snapshot in session.streamResponse(to: prompt, options: options) {
                    markdown = snapshot.content
                    // Firebase names Apple's on-device model "apple-foundation-models-system-language-model".
                    ranOnDevice = snapshot.rawResponse.modelVersion.contains("apple-foundation-models")
                }
                if ranOnDevice == nil { ranOnDevice = place == .deviceOnly }
                return
            } catch {
                if attempt == 1 && Self.isBusy(error) {
                    try? await Task.sleep(for: .seconds(2))
                    continue
                }
                self.error = friendly(error)
                return
            }
        }
    }

    /// Google's "high demand" / overloaded replies: temporary, worth one retry.
    private static func isBusy(_ e: Error) -> Bool {
        let m = String(reflecting: e)
        return m.localizedCaseInsensitiveContains("high demand") || m.localizedCaseInsensitiveContains("overloaded")
            || m.contains("httpResponseCode: 503") || m.contains("httpResponseCode: 500") || m.contains("UNAVAILABLE")
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
