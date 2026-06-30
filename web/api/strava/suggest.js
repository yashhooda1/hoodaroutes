// /api/strava/suggest — today's recommended run for the LOGGED-IN user.
import { sessionFromReq } from "../../lib/session.js";
import { getValidToken, recentRuns, suggestToday } from "../../lib/strava.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: "connect Strava first" });
  try {
    const token = await getValidToken(s.athleteId);
    const runs = await recentRuns(token, 21);
    res.status(200).json(suggestToday(runs));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
