// /api/strava/webhook-subscribe?token=ADMIN_TOKEN — register the push
// subscription with Strava (run once after deploy). Admin-gated.
export default async function handler(req, res) {
  if ((req.query.token || "") !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const body = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    callback_url: `${process.env.APP_URL}/api/strava/webhook`,
    verify_token: process.env.STRAVA_VERIFY_TOKEN,
  });
  const r = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  res.status(r.status).json(await r.json());
}
