import SwiftUI

/// First screen: get a GPS fix, ask the server for loops from here, list them.
struct RouteListView: View {
    private enum LoadState {
        case loading
        case failed(String)
        case loaded([RouteOption])
    }

    @State private var state: LoadState = .loading

    var body: some View {
        Group {
            switch state {
            case .loading:
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Finding loops near you…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            case .failed(let message):
                ScrollView {
                    VStack(spacing: 10) {
                        Text(message)
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                        Button("Try Again") { reload() }
                    }
                    .padding(.horizontal, 4)
                }
            case .loaded(let routes):
                List(routes) { route in
                    NavigationLink(value: route) {
                        RouteRow(route: route)
                    }
                }
            }
        }
        .navigationTitle("HoodaRoutes")
        .navigationDestination(for: RouteOption.self) { route in
            RouteDetailView(route: route)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { reload() } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading)
            }
        }
        .task {
            // .task fires again when you come back from a route; don't refetch.
            if isLoading { await load() }
        }
    }

    private var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }

    private func reload() {
        state = .loading
        Task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            let here = try await LocationProvider.shared.currentLocation()
            let routes = try await API.routes(lat: here.coordinate.latitude,
                                              lng: here.coordinate.longitude)
            state = routes.isEmpty
                ? .failed("No loops could be built from here. Try again from a spot nearer to streets or trails.")
                : .loaded(routes)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private struct RouteRow: View {
    let route: RouteOption

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                if route.isSuggested {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)
                }
                Text(route.name)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            HStack(spacing: 6) {
                Text("\(Int(route.elevFt.rounded())) ft")
                Text(route.surface)
                if let fit = route.fit {
                    Text("fit \(Int(fit.rounded()))")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
