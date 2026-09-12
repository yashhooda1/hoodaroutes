// lib/ratelimit.js — fixed-window IP rate limiting on the Upstash we already
// run. /api/routes/generate and /api/routes/interpret are unauthenticated and
// spend real money per call (OpenRouteService quota, Anthropic tokens), so they
// cannot be left open to whoever finds the URL.
//
// Fixed window, not sliding: one INCR + one EXPIRE, cheap enough to sit in
// front of every request. If the limiter itself fails we ALLOW the request —
// a broken Redis must not take the product down.
import { kvIncr, kvExpire } from "./store.js";

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (
    req.headers["x-real-ip"] ||
    req.headers["x-vercel-forwarded-for"] ||
    (req.socket && req.socket.remoteAddress) ||
    "unknown"
  );
}

export async function rateLimit(req, { bucket = "gen", limit = 30, windowSec = 3600 } = {}) {
  const ip = clientIp(req);
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${ip}:${window}`;
  try {
    const n = await kvIncr(key);
    if (n === 1) await kvExpire(key, windowSec);
    return { ok: n <= limit, count: n, limit, remaining: Math.max(0, limit - n), windowSec };
  } catch (_) {
    return { ok: true, count: 0, limit, remaining: limit, windowSec, degraded: true };
  }
}

// Applies the limit and writes the standard headers. Returns true if the
// handler should stop.
export async function enforce(req, res, opts) {
  const r = await rateLimit(req, opts);
  res.setHeader("X-RateLimit-Limit", String(r.limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  if (!r.ok) {
    res.setHeader("Retry-After", String(r.windowSec));
    res.status(429).json({ error: "Rate limit reached — try again shortly." });
    return true;
  }
  return false;
}
