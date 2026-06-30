// /api/garmin/push-official — generate the loop, then push it as a Course via
// the OFFICIAL Garmin Courses API (OAuth 2.0). Drop-in alternative to
// /api/garmin/push (which uses the unofficial Python service).
import { generateLoop } from "../../lib/ors.js";
import { buildCourse, pushCourseOfficial } from "../../lib/garmin-official.js";

const M_PER_FT = 1 / 3.28084;

export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    const miles = parseFloat(q.miles || q.reqMiles || "8");
    const profile = q.profile || "foot-walking";
    const seed = parseInt(q.seed || "1", 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const route = await generateLoop({ lat, lng, miles, profile, seed });
    const course = buildCourse({
      name: q.name || `HoodaRoutes ${route.distanceMi}mi`,
      distanceM: Math.round(route.distanceMi * 1609.34),
      ascentM: Math.round(route.ascentFt * M_PER_FT),
      descentM: Math.round(route.descentFt * M_PER_FT),
      coordinates: route.coordinates,
      activityType: profile === "foot-hiking" ? "TRAIL_RUNNING" : "RUNNING",
    });

    // Multi-user: pass the authenticated user's refresh token instead of the env default.
    const result = await pushCourseOfficial(course, q.refreshToken);
    res.status(200).json({ ok: true, courseId: result.courseId, distanceMi: route.distanceMi });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
