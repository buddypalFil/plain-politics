// swift-tools-version: 5.9
// Plain Politics for iPhone and iPad: an app package that Xcode opens directly (double-click the .swiftpm folder).
// Firebase AI Logic's hybrid mode runs Apple's on-device model (Apple Intelligence) first and Gemini in the cloud
// as backup; it needs Firebase 12.13 or newer and iOS 26.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Plain Politics",
    platforms: [.iOS("26.0")],
    products: [
        .iOSApplication(
            name: "Plain Politics",
            targets: ["AppModule"],
            bundleIdentifier: "com.grosolistudio.plainpolitics",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .asset("AppIcon"),
            accentColor: .presetColor(.brown),
            supportedDeviceFamilies: [.phone, .pad],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad])),
            ]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", "12.13.0"..<"13.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            dependencies: [
                .product(name: "FirebaseAILogic", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAppCheck", package: "firebase-ios-sdk"),
            ],
            path: "Sources",
            resources: [.process("Resources")]
        ),
    ]
)
