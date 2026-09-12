// /api/race — the athlete's goal race.
//
// GET  -> { race, options }        (options = the catalogue for the picker)
// POST { id } | { id, targetFtPerMi, longRunMi, name }  -> { race }
//
// Anonymous users get the default and keep their choice in localStorage;
// connected users get it persisted server-side so the watch and the coach see
// the same race the web app does.
import { sessionFromReq } from "../lib/session.js";
import { kvGet, kvSet } from "../lib/store.js";
import { RACES, DEFAULT_RACE_ID, resolveRace, raceKey } from "../lib/race.js";

const options = Object.values(RACES).map((r) => ({
  id: r.id,
  name: r.name,
  targetFtPerMi: r.targetFtPerMi,
  distanceMi: r.distanceMi,
}));

// Shared by the other endpoints: the race for this request, in priority order —
// explicit query/body value, then the athlete's stored choice, then default.
export async function raceForRequest(req, session) {
  const q = req.method === "POST" ? req.body || {} : req.query;
  if (q.race) return resolveRace(q.race);
  if (session) {
    try {
      const stored = await kvGet(raceKey(session.athleteId));
      if (stored) return resolveRace(stored);
    } catch (_) { /* fall through to default */ }
  }
  return resolveRace(DEFAULT_RACE_ID);
}

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  try {
    if (req.method === "POST") {
      if (!s) return res.status(401).json({ error: "connect Strava first" });
      const b = req.body || {};
      const race = resolveRace(
        b.targetFtPerMi != null || b.name
          ? {
              id: b.id || "custom",
              name: String(b.name || "Custom race").slice(0, 60),
              targetFtPerMi: b.targetFtPerMi,
              longRunMi: b.longRunMi,
            }
          : b.id
      );
      await kvSet(raceKey(s.athleteId), race);
      return res.status(200).json({ race, options });
    }

    const race = s ? await raceForRequest(req, s) : resolveRace(DEFAULT_RACE_ID);
    res.status(200).json({ race, options });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
