// lib/store.js — tiny Upstash Redis (REST) helper for per-user token storage.
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (you already run Upstash).

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
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
