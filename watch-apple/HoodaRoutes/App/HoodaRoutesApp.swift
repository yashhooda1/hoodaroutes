import SwiftUI

@main
struct HoodaRoutesApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
        }
    }
}

/// The one piece of app-wide state: which course (if any) is being run.
/// A run replaces the whole navigation stack instead of being pushed or
/// presented, so there is no swipe or close button that can drop you out of a
/// workout by accident.
@MainActor
final class AppState: ObservableObject {
    @Published var activeCourse: Course?
}

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        if let course = appState.activeCourse {
            RunView(course: course)
        } else {
            NavigationStack {
                RouteListView()
            }
        }
    }
}
