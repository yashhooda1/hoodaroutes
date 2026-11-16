import CoreLocation
import Foundation
import HealthKit
import WatchKit

/// One run of one course: the HealthKit workout, the GPS breadcrumb saved with
/// it, and the on-course tracking that drives the map and the haptics.
///
/// The workout session is also what keeps the app alive with the wrist down —
/// watchOS suspends anything else — so navigation and recording are one thing
/// here rather than two.
@MainActor
final class RunModel: NSObject, ObservableObject {
    enum Phase: Equatable {
        case idle, starting, running, paused, ending, finished
        case failed(String)
    }

    let course: Course

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var nav: CourseTracker.Update
    @Published private(set) var distanceM: Double = 0
    @Published private(set) var heartRate: Double = 0
    @Published private(set) var energyKcal: Double = 0
    @Published private(set) var savedToHealth = false
    @Published private(set) var saveError: String?

    private let tracker: CourseTracker
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private var routePointCount = 0
    private var finalElapsed: TimeInterval = 0
    private var lastOffCourseBuzz = Date.distantPast
    private var isFinishing = false

    init(course: Course) {
        self.course = course
        let tracker = CourseTracker(points: course.points)
        self.tracker = tracker
        self.nav = tracker.latest
        super.init()
    }

    /// Active time (pauses excluded). Read it from a TimelineView; it isn't
    /// published because it changes continuously.
    var elapsed: TimeInterval {
        switch phase {
        case .running, .paused, .ending: return builder?.elapsedTime ?? finalElapsed
        default: return finalElapsed
        }
    }

    // MARK: - Lifecycle

    func start() async {
        guard phase == .idle else { return }
        phase = .starting

        guard HKHealthStore.isHealthDataAvailable() else {
            phase = .failed("Health data isn't available on this watch.")
            return
        }

        let share: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute(),
        ]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.activeEnergyBurned),
        ]

        do {
            try await store.requestAuthorization(toShare: share, read: read)

            let configuration = HKWorkoutConfiguration()
            configuration.activityType = course.isHike ? .hiking : .running
            configuration.locationType = .outdoor

            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder
            self.routeBuilder = HKWorkoutRouteBuilder(healthStore: store, device: nil)

            let now = Date()
            session.startActivity(with: now)
            try await builder.beginCollection(at: now)

            phase = .running
            WKInterfaceDevice.current().play(.start)
            LocationProvider.shared.startLive { [weak self] locations in
                self?.ingest(locations)
            }
        } catch {
            session?.end()
            session = nil
            builder = nil
            phase = .failed(error.localizedDescription)
        }
    }

    func togglePause() {
        switch phase {
        case .running: session?.pause()
        case .paused: session?.resume()
        default: break
        }
    }

    /// Stops the session. Saving happens in `finish(at:)` once HealthKit
    /// reports the session as stopped — the order Apple's workout samples use:
    /// stop, end collection, finish the workout, and only then end the session.
    func end() {
        guard phase == .running || phase == .paused else { return }
        phase = .ending
        session?.stopActivity(with: Date())
    }

    private func finish(at date: Date) async {
        LocationProvider.shared.stopLive()
        defer { session?.end() }   // no-op if the system already ended it
        guard let builder else {
            phase = .finished
            return
        }
        finalElapsed = builder.elapsedTime
        do {
            try await builder.endCollection(at: date)
            if let workout = try await builder.finishWorkout() {
                if routePointCount > 0, let routeBuilder {
                    _ = try await routeBuilder.finishRoute(with: workout, metadata: nil)
                }
                savedToHealth = true
            }
        } catch {
            saveError = error.localizedDescription
        }
        WKInterfaceDevice.current().play(.stop)
        phase = .finished
    }

    // MARK: - Location

    private func ingest(_ locations: [CLLocation]) {
        // Drop fixes too vague to place you on a street.
        let usable = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
        guard !usable.isEmpty, phase == .running || phase == .paused else { return }

        if phase == .running {
            routePointCount += usable.count
            routeBuilder?.insertRouteData(usable) { _, _ in }
        }

        let before = nav
        var after = before
        for location in usable {
            after = tracker.update(lat: location.coordinate.latitude,
                                   lng: location.coordinate.longitude,
                                   accuracy: location.horizontalAccuracy)
        }
        if after != before { nav = after }
        announce(from: before, to: after)
    }

    private func announce(from before: CourseTracker.Update, to after: CourseTracker.Update) {
        let device = WKInterfaceDevice.current()
        let now = Date()
        if after.finished && !before.finished {
            device.play(.success)
        } else if after.isOffCourse && !before.isOffCourse {
            device.play(.failure)
            lastOffCourseBuzz = now
        } else if after.isOffCourse, now.timeIntervalSince(lastOffCourseBuzz) > 30 {
            // Still off: a quieter nudge every half minute, not a constant buzz.
            device.play(.retry)
            lastOffCourseBuzz = now
        } else if !after.isOffCourse && before.isOffCourse {
            device.play(.directionUp)
        }
    }

    // MARK: - HealthKit callbacks (arrive off the main actor)

    private func sessionChanged(to state: HKWorkoutSessionState, at date: Date) {
        switch state {
        case .running:
            if phase == .paused { phase = .running }
        case .paused:
            if phase == .running { phase = .paused }
        case .stopped, .ended:
            // .stopped follows our own end(). .ended with no .stopped first is
            // the system ending the session (another app started a workout);
            // that run should still be saved. Neither a session torn down by a
            // failed start() nor the .ended that follows our own finish may
            // land here twice.
            guard !isFinishing, phase == .running || phase == .paused || phase == .ending else { return }
            isFinishing = true
            phase = .ending
            Task { await finish(at: date) }
        default:
            break
        }
    }

    private func sessionFailed(_ error: Error) {
        LocationProvider.shared.stopLive()
        phase = .failed(error.localizedDescription)
    }

    private func refreshStatistics(for types: Set<HKSampleType>) {
        guard let builder else { return }
        for type in types {
            guard let quantityType = type as? HKQuantityType,
                  let statistics = builder.statistics(for: quantityType) else { continue }
            switch quantityType {
            case HKQuantityType(.heartRate):
                let unit = HKUnit.count().unitDivided(by: .minute())
                heartRate = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? heartRate
            case HKQuantityType(.distanceWalkingRunning):
                distanceM = statistics.sumQuantity()?.doubleValue(for: .meter()) ?? distanceM
            case HKQuantityType(.activeEnergyBurned):
                energyKcal = statistics.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? energyKcal
            default:
                break
            }
        }
    }
}

extension RunModel: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {
        Task { @MainActor in self.sessionChanged(to: toState, at: date) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.sessionFailed(error) }
    }
}

extension RunModel: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in self.refreshStatistics(for: collectedTypes) }
    }
}
