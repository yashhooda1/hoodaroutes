// /api/routes/save — append a generated route to the user's history (last 30).
import { sessionFromReq } from "../../lib/session.js";
import { kvGet, kvSet } from "../../lib/store.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: "connect Strava first" });
  try {
    const b = req.method === "POST" ? req.body || {} : req.query;
    const entry = {
      name: b.name || `${b.distMi || "?"} mi loop`,
      distMi: +b.distMi || 0,
      ascentFt: +b.ascentFt || 0,
      fit: +b.fit || 0,
      profile: b.profile || "foot-walking",
      lat: b.lat != null ? +b.lat : null,
      lng: b.lng != null ? +b.lng : null,
      seed: +b.seed || 0,
      ts: Date.now(),
    };
    const arr = (await kvGet(`routes:${s.athleteId}`)) || [];
    arr.unshift(entry);
    if (arr.length > 30) arr.length = 30;
    await kvSet(`routes:${s.athleteId}`, arr);
    res.status(200).json({ ok: true, count: arr.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
