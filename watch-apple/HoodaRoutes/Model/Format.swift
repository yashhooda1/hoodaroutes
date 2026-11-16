import Foundation

enum Format {
    static let metresPerMile = 1609.344

    static func miles(_ metres: Double) -> String {
        String(format: "%.2f", metres / metresPerMile)
    }

    /// h:mm:ss past an hour, m:ss before it.
    static func clock(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds.rounded()))
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
            : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// Average pace per mile, or a dash until there's enough distance for the
    /// number to mean anything.
    static func pace(seconds: TimeInterval, metres: Double) -> String {
        let mi = metres / metresPerMile
        guard mi >= 0.05, seconds > 0 else { return "–:––" }
        let perMile = Int((seconds / mi).rounded())
        return String(format: "%d:%02d", perMile / 60, perMile % 60)
    }
}
