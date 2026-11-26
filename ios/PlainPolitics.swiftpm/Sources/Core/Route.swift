// Decides where a request runs: Apple's on-device model, Gemini in the cloud, or device first with the cloud as
// backup. Same rules as the website (src/route.ts). No Firebase here, so it can be tested.

enum RunChoice: String, CaseIterable, Identifiable {
    case auto, device, cloud
    var id: String { rawValue }
    var title: String {
        switch self {
        case .auto: return "Auto (device first)"
        case .device: return "This device only"
        case .cloud: return "Cloud only"
        }
    }
}

enum Where: Equatable {
    case deviceFirst   // Apple's model first, Gemini if it fails
    case deviceOnly    // never the cloud
    case cloudOnly
}

enum Route: Equatable {
    case run(Where, reason: String)
    case refuse(reason: String, privacy: Bool)
}

struct RouteInput {
    var choice: RunChoice
    var chars: Int
    /// Apple's on-device model takes about 4,096 tokens per request, prompt included.
    var deviceCharLimit: Int = 9_000
    var deviceReady: Bool
    var personal: Bool = false
    var offline: Bool = false
}

func chooseRoute(_ i: RouteInput) -> Route {
    let fits = i.chars <= i.deviceCharLimit
    let limit = "about \(i.deviceCharLimit.formatted()) characters"

    // Offline, only the device can answer, whatever was chosen.
    if i.offline {
        if i.deviceReady && fits { return .run(.deviceOnly, reason: "You're offline, so this ran on your device.") }
        let why = !i.deviceReady ? "Apple Intelligence isn't ready on this device" : "this text is too long for the on-device model (\(limit))"
        return .refuse(reason: "You're offline, and \(why). Connect to the internet to use the cloud.", privacy: false)
    }

    // Privacy guard: a text with personal details never goes to the cloud.
    if i.personal {
        if i.deviceReady && fits && i.choice != .cloud {
            return .run(.deviceOnly, reason: "Personal details found, so this stays on your device. Nothing is sent to the cloud.")
        }
        let why = i.choice == .cloud ? "you chose the cloud" : !fits ? "it is too long for the on-device model" : "Apple Intelligence isn't ready on this device"
        return .refuse(reason: "This text has personal details, and \(why), so it was not sent anywhere. Remove the personal details to use the cloud.", privacy: true)
    }

    switch i.choice {
    case .cloud:
        return .run(.cloudOnly, reason: "You chose the cloud.")
    case .device:
        if !fits { return .refuse(reason: "This text is too long for the on-device model (\(limit)). Shorten it, or choose Auto or Cloud.", privacy: false) }
        if !i.deviceReady { return .refuse(reason: "Apple Intelligence isn't ready on this device. Turn it on in Settings, or choose Auto or Cloud.", privacy: false) }
        return .run(.deviceOnly, reason: "You chose this device only.")
    case .auto:
        if !fits { return .run(.cloudOnly, reason: "Long text, so it went to the cloud.") }
        if !i.deviceReady { return .run(.cloudOnly, reason: "Apple Intelligence isn't ready on this device, so it went to the cloud.") }
        return .run(.deviceFirst, reason: "Device first, cloud only if needed.")
    }
}

/// When Apple's on-device model fails partway through a device-first run, the cloud may take over. Firebase's hybrid
/// session only falls back before the device has answered, so the app does this itself (same rule as the website).
/// Only device-first: a text with personal details runs device-only and never reaches the cloud. Only once, online.
func shouldFallBackToCloud(place: Where, ranOnDevice: Bool, online: Bool, alreadyFellBack: Bool) -> Bool {
    place == .deviceFirst && ranOnDevice && online && !alreadyFellBack
}
