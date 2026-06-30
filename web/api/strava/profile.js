// /api/strava/profile — the logged-in user's training analysis + today's
// suggestion. Cached server-side (Upstash) so the Strava webhook can invalidate
// it the moment a new activity lands.
import { sessionFromReq } from "../../lib/session.js";
import { kvGet, kvSet } from "../../lib/store.js";
import { getValidToken, recentRuns, analyzeTraining, suggestToday } from "../../lib/strava.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: "connect Strava first" });
  try {
    const cached = await kvGet(`profile:${s.athleteId}`);
    if (cached) return res.status(200).json(cached);

    const token = await getValidToken(s.athleteId);
    const runs = await recentRuns(token, 28);
    const out = { ...analyzeTraining(runs), suggestion: suggestToday(runs) };
    await kvSet(`profile:${s.athleteId}`, out, 1800); // 30-min TTL; webhook clears it sooner
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
