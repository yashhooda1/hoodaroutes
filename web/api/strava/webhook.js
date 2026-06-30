// /api/strava/webhook — Strava push subscription endpoint.
// GET  = subscription validation handshake (echo hub.challenge).
// POST = events: on a new/changed/deleted activity we invalidate the user's
//        cached profile so the next read recomputes today's suggestion.
//        On deauthorize, we delete their tokens.
import { kvDel } from "../../lib/store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.STRAVA_VERIFY_TOKEN) {
      return res.status(200).json({ "hub.challenge": challenge });
    }
    return res.status(403).json({ error: "verify token mismatch" });
  }

  if (req.method === "POST") {
    const e = req.body || {};
    try {
      if (e.object_type === "activity") {
        // create | update | delete -> recompute on next read
        await kvDel(`profile:${e.owner_id}`);
      } else if (e.object_type === "athlete" && e.updates && e.updates.authorized === "false") {
        await kvDel(`user:${e.owner_id}`);
        await kvDel(`profile:${e.owner_id}`);
      }
    } catch (_) { /* never block the ack */ }
    return res.status(200).json({ ok: true }); // Strava needs a fast 200
  }

  res.status(405).end();
}
