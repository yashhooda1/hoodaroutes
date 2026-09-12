// /api/routes/generate  — used by the HoodaRoutes web app.
// POST { lat, lng, miles, profile, surface, seed, race }
//   ->  real snapped loop + elevation + race-aware fit score.
//
// Unauthenticated by design (drop a pin, get a loop, no signup) — so it is IP
// rate limited: every call spends OpenRouteService quota on a personal key.
import { generateLoop } from "../../lib/ors.js";
import { sessionFromReq } from "../../lib/session.js";
import { raceForRequest } from "../race.js";
import { enforce } from "../../lib/ratelimit.js";

export default async function handler(req, res) {
  if (await enforce(req, res, { bucket: "gen", limit: 60, windowSec: 3600 })) return;
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    const miles = parseFloat(q.miles || "8");
    const profile = q.profile || "foot-walking";
    const surface = q.surface || null;
    const seed = parseInt(q.seed || "1", 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }
    const race = await raceForRequest(req, sessionFromReq(req));
    const route = await generateLoop({ lat, lng, miles, profile, surface, seed, race });
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json(route);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
