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
// Every size grows with the reader's text size (Settings > Accessibility > Display & Text Size), from the design's
// size at the default setting: reading text all the way up, labels and buttons up to the second accessibility size,
// so a row of them still fits on a phone.
private struct ScaledFont: ViewModifier {
    @Environment(\.dynamicTypeSize) private var typeSize
    let size: CGFloat, weight: Font.Weight, design: Font.Design, italic: Bool, cap: DynamicTypeSize
    func body(content: Content) -> some View {
        let style: UIFont.TextStyle = size >= 26 ? .largeTitle : size >= 18 ? .title3 : size >= 14 ? .body : .caption1
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(min(typeSize, cap)))
        let font = Font.system(size: UIFontMetrics(forTextStyle: style).scaledValue(for: size, compatibleWith: traits), weight: weight, design: design)
        return content.font(italic ? font.italic() : font)
    }
}

extension View {
    /// Reading text in the serif.
    func serif(_ size: CGFloat, _ weight: Font.Weight = .regular, italic: Bool = false) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: .serif, italic: italic, cap: .accessibility5))
    }
    /// Labels and buttons in the sans.
    func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: .default, italic: false, cap: .accessibility2))
    }
}

/// Side by side normally; one above the other at the accessibility text sizes, where side by side won't fit.
struct AdaptiveStack<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    var alignment: VerticalAlignment = .center
    var spacing: CGFloat? = nil
    @ViewBuilder let content: () -> Content
    var body: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4, content: content).frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(alignment: alignment, spacing: spacing, content: content)
        }
    }
}

struct Kicker: View {
    let text: String
    var color: Color = .muted
    var body: some View {
        Text(text.uppercased()).sans(11, .heavy).tracking(1.6).foregroundStyle(color)
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
