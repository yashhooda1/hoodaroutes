// /api/routes/generate  — used by the HoodaRoutes web app.
// POST { lat, lng, miles, profile, seed }  ->  real snapped loop + elevation.
import { generateLoop } from "../../lib/ors.js";

export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    const miles = parseFloat(q.miles || "8");
    const profile = q.profile || "foot-walking";
    const seed = parseInt(q.seed || "1", 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }
    const route = await generateLoop({ lat, lng, miles, profile, seed });
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json(route);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
