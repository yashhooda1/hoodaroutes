// /api/auth/me — returns the connected athlete (name only), or { connected:false }.
import { sessionFromReq } from "../../lib/session.js";
import { kvGet } from "../../lib/store.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (!s) return res.status(200).json({ connected: false });
  const u = await kvGet(`user:${s.athleteId}`);
  res.status(200).json({
    connected: !!u,
    athlete: u ? u.athlete : { id: s.athleteId, name: s.name },
  });
}
