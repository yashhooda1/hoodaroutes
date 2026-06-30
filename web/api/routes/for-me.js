// /api/routes/for-me — generate a loop sized to the logged-in user's training,
// starting from where they actually run (or a provided lat/lng).
import { sessionFromReq } from "../../lib/session.js";
import { getValidToken, recentRuns, analyzeTraining, suggestToday } from "../../lib/strava.js";
import { generateLoop } from "../../lib/ors.js";
import { kvGet, kvSet } from "../../lib/store.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: "connect Strava first" });
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const token = await getValidToken(s.athleteId);
    const runs = await recentRuns(token, 28);
    const prof = analyzeTraining(runs);
    const sug = suggestToday(runs);

    const lat = parseFloat(q.lat) || prof.startLat;
    const lng = parseFloat(q.lng) || prof.startLng;
    if (!lat || !lng) {
      return res.status(400).json({ error: "no start location in your history; provide lat/lng" });
    }
    const profile = q.profile || (prof.trailShare > 0.4 ? "foot-hiking" : "foot-walking");
    const miles = parseFloat(q.miles) || sug.suggestedMiles;
    const seed = parseInt(q.seed || "7", 10);

    const route = await generateLoop({ lat, lng, miles, profile, seed });

    // Save to the user's route history (last 30).
    try {
      const entry = {
        name: `${route.distanceMi} mi loop`, distMi: route.distanceMi, ascentFt: route.ascentFt,
        fit: route.boulderFit, profile, lat, lng, seed, ts: Date.now(),
      };
      const arr = (await kvGet(`routes:${s.athleteId}`)) || [];
      arr.unshift(entry);
      if (arr.length > 30) arr.length = 30;
      await kvSet(`routes:${s.athleteId}`, arr);
    } catch (_) { /* history is best-effort */ }

    res.status(200).json({ ...route, suggestion: sug, basedOn: { weeklyAvg: prof.weeklyAvg, trailShare: prof.trailShare } });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
