// /api/auth/strava/login — start "Login with Strava" (3-legged OAuth 2.0).
// Sends the user to Strava's consent screen with a CSRF state cookie.
//
// Env: STRAVA_CLIENT_ID, APP_URL (e.g. https://yashhooda.ai)
// Strava app settings: Authorization Callback Domain must match APP_URL's host.
import crypto from "crypto";

export default function handler(req, res) {
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${process.env.APP_URL}/api/auth/strava/callback`;
  const url =
    "https://www.strava.com/oauth/authorize" +
    `?client_id=${process.env.STRAVA_CLIENT_ID}` +
    "&response_type=code" +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&scope=activity:read_all" +
    "&approval_prompt=auto" +
    `&state=${state}`;

  res.setHeader(
    "Set-Cookie",
    `hr_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );
  res.writeHead(302, { Location: url });
  res.end();
}
