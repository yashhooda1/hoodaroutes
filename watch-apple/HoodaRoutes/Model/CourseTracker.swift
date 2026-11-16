import Foundation

struct CoursePoint: Equatable {
    let lat: Double
    let lng: Double
}

/// Matches GPS fixes to the course: how far along you are, how far is left,
/// and whether you have left the route.
///
/// Deliberately free of CoreLocation and UI so the logic can be reasoned about
/// (and unit-tested) on its own. Three things make it more than "nearest point
/// on the line":
///
///  * **It only looks near where you already are** (a window from 60 m behind
///    to 250 m ahead of your last matched position). A loop starts and ends at
///    the same spot, and routed loops often run both ways along one street —
///    a global nearest-point search would teleport you between those.
///  * **Ties fall forwards.** Where the course doubles back on itself two
///    segments are equally close, so going backwards carries a small penalty.
///  * **Leaving and rejoining are debounced.** Three consecutive fixes off the
///    line before the alert fires; three consistent fixes somewhere else on
///    the course (a shortcut, or picking the loop up mid-way) before progress
///    jumps there.
final class CourseTracker {
    struct Update: Equatable {
        var progressM: Double = 0
        var remainingM: Double = 0
        /// Distance from the fix to the nearest part of the course.
        var offsetM: Double = 0
        var isOffCourse = false
        var finished = false
    }

    let totalM: Double
    private(set) var latest: Update

    private let points: [CoursePoint]
    private let cumulative: [Double]   // metres along the course at each point

    private var progressM: Double = 0
    private var coveredM: Double = 0   // forward progress actually run
    private var offCount = 0
    private var isOff = false
    private var finished = false
    private var pendingAlong: Double?
    private var pendingCount = 0

    private static let metresPerDegLat = 110_540.0
    private static let metresPerDegLng = 111_320.0
    private static let lookBehindM = 60.0
    private static let lookAheadM = 250.0

    init(points: [CoursePoint]) {
        self.points = points
        var cum: [Double] = [0]
        cum.reserveCapacity(points.count)
        if points.count > 1 {
            for i in 1..<points.count {
                cum.append(cum[i - 1] + CourseTracker.distance(points[i - 1], points[i]))
            }
        }
        cumulative = cum
        totalM = cum.last ?? 0
        latest = Update(remainingM: totalM)
    }

    /// Feed one GPS fix. `accuracy` is the fix's horizontal accuracy in metres.
    @discardableResult
    func update(lat: Double, lng: Double, accuracy: Double) -> Update {
        guard points.count > 1 else { return latest }
        let fix = CoursePoint(lat: lat, lng: lng)

        // A poor fix shouldn't trip the alert, so the tolerance widens with
        // reported accuracy — up to a point.
        let threshold = 30 + min(max(accuracy, 0), 30)

        var hit = nearest(to: fix,
                          lo: progressM - CourseTracker.lookBehindM,
                          hi: progressM + CourseTracker.lookAheadM,
                          preferFrom: progressM)
        var onCourse = (hit?.distance ?? .infinity) <= threshold

        if !onCourse {
            let global = nearest(to: fix, lo: -Double.infinity, hi: Double.infinity, preferFrom: nil)
            if let g = global, g.distance <= threshold * 0.6 {
                if let pending = pendingAlong, abs(g.along - pending) < 80 {
                    pendingCount += 1
                } else {
                    pendingCount = 1
                }
                pendingAlong = g.along
                if pendingCount >= 3 {
                    hit = g
                    onCourse = true
                }
            } else {
                pendingAlong = nil
                pendingCount = 0
            }
            // Still off: report the true distance back to the course.
            if !onCourse, let g = global {
                if let h = hit, h.distance <= g.distance { hit = h } else { hit = g }
            }
        }

        if onCourse, let h = hit {
            let delta = h.along - progressM
            if delta > 0, delta < CourseTracker.lookAheadM { coveredM += delta }
            progressM = h.along
            offCount = 0
            isOff = false
            pendingAlong = nil
            pendingCount = 0
            // "Finished" needs most of the course actually run, so standing at
            // the shared start/finish never counts.
            if !finished, totalM - progressM < 25, coveredM > 0.8 * totalM {
                finished = true
            }
        } else {
            offCount += 1
            if offCount >= 3 { isOff = true }
        }

        latest = Update(progressM: progressM,
                        remainingM: max(0, totalM - progressM),
                        offsetM: hit?.distance ?? 0,
                        isOffCourse: isOff,
                        finished: finished)
        return latest
    }

    // MARK: - Geometry

    private struct Match {
        let distance: Double
        let along: Double
    }

    /// Nearest point on any segment that overlaps [lo, hi] metres along.
    private func nearest(to p: CoursePoint, lo: Double, hi: Double, preferFrom: Double?) -> Match? {
        var best: Match?
        var bestScore = Double.infinity
        // Flat-earth projection centred on the fix: fine over a few hundred
        // metres, and far cheaper than haversine per segment.
        let kx = cos(p.lat * .pi / 180) * CourseTracker.metresPerDegLng
        let ky = CourseTracker.metresPerDegLat

        for i in 0..<(points.count - 1) {
            if cumulative[i + 1] < lo || cumulative[i] > hi { continue }
            let a = points[i], b = points[i + 1]
            let ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky
            let bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky
            let dx = bx - ax, dy = by - ay
            let len2 = dx * dx + dy * dy
            var t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
            t = min(1, max(0, t))
            let d = ((ax + t * dx) * (ax + t * dx) + (ay + t * dy) * (ay + t * dy)).squareRoot()
            let along = cumulative[i] + t * (cumulative[i + 1] - cumulative[i])

            var score = d
            if let from = preferFrom, along < from {
                score += min(15, 2 * (from - along))
            }
            if score < bestScore {
                bestScore = score
                best = Match(distance: d, along: along)
            }
        }
        return best
    }

    private static func distance(_ a: CoursePoint, _ b: CoursePoint) -> Double {
        let kx = cos(a.lat * .pi / 180) * metresPerDegLng
        let dx = (b.lng - a.lng) * kx
        let dy = (b.lat - a.lat) * metresPerDegLat
        return (dx * dx + dy * dy).squareRoot()
    }
}
