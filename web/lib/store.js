// lib/store.js — tiny Upstash Redis (REST) helper for per-user token storage.
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (you already run Upstash).
//
// When those aren't set (local `vercel dev`, CI, a fresh clone) we fall back to
// an in-process Map instead of throwing. Previously a missing env var made
// EVERY endpoint 500, so the app couldn't be run at all without provisioning
// Redis first. The fallback is per-instance and non-durable — fine for local
// work, useless in production, which is why we log once and say so.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const usingMemoryStore = !URL || !TOKEN;

if (usingMemoryStore) {
  console.warn(
    "[store] UPSTASH_REDIS_REST_URL/TOKEN not set — using in-memory store. " +
      "Sessions and tokens will not survive a restart. Do not run production like this."
  );
}

// --- in-memory fallback -----------------------------------------------------
const mem = new Map(); // key -> { v: string, exp: number|null }

function memAlive(e) {
  if (!e) return false;
  if (e.exp && e.exp < Date.now()) return false;
  return true;
}

function memCommand([op, key, ...rest]) {
  const e = mem.get(key);
  switch (op) {
    case "GET":
      return memAlive(e) ? e.v : null;
    case "SET": {
      let exp = null;
      const ex = rest.indexOf("EX");
      if (ex !== -1) exp = Date.now() + Number(rest[ex + 1]) * 1000;
      mem.set(key, { v: rest[0], exp });
      return "OK";
    }
    case "DEL":
      mem.delete(key);
      return 1;
    case "INCR": {
      const n = (memAlive(e) ? Number(e.v) || 0 : 0) + 1;
      mem.set(key, { v: String(n), exp: memAlive(e) ? e.exp : null });
      return n;
    }
    case "EXPIRE": {
      if (!memAlive(e)) return 0;
      e.exp = Date.now() + Number(rest[0]) * 1000;
      return 1;
    }
    default:
      throw new Error(`memory store: unsupported command ${op}`);
  }
}

async function redis(command) {
  if (usingMemoryStore) return memCommand(command);
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`Upstash ${r.status}: ${await r.text()}`);
  return (await r.json()).result;
}

export async function kvGet(key) {
  const v = await redis(["GET", key]);
  return v ? JSON.parse(v) : null;
}

export async function kvSet(key, value, ttlSec) {
  const cmd = ["SET", key, JSON.stringify(value)];
  if (ttlSec) cmd.push("EX", String(ttlSec));
  return redis(cmd);
}

export async function kvDel(key) {
  return redis(["DEL", key]);
}

// Counter primitives — used by lib/ratelimit.js.
export async function kvIncr(key) {
  return Number(await redis(["INCR", key]));
}

export async function kvExpire(key, ttlSec) {
  return redis(["EXPIRE", key, String(ttlSec)]);
}
