// Small helpers: the app's colours and type (the website's "Broadsheet" look), and whether the device is online.

import SwiftUI
import Network

// ---------- Colours: ink on paper, rust only for "pay attention", slate only for "ran in the cloud" ----------
extension Color {
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
    static let paper = dynamic(0xF3EFE6, 0x141311)
    static let slip = dynamic(0xFAF8F3, 0x1C1A17)
    static let ink = dynamic(0x111111, 0xF1ECE2)
    static let ink2 = dynamic(0x3B3833, 0xD4CDBF)
    static let muted = dynamic(0x736D65, 0xA39B8C)
    static let rule = dynamic(0xCFC8BA, 0x3A352E)
    static let rust = dynamic(0xA8431A, 0xE0875C)
    static let rustSoft = dynamic(0xF4E3D8, 0x3A2418)
    static let slate = dynamic(0x3E4A5B, 0x9FB0C6)
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

// ---------- Type: a serif for reading (Apple's New York), small capitals for labels ----------
extension Font {
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .serif) }
    static let label = Font.system(size: 11, weight: .heavy)
}

struct Kicker: View {
    let text: String
    var color: Color = .muted
    var body: some View {
        Text(text.uppercased()).font(.label).tracking(1.6).foregroundStyle(color)
    }
}

/// A newspaper rule: a thick line over a thin one.
struct DoubleRule: View {
    var body: some View {
        VStack(spacing: 2) {
            Rectangle().fill(Color.ink).frame(height: 3)
            Rectangle().fill(Color.ink).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}

// ---------- Online or not (offline, only the device can answer) ----------
final class NetworkWatch: @unchecked Sendable {
    static let shared = NetworkWatch()
    private let monitor = NWPathMonitor()
    private(set) var online = true
    private init() {
        monitor.pathUpdateHandler = { [weak self] path in self?.online = path.status == .satisfied }
        monitor.start(queue: DispatchQueue(label: "network-watch"))
    }
}
