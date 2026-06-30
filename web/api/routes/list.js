// /api/routes/list — the user's saved/generated routes.
import { sessionFromReq } from "../../lib/session.js";
import { kvGet } from "../../lib/store.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: "connect Strava first" });
  const arr = (await kvGet(`routes:${s.athleteId}`)) || [];
  res.status(200).json({ routes: arr });
}
