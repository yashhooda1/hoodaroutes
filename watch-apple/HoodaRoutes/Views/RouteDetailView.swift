import MapKit
import SwiftUI

/// One loop: its numbers, a preview of the line, and Start.
struct RouteDetailView: View {
    let route: RouteOption

    @EnvironmentObject private var appState: AppState
    @State private var course: Course?
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(String(format: "%.1f", course?.distanceMi ?? route.miles))
                        .font(.system(.largeTitle, design: .rounded).weight(.bold))
                    Text("mi")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 10) {
                    Label("\(Int(route.elevFt.rounded())) ft", systemImage: "arrow.up.right")
                    Text(route.surface)
                    if let fit = route.fit {
                        Text("fit \(Int(fit.rounded()))")
                            .foregroundStyle(Color.accentColor)
                    }
                }
                .font(.caption)

                if let rationale = route.rationale, !rationale.isEmpty {
                    Text(rationale)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let course {
                    Map(initialPosition: .automatic, interactionModes: []) {
                        MapPolyline(coordinates: course.mapCoordinates)
                            .stroke(Color.accentColor, lineWidth: 3)
                    }
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .allowsHitTesting(false)

                    Button {
                        appState.activeCourse = course
                    } label: {
                        Label("Start", systemImage: "figure.run")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                    Button("Try Again") {
                        Task { await loadCourse() }
                    }
                } else {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading route…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle(route.name)
        .task {
            if course == nil { await loadCourse() }
        }
    }

    @MainActor
    private func loadCourse() async {
        errorMessage = nil
        do {
            course = try await API.course(for: route)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
