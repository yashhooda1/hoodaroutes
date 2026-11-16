import MapKit
import SwiftUI

/// The run itself. Three pages, like the stock Workout app: controls on the
/// left, the map in the middle (where it opens), numbers on the right.
struct RunView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model: RunModel
    @State private var page = 1

    init(course: Course) {
        _model = StateObject(wrappedValue: RunModel(course: course))
    }

    var body: some View {
        Group {
            switch model.phase {
            case .failed(let message):
                ScrollView {
                    VStack(spacing: 10) {
                        Text("Couldn't start the run")
                            .font(.headline)
                        Text(message)
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                        Button("Close") { appState.activeCourse = nil }
                    }
                }
            case .finished:
                RunSummaryView(model: model) { appState.activeCourse = nil }
            default:
                TabView(selection: $page) {
                    RunControlsPage(model: model).tag(0)
                    RunMapPage(model: model).tag(1)
                    RunMetricsPage(model: model).tag(2)
                }
            }
        }
        .task { await model.start() }
    }
}

// MARK: - Map

private struct RunMapPage: View {
    @ObservedObject var model: RunModel
    @State private var following = true
    // Starts on the whole loop, then switches to following in .task: MapKit
    // doesn't reliably engage heading-follow when it is the very first
    // camera position a Map is given.
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        // Not pannable on purpose: a pannable map swallows the swipes that
        // change pages. The button flips between "follow me" and "whole loop".
        Map(position: $camera, interactionModes: []) {
            MapPolyline(coordinates: model.course.mapCoordinates)
                .stroke(Color.accentColor, lineWidth: 5)
            UserAnnotation()
        }
        .ignoresSafeArea()
        .task {
            if following { camera = .userLocation(followsHeading: true, fallback: .automatic) }
        }
        .overlay(alignment: .top) { banner }
        .overlay(alignment: .bottomTrailing) {
            Button {
                following.toggle()
                camera = following
                    ? .userLocation(followsHeading: true, fallback: .automatic)
                    : .automatic
            } label: {
                Image(systemName: following ? "map" : "location.fill")
                    .font(.footnote.weight(.semibold))
                    .padding(8)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(6)
        }
    }

    @ViewBuilder
    private var banner: some View {
        let nav = model.nav
        if nav.isOffCourse {
            pill("Off route · \(Int(nav.offsetM.rounded())) m", color: .red)
        } else if nav.finished {
            pill("Loop complete", color: .green)
        } else if model.phase == .paused {
            pill("Paused", color: .yellow)
        } else if model.phase == .running {
            pill("\(Format.miles(nav.remainingM)) mi to go", color: .black.opacity(0.55))
        }
    }

    private func pill(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color, in: Capsule())
            .padding(.top, 2)
    }
}

// MARK: - Metrics

private struct RunMetricsPage: View {
    @ObservedObject var model: RunModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let elapsed = model.elapsed
            VStack(alignment: .leading, spacing: 1) {
                Text(Format.clock(elapsed))
                    .font(.system(.title2, design: .rounded).weight(.semibold))
                    .foregroundStyle(.yellow)
                metric(Format.miles(model.distanceM), "mi")
                metric(Format.pace(seconds: elapsed, metres: model.distanceM), "/mi")
                metric(model.heartRate > 0 ? "\(Int(model.heartRate.rounded()))" : "––", "bpm")
                metric(Format.miles(model.nav.remainingM), "mi left")
            }
            .monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
    }

    private func metric(_ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(value)
                .font(.system(.title3, design: .rounded).weight(.medium))
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Controls

private struct RunControlsPage: View {
    @ObservedObject var model: RunModel
    @State private var confirmingEnd = false

    var body: some View {
        VStack(spacing: 8) {
            Button {
                model.togglePause()
            } label: {
                Label(model.phase == .paused ? "Resume" : "Pause",
                      systemImage: model.phase == .paused ? "play.fill" : "pause.fill")
                    .frame(maxWidth: .infinity)
            }
            .tint(.yellow)
            .disabled(!(model.phase == .running || model.phase == .paused))

            Button(role: .destructive) {
                confirmingEnd = true
            } label: {
                Label("End", systemImage: "xmark")
                    .frame(maxWidth: .infinity)
            }
            .disabled(!(model.phase == .running || model.phase == .paused))
        }
        .padding(.horizontal, 4)
        .confirmationDialog("End this run?", isPresented: $confirmingEnd, titleVisibility: .visible) {
            Button("End Run", role: .destructive) { model.end() }
            Button("Keep Going", role: .cancel) {}
        }
    }
}

// MARK: - Summary

private struct RunSummaryView: View {
    @ObservedObject var model: RunModel
    let done: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text(model.course.name)
                    .font(.headline)
                row("Distance", "\(Format.miles(model.distanceM)) mi")
                row("Time", Format.clock(model.elapsed))
                row("Avg pace", "\(Format.pace(seconds: model.elapsed, metres: model.distanceM)) /mi")
                if model.energyKcal > 0 {
                    row("Energy", "\(Int(model.energyKcal.rounded())) kcal")
                }

                if model.savedToHealth {
                    Label("Saved to Health", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
                } else {
                    Label(model.saveError ?? "Not saved to Health", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }

                Button("Done", action: done)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 2)
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.footnote)
    }
}
