// /api/garmin/routes  — the watch sends its GPS position; we return a few
// generated loop options of varying distance / surface, ranked for the device's
// current location. Works anywhere in the world.
//
// GET/POST  { lat, lng }  ->  { lat, lng, routes: [ ... ] }
import { generateLoop } from "../../lib/ors.js";
import { stravaAccessTokenEnv, recentRuns, suggestToday } from "../../lib/strava.js";
import { sessionFromReq } from "../../lib/session.js";
import { raceForRequest } from "../race.js";

const SPECS = [
  { label: "Recovery",   miles: 3,  profile: "foot-walking", seed: 5  },
  { label: "Easy",       miles: 5,  profile: "foot-walking", seed: 11 },
  { label: "Tempo",      miles: 6,  profile: "foot-walking", seed: 17 },
  { label: "Steady",     miles: 8,  profile: "foot-walking", seed: 22 },
  { label: "Long",       miles: 13, profile: "foot-walking", seed: 33 },
  { label: "Marathon",   miles: 18, profile: "foot-walking", seed: 39 },
  { label: "Trail",      miles: 8,  profile: "foot-hiking",  seed: 44 },
  { label: "Trail Long", miles: 12, profile: "foot-hiking",  seed: 51 },
];

export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const race = await raceForRequest(req, sessionFromReq(req));

    // Generate in parallel; tolerate individual failures.
    const settled = await Promise.allSettled(
      SPECS.map((s) => generateLoop({ lat, lng, ...s, race }))
    );

    const routes = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const v = r.value;
        const s = SPECS[i];
        routes.push({
          id: `${s.profile}-${s.miles}-${s.seed}`,
          name: `${s.label} ${v.distanceMi} mi`,
          miles: v.distanceMi,
          elevFt: v.ascentFt,
          shade: v.surface,   // detected: road | trail | track | mixed
          fit: v.fit,
          boulderFit: v.fit,  // deprecated alias — drop once the watch app is rebuilt
          lat, lng,
          profile: s.profile,
          seed: s.seed,
          reqMiles: s.miles,
        });
      }
    });

    // If Strava is configured, lead with a "Today" loop sized to recent volume.
    if (process.env.STRAVA_REFRESH_TOKEN) {
      try {
        const token = await stravaAccessTokenEnv();
        const s = suggestToday(await recentRuns(token, 21));
        const v = await generateLoop({ lat, lng, miles: s.suggestedMiles, profile: "foot-walking", seed: 7, race });
        routes.unshift({
          id: "today",
          name: `Today ${v.distanceMi} mi · ${s.type}`,
          miles: v.distanceMi,
          elevFt: v.ascentFt,
          shade: v.surface,
          fit: v.fit,
          boulderFit: v.fit,  // deprecated alias
          lat, lng,
          profile: "foot-walking",
          seed: 7,
          reqMiles: s.suggestedMiles,
          suggested: true,
          rationale: s.rationale,
        });
      } catch (_) { /* Strava optional — ignore if unavailable */ }
    }

    res.setHeader("Cache-Control", "s-maxage=600");
    res.status(200).json({ lat, lng, race: { id: race.id, name: race.name }, routes });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
