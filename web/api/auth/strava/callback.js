// /api/auth/strava/callback — Strava redirects here with ?code&state.
// Verifies state, exchanges the code, stores the user's tokens server-side
// (Upstash), and issues a signed session cookie. Tokens never touch the browser.
import { exchangeCode } from "../../../lib/strava.js";
import { kvSet } from "../../../lib/store.js";
import { sign, parseCookie, sessionCookie } from "../../../lib/session.js";

export default async function handler(req, res) {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${process.env.APP_URL}/?strava=denied`);

    const saved = parseCookie(req, "hr_oauth_state");
    if (!code || !state || state !== saved) {
      return res.status(400).send("Invalid OAuth state");
    }

    const t = await exchangeCode(code);
    const a = t.athlete;
    await kvSet(`user:${a.id}`, {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      athlete: {
        id: a.id,
        name: `${a.firstname || ""} ${a.lastname || ""}`.trim(),
        city: a.city,
        country: a.country,
      },
    });

    const token = sign({ athleteId: a.id, name: `${a.firstname || ""} ${a.lastname || ""}`.trim() });
    res.setHeader("Set-Cookie", [
      sessionCookie(token),
      "hr_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ]);
    res.writeHead(302, { Location: `${process.env.APP_URL || "/"}/?strava=connected` });
    res.end();
  } catch (e) {
    res.status(500).send("Strava connect failed: " + (e.message || e));
  }
}
