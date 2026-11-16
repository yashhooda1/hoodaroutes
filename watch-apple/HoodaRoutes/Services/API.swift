import Foundation

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The two calls the watch makes against the HoodaRoutes web API. Same
/// endpoints the Garmin Connect IQ app uses; only the course format differs
/// (JSON here, FIT there).
enum API {
    /// Loops of varying distance/surface from this position.
    static func routes(lat: Double, lng: Double) async throws -> [RouteOption] {
        var items = [
            URLQueryItem(name: "lat", value: String(format: "%.5f", lat)),
            URLQueryItem(name: "lng", value: String(format: "%.5f", lng)),
        ]
        if let race = Config.goalRace {
            items.append(URLQueryItem(name: "race", value: race))
        }
        let response: RoutesResponse = try await get("api/garmin/routes", items, timeout: Config.routesTimeout)
        return response.routes
    }

    /// Geometry for one option. The server regenerates the loop from the same
    /// inputs (and seed), so this is the route the list described.
    static func course(for route: RouteOption) async throws -> Course {
        let items = [
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "lat", value: String(route.lat)),
            URLQueryItem(name: "lng", value: String(route.lng)),
            URLQueryItem(name: "miles", value: String(route.reqMiles)),
            URLQueryItem(name: "profile", value: route.profile),
            URLQueryItem(name: "seed", value: String(route.seed)),
        ]
        let course: Course = try await get("api/garmin/course", items, timeout: Config.courseTimeout)
        guard course.coordinates.count > 1 else {
            throw APIError(message: "The server returned an empty route.")
        }
        return course
    }

    private static func get<T: Decodable>(_ path: String, _ items: [URLQueryItem], timeout: TimeInterval) async throws -> T {
        guard var components = URLComponents(url: Config.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError(message: "Bad server address.")
        }
        components.queryItems = items
        guard let url = components.url else {
            throw APIError(message: "Bad server address.")
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: "No response from the server.")
        }
        guard (200..<300).contains(http.statusCode) else {
            // The API reports failures as { "error": "..." }.
            if let server = try? JSONDecoder().decode(ServerError.self, from: data) {
                throw APIError(message: server.error)
            }
            throw APIError(message: http.statusCode == 429
                           ? "Too many requests. Try again in a bit."
                           : "Server error (\(http.statusCode)).")
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "Couldn't read the server's response.")
        }
    }
}
