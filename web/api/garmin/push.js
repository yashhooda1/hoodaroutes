// /api/garmin/push  — create the displayed loop as a Course on the user's
// Garmin account, via the Python push service. The browser calls THIS endpoint
// (same-origin); the server calls Railway server-to-server (no CORS, and the
// Railway URL never leaves the server).
//
// Env: GARMIN_PUSH_URL (your FastAPI service base URL). ORS_API_KEY only needed
// for the fallback generate-from-params path.
import { generateLoop } from "../../lib/ors.js";

const M_PER_FT = 1 / 3.28084;

export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;

    const pushUrl = process.env.GARMIN_PUSH_URL;
    if (!pushUrl) {
      return res.status(500).json({ error: "GARMIN_PUSH_URL is not set" });
    }

    let courseBody;
    if (Array.isArray(q.geoPoints) && q.geoPoints.length) {
      // Push exactly the route the client is showing.
      courseBody = {
        name: q.name || "HoodaRoutes route",
        activityType: q.activityType || "RUNNING",
        distanceM: Math.round(q.distanceM || 0),
        ascentM: Math.round(q.ascentM || 0),
        descentM: Math.round(q.descentM || 0),
        geoPoints: q.geoPoints,
      };
    } else {
      // Fallback: generate the loop from params, then push.
      const lat = parseFloat(q.lat);
      const lng = parseFloat(q.lng);
      const miles = parseFloat(q.miles || q.reqMiles || "8");
      const profile = q.profile || "foot-walking";
      const seed = parseInt(q.seed || "1", 10);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: "lat and lng (or geoPoints) are required" });
      }
      const route = await generateLoop({ lat, lng, miles, profile, seed });
      courseBody = {
        name: q.name || `HoodaRoutes ${route.distanceMi}mi`,
        activityType: profile === "foot-hiking" ? "TRAIL_RUNNING" : "RUNNING",
        distanceM: Math.round(route.distanceMi * 1609.34),
        ascentM: Math.round(route.ascentFt * M_PER_FT),
        descentM: Math.round(route.descentFt * M_PER_FT),
        geoPoints: route.coordinates.map((c) => ({ lat: c[1], lng: c[0], ele: c[2] || 0 })),
      };
    }

    const r = await fetch(`${pushUrl.replace(/\/$/, "")}/push-course`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(courseBody),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Surface the real Garmin error (status + detail) so the UI can show it.
      return res.status(502).json({ error: data.detail || `push service ${r.status}`, status: r.status, data });
    }
    res.status(200).json({ ok: true, courseId: data.courseId });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
