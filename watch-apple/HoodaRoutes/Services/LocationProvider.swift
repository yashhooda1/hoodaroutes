import CoreLocation
import Foundation

enum LocationError: LocalizedError {
    case denied
    case unavailable

    var errorDescription: String? {
        switch self {
        case .denied:
            return "Location access is off. Turn it on for HoodaRoutes in Settings → Privacy → Location Services."
        case .unavailable:
            return "Couldn't get a GPS fix. Step outside and try again."
        }
    }
}

/// One CLLocationManager for the whole app, used two ways:
///  * a single fix, to ask the server for loops near you;
///  * a continuous stream during a run, which keeps coming with the wrist down
///    (needs the `location` background mode, and must be started while the app
///    is in the foreground — which starting a run always is).
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    static let shared = LocationProvider()

    private let manager = CLLocationManager()
    private var fixContinuation: CheckedContinuation<CLLocation, Error>?
    private var liveHandler: (@MainActor ([CLLocation]) -> Void)?

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
    }

    // MARK: - Single fix

    func currentLocation() async throws -> CLLocation {
        // A recent, decent fix is good enough to seed route generation.
        if let cached = manager.location,
           cached.horizontalAccuracy >= 0, cached.horizontalAccuracy <= 100,
           abs(cached.timestamp.timeIntervalSinceNow) < 60 {
            return cached
        }
        return try await withCheckedThrowingContinuation { continuation in
            fixContinuation?.resume(throwing: CancellationError())
            fixContinuation = continuation
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()   // continues in authorizationChanged()
            case .denied, .restricted:
                finishFix(.failure(LocationError.denied))
            default:
                manager.requestLocation()
            }
        }
    }

    private func finishFix(_ result: Result<CLLocation, Error>) {
        guard let continuation = fixContinuation else { return }
        fixContinuation = nil
        continuation.resume(with: result)
    }

    // MARK: - Live stream

    func startLive(_ handler: @escaping @MainActor ([CLLocation]) -> Void) {
        liveHandler = handler
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
    }

    func stopLive() {
        liveHandler = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    // MARK: - Delegate plumbing (CoreLocation calls these off the main actor)

    private func received(_ locations: [CLLocation]) {
        liveHandler?(locations)
        if let last = locations.last {
            finishFix(.success(last))
        }
    }

    private func failed(_ error: Error) {
        // During a run a failed fix is just a gap; only a one-shot request
        // needs to hear about it.
        let denied = (error as? CLError)?.code == .denied
        finishFix(.failure(denied ? LocationError.denied : LocationError.unavailable))
    }

    private func authorizationChanged() {
        guard fixContinuation != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finishFix(.failure(LocationError.denied))
        default:
            break
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.received(locations) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.failed(error) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.authorizationChanged() }
    }
}
