import Foundation

/// Everything you might want to change without reading the rest of the app.
enum Config {
    /// The HoodaRoutes web deployment (the `web/` folder of this repo).
    static let baseURL = URL(string: "https://routes.yashhooda.ai")!

    /// Goal race the fit score is computed against. `nil` uses the server
    /// default; otherwise an id from `web/lib/race.js` (e.g. "half_marathon").
    static let goalRace: String? = nil

    /// Generating eight loops takes the server a while (several routing calls
    /// each, plus an elevation lookup), so be patient on the list request.
    static let routesTimeout: TimeInterval = 60
    static let courseTimeout: TimeInterval = 45
}
