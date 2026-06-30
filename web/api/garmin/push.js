// /api/garmin/push  — generate the loop, then create it as a Course on the
// user's Garmin account (via the Python push service). One call: GPS in,
// navigable course out.
//
// Env: ORS_API_KEY (routing) + GARMIN_PUSH_URL (your FastAPI service base URL).
import { generateLoop } from "../../lib/ors.js";

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

    const pushUrl = process.env.GARMIN_PUSH_URL;
    if (!pushUrl) {
      return res.status(500).json({ error: "GARMIN_PUSH_URL is not set" });
    }

    const route = await generateLoop({ lat, lng, miles, profile, seed });
    const body = {
      name: q.name || `HoodaRoutes ${route.distanceMi}mi`,
      activityType: profile === "foot-hiking" ? "TRAIL_RUNNING" : "RUNNING",
      distanceM: Math.round(route.distanceMi * 1609.34),
      ascentM: Math.round(route.ascentFt * M_PER_FT),
      descentM: Math.round(route.descentFt * M_PER_FT),
      geoPoints: route.coordinates.map((c) => ({
        lat: c[1],
        lng: c[0],
        ele: c[2] || 0,
      })),
    };

    const r = await fetch(`${pushUrl.replace(/\/$/, "")}/push-course`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: data.detail || "push failed", data });
    }
    res.status(200).json({
      ok: true,
      courseId: data.courseId,
      distanceMi: route.distanceMi,
      ascentFt: route.ascentFt,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
