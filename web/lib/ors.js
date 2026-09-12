// lib/ors.js — HoodaRoutes routing engine (worldwide).
// Generates a real, snapped running LOOP from a start point using
// OpenRouteService round-trip routing over OpenStreetMap data.
//
// Works anywhere ORS/OSM has coverage (i.e. most of the planet).
// Free key: https://openrouteservice.org/dev/#/signup  -> set ORS_API_KEY.

import { resolveRace, raceFit } from "./race.js";

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
const M_PER_MI = 1609.34;
const FT_PER_M = 3.28084;

// One ORS round-trip request for a given target length (meters).
async function fetchLoop({ lat, lng, profile, seed, lengthM, key }) {
  const body = {
    coordinates: [[Number(lng), Number(lat)]],
    elevation: true,
    instructions: false,
    // surface + waytype come straight from OSM tags on the returned route —
    // this is what lets us auto-detect road/trail/track/mixed for free.
    extra_info: ["surface", "waytype"],
    options: {
      round_trip: { length: Math.round(lengthM), points: 6, seed: Number(seed) },
    },
  };
  const r = await fetch(`${ORS_BASE}/${profile}/geojson`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`ORS ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const f = data.features && data.features[0];
  if (!f) throw new Error("ORS returned no route");
  const summary = f.properties.summary || {};
  const distanceMi = +(((summary.distance || 0) / M_PER_MI) || 0).toFixed(2);
  return { f, distanceMi, extras: f.properties.extras };
}

// ---- Surface auto-detection ------------------------------------------------
// ORS returns per-route surface + waytype breakdowns sourced from OSM tags.
// We turn those into one of four labels: road | trail | track | mixed.
// (ORS hosted foot routing only has two *profiles* — walking/hiking — so this
// detection is how we honestly report the actual ground, not a guess.)
//
// ORS surface codes: 1 Paved, 3 Asphalt, 4 Concrete, 5 Cobblestone, 6 Metal,
//   7 Wood, 14 Paving Stones = hard/paved; 2 Unpaved, 8-12 gravel/dirt/ground,
//   15 Sand, 16 Woodchips, 17-18 Grass = unpaved; 0/13 unknown.
// ORS waytype codes: 4 Path, 5 Track, 1/2/3 road/street, 7 Footway.
const PAVED_SURFACES = [1, 3, 4, 5, 6, 7, 14];
const UNPAVED_SURFACES = [2, 8, 9, 10, 11, 12, 15, 16, 17, 18];

function pctOf(summary, codes) {
  if (!Array.isArray(summary)) return 0;
  return summary
    .filter((s) => codes.includes(s.value))
    .reduce((a, s) => a + (s.amount || 0), 0);
}

export function classifySurface(extras, profileFallback = "foot-walking") {
  const surf = extras && extras.surface && extras.surface.summary;
  const way = extras && extras.waytype && extras.waytype.summary;

  const paved = pctOf(surf, PAVED_SURFACES);
  const unpaved = pctOf(surf, UNPAVED_SURFACES);
  const track = pctOf(way, [5]); // waytype: Track
  const known = paved + unpaved;

  let label;
  if (track >= 40) {
    label = "track";
  } else if (known >= 50) {
    // Surface is well-tagged — classify by paved share.
    if (paved >= 75) label = "road";
    else if (paved <= 25) label = "trail";
    else label = "mixed";
  } else {
    // Surface poorly tagged in OSM — fall back to way type.
    const path = pctOf(way, [4]);          // Path
    const roadish = pctOf(way, [1, 2, 3, 7]); // StateRoad/Road/Street/Footway
    if (path >= 50) label = "trail";
    else if (roadish >= 60) label = "road";
    else label = profileFallback === "foot-hiking" ? "trail" : "road";
  }

  return {
    label,
    pavedPct: Math.round(paved),
    unpavedPct: Math.round(unpaved),
    trackPct: Math.round(track),
  };
}

// Map a requested surface preference to the best available ORS foot profile.
// Honest limitation: ORS hosts only foot-walking / foot-hiking, so track and
// mixed bias toward the closest profile; detection then reports what you got.
export function surfaceToProfile(surface) {
  switch (surface) {
    case "trail":
    case "track":
      return "foot-hiking";
    case "road":
    case "mixed":
      return "foot-walking";
    default:
      return null; // "auto" / unknown -> caller default
  }
}

// profile: "foot-walking" (roads/sidewalks) | "foot-hiking" (trails/paths)
//
// ORS round-trip routing only approximates the requested loop length — it has
// to snap to whatever real streets exist, so a request for 6 mi can come back
// 10+. We calibrate: generate, measure the miss, then re-request at a
// proportionally scaled length and keep the closest result. Capped at 3 calls.
export async function generateLoop({ lat, lng, miles, profile, surface, seed = 1, race }) {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY is not set");

  const goal = resolveRace(race);

  // Explicit profile wins; else derive from surface preference; else default.
  const resolvedProfile = profile || surfaceToProfile(surface) || "foot-walking";

  const target = Number(miles);
  const TOL = 0.12;        // accept within 12% of target
  const MAX_ATTEMPTS = 3;  // 1 initial + up to 2 calibration retries

  let lengthM = target * M_PER_MI;   // first attempt: ask for exactly the target
  let best = null;                   // closest attempt seen so far

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { f, distanceMi, extras } = await fetchLoop({ lat, lng, profile: resolvedProfile, seed, lengthM, key });

    const err = target > 0 ? Math.abs(distanceMi - target) / target : 1;
    if (!best || err < best.err) best = { f, distanceMi, extras, err };

    if (err <= TOL || distanceMi <= 0) break;   // close enough (or unusable) -> stop

    // Proportional correction: a request of lengthM produced distanceMi, so
    // scale the next request by target/actual to home in on the target length.
    lengthM = lengthM * (target / distanceMi);
    lengthM = Math.max(400, Math.min(lengthM, 100000)); // ORS round-trip bounds
  }

  const f = best.f;
  const distanceMi = best.distanceMi > 0 ? best.distanceMi : target;
  const coords = f.geometry.coordinates;            // [lng, lat, ele]
  const ascentFt = Math.round((f.properties.ascent || 0) * FT_PER_M);
  const descentFt = Math.round((f.properties.descent || 0) * FT_PER_M);
  const surf = classifySurface(best.extras, resolvedProfile);

  return {
    coordinates: coords,                            // for GPX (lng,lat,ele)
    latlngs: coords.map((c) => [c[1], c[0]]),        // for Leaflet
    elevationsFt: coords.map((c) => Math.round((c[2] || 0) * FT_PER_M)),
    distanceMi,
    ascentFt,
    descentFt,
    fit: raceFit(distanceMi, ascentFt, goal),
    race: { id: goal.id, name: goal.name, targetFtPerMi: goal.targetFtPerMi },
    profile: resolvedProfile,
    surface: surf.label,                            // detected: road|trail|track|mixed
    surfaceBreakdown: { paved: surf.pavedPct, unpaved: surf.unpavedPct, track: surf.trackPct },
    surfacePref: surface || "auto",
    seed: Number(seed),
    reqMiles: target,
  };
}

// Scoring now lives in lib/race.js (raceFit) so it follows the athlete's goal
// race instead of being fixed to one course.
export { raceFit, fitCaption } from "./race.js";
