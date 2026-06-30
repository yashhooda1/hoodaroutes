// /api/auth/logout — clears the session and deletes the user's stored tokens.
import { sessionFromReq, clearCookie } from "../../lib/session.js";
import { kvDel } from "../../lib/store.js";

export default async function handler(req, res) {
  const s = sessionFromReq(req);
  if (s) await kvDel(`user:${s.athleteId}`); // disconnect = revoke our copy of tokens
  res.setHeader("Set-Cookie", clearCookie());
  res.status(200).json({ ok: true });
}
