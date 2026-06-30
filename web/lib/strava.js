// lib/strava.js — per-user Strava: OAuth code exchange, token storage with
// auto-refresh, recent runs, today's suggestion, and a training analysis.
//
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (scope activity:read_all).
// Per-user tokens live in Upstash under  user:{athleteId}.
import { kvGet, kvSet } from "./store.js";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";
const M = 1609.34;

// --- OAuth ---
export async function exchangeCode(code) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`Strava exchange ${r.status}`);
  return r.json(); // { access_token, refresh_token, expires_at, athlete }
}

// Returns a valid access token for a user, refreshing + persisting if needed.
export async function getValidToken(athleteId) {
  const u = await kvGet(`user:${athleteId}`);
  if (!u) throw new Error("not connected");
  if (u.expires_at > Math.floor(Date.now() / 1000) + 60) return u.access_token;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: u.refresh_token,
    }),
  });
  if (!r.ok) throw new Error(`Strava refresh ${r.status}`);
  const t = await r.json();
  u.access_token = t.access_token;
  u.refresh_token = t.refresh_token; // Strava rotates this — persist it
  u.expires_at = t.expires_at;
  await kvSet(`user:${athleteId}`, u);
  return u.access_token;
}

// Single-user (your own watch) fallback via env refresh token.
export async function stravaAccessTokenEnv() {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    }),
  });
  if (!r.ok) throw new Error(`Strava token ${r.status}`);
  return (await r.json()).access_token;
}

// --- Data ---
export async function recentRuns(token, days = 28) {
  const after = Math.floor(Date.now() / 1000) - days * 86400;
  const r = await fetch(`${API}/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Strava activities ${r.status}`);
  const acts = await r.json();
  return acts
    .filter((a) => a.type === "Run" || a.sport_type === "Run" || a.sport_type === "TrailRun")
    .map((a) => ({
      miles: +(a.distance / M).toFixed(2),
      date: a.start_date_local,
      movingTime: a.moving_time,
      startLat: a.start_latlng && a.start_latlng[0],
      startLng: a.start_latlng && a.start_latlng[1],
      trail: a.sport_type === "TrailRun",
    }));
}

// --- Suggestion (today's run) ---
export function suggestToday(runs) {
  const dayMs = 86400000;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const between = (d0, d1) =>
    runs.filter((r) => { const t = new Date(r.date); return t >= d0 && t < d1; })
        .reduce((s, r) => s + r.miles, 0);

  const yesterdayMiles = between(new Date(today0 - dayMs), today0);
  const weeklyMiles = +between(new Date(today0 - 6 * dayMs), new Date(today0.getTime() + dayMs)).toFixed(1);
  const threeWkAvg = +(between(new Date(today0 - 21 * dayMs), today0) / 3).toFixed(1);
  const targetWeekly = Math.max(weeklyMiles, threeWkAvg, 30);
  const longThisWeek = runs.some((r) => {
    const t = new Date(r.date); return t >= new Date(today0 - 6 * dayMs) && r.miles >= 14;
  });
  const dow = new Date().getDay();

  let miles, type, rationale;
  if (yesterdayMiles >= 14) {
    miles = Math.max(5, Math.round(targetWeekly * 0.16)); type = "RECOVERY";
    rationale = `You ran ${Math.round(yesterdayMiles)} mi yesterday — keep today easy.`;
  } else if ((dow === 6 || dow === 0) && !longThisWeek) {
    miles = Math.min(20, Math.max(14, Math.round(targetWeekly * 0.32))); type = "LONG";
    rationale = `No long run yet this week — go long (~${miles} mi).`;
  } else if (yesterdayMiles <= 7 && dow >= 2 && dow <= 4) {
    miles = Math.round(targetWeekly * 0.22); type = "QUALITY";
    rationale = `Midweek, fresh legs — a steady/quality ${Math.round(targetWeekly * 0.22)} mi fits.`;
  } else {
    miles = Math.max(5, Math.round(targetWeekly * 0.17)); type = "EASY";
    rationale = `Easy aerobic miles — ${weeklyMiles} mi logged so far this week.`;
  }
  miles = Math.max(3, Math.min(22, miles));
  return { suggestedMiles: miles, type, rationale, weeklyMiles, yesterdayMiles: +yesterdayMiles.toFixed(1) };
}

// --- Training analysis (their own history) ---
export function analyzeTraining(runs) {
  const dayMs = 86400000;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);

  const weeks = [0, 1, 2, 3].map((i) => {
    const end = new Date(today0.getTime() - i * 7 * dayMs + dayMs);
    const start = new Date(end.getTime() - 7 * dayMs);
    const mi = runs.filter((r) => { const t = new Date(r.date); return t >= start && t < end; })
                   .reduce((s, r) => s + r.miles, 0);
    return +mi.toFixed(1);
  });
  const weeklyAvg = +(weeks.reduce((a, b) => a + b, 0) / weeks.length).toFixed(1);
  const longestMi = +runs.reduce((m, r) => Math.max(m, r.miles), 0).toFixed(1);

  const paced = runs.filter((r) => r.movingTime && r.miles > 0.5);
  let avgPaceMinMi = null;
  if (paced.length) {
    const sec = paced.reduce((s, r) => s + r.movingTime / r.miles, 0) / paced.length;
    avgPaceMinMi = `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  }

  // Use the MOST RECENT run's start, not the average. Averaging start points
  // across runs in different places lands the "usual start" somewhere between
  // them — with any geographic spread that can drift into open water. The
  // latest real run start is the best guess for where you'll run next.
  const starts = runs
    .filter((r) => r.startLat && r.startLng)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const startLat = starts.length ? +starts[0].startLat.toFixed(5) : null;
  const startLng = starts.length ? +starts[0].startLng.toFixed(5) : null;
  const trailShare = runs.length ? +(runs.filter((r) => r.trail).length / runs.length).toFixed(2) : 0;

  return { weeks, weeklyAvg, longestMi, avgPaceMinMi, startLat, startLng, trailShare, runCount: runs.length };
}
