import CoreLocation
import Foundation

/// One entry from `GET /api/garmin/routes` — a loop the server can generate
/// from the watch's position. It carries no geometry; the request that built
/// it (lat/lng/reqMiles/profile/seed) is replayed against
/// `/api/garmin/course?format=json` to get the actual line.
struct RouteOption: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let miles: Double
    let elevFt: Double
    /// Detected surface: road | trail | track | mixed. ("shade" is the field's
    /// historical name in the API.)
    let shade: String?
    let fit: Double?
    let lat: Double
    let lng: Double
    let profile: String
    let seed: Int
    let reqMiles: Double
    let suggested: Bool?
    let rationale: String?

    var surface: String { shade ?? "road" }
    var isSuggested: Bool { suggested ?? false }
}

struct RoutesResponse: Decodable {
    let routes: [RouteOption]
}

/// `GET /api/garmin/course?format=json`.
struct Course: Decodable {
    let name: String
    let distanceMi: Double
    let ascentFt: Double?
    let descentFt: Double?
    let surface: String?
    let profile: String?
    /// GeoJSON order: [lng, lat] or [lng, lat, elevationMetres].
    let coordinates: [[Double]]

    var points: [CoursePoint] {
        coordinates.compactMap { c in
            c.count >= 2 ? CoursePoint(lat: c[1], lng: c[0]) : nil
        }
    }

    var mapCoordinates: [CLLocationCoordinate2D] {
        points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
    }

    var isHike: Bool { profile == "foot-hiking" }
}

struct ServerError: Decodable {
    let error: String
}
