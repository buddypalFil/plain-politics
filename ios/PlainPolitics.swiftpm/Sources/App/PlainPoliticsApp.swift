// Starts Firebase and shows the app. In development builds App Check uses its debug provider: Xcode's console prints
// a debug token, which is registered once in the Firebase console (App Check > Apps > Manage debug tokens).

import SwiftUI
import FirebaseCore
import FirebaseAppCheck

@main
struct PlainPoliticsApp: App {
    init() {
        #if DEBUG
        AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        #endif
        // The settings file is a resource of this package, so look in the package's bundle as well as the app's.
        let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist")
            ?? Bundle.module.path(forResource: "GoogleService-Info", ofType: "plist")
        if let path, let options = FirebaseOptions(contentsOfFile: path) {
            FirebaseApp.configure(options: options)
        } else {
            FirebaseApp.configure()
        }
        _ = NetworkWatch.shared
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
