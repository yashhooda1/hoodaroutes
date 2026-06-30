// lib/session.js — minimal signed sessions (HS256) + cookie helpers.
// Tokens for Strava are NEVER sent to the browser; the cookie only carries the
// athlete id. Env: SESSION_SECRET (set a long random value in production).
import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const COOKIE = "hr_session";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function sign(payload, maxAgeSec = 60 * 60 * 24 * 30) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSec };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verify(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expect = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  const body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

export function parseCookie(req, name) {
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionFromReq(req) {
  return verify(parseCookie(req, COOKIE));
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
