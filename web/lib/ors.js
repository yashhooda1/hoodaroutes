// lib/ors.js — HoodaRoutes routing engine (worldwide).
// Generates a real, snapped running LOOP from a start point using
// OpenRouteService round-trip routing over OpenStreetMap data.
//
// Works anywhere ORS/OSM has coverage (i.e. most of the planet).
// Free key: https://openrouteservice.org/dev/#/signup  -> set ORS_API_KEY.

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
const M_PER_MI = 1609.34;
const FT_PER_M = 3.28084;

// One ORS round-trip request for a given target length (meters).
async function fetchLoop({ lat, lng, profile, seed, lengthM, key }) {
  const body = {
    coordinates: [[Number(lng), Number(lat)]],
    elevation: true,
    instructions: false,
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
  return { f, distanceMi };
}

// profile: "foot-walking" (roads/sidewalks) | "foot-hiking" (trails/paths)
//
// ORS round-trip routing only approximates the requested loop length — it has
// to snap to whatever real streets exist, so a request for 6 mi can come back
// 10+. We calibrate: generate, measure the miss, then re-request at a
// proportionally scaled length and keep the closest result. Capped at 3 calls.
export async function generateLoop({ lat, lng, miles, profile = "foot-walking", seed = 1 }) {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY is not set");

  const target = Number(miles);
  const TOL = 0.12;        // accept within 12% of target
  const MAX_ATTEMPTS = 3;  // 1 initial + up to 2 calibration retries

  let lengthM = target * M_PER_MI;   // first attempt: ask for exactly the target
  let best = null;                   // closest attempt seen so far

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { f, distanceMi } = await fetchLoop({ lat, lng, profile, seed, lengthM, key });

    const err = target > 0 ? Math.abs(distanceMi - target) / target : 1;
    if (!best || err < best.err) best = { f, distanceMi, err };

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

  return {
    coordinates: coords,                            // for GPX (lng,lat,ele)
    latlngs: coords.map((c) => [c[1], c[0]]),        // for Leaflet
    elevationsFt: coords.map((c) => Math.round((c[2] || 0) * FT_PER_M)),
    distanceMi,
    ascentFt,
    descentFt,
    boulderFit: boulderFit(distanceMi, ascentFt),
    profile,
    seed: Number(seed),
    reqMiles: target,
  };
}

// Heuristic "Boulderthon fit": rewards rolling terrain (hill specificity for a
// 5,400 ft rolling goal race) and sustained distance (marathon-block volume).
export function boulderFit(miles, ascentFt) {
  const perMi = miles > 0 ? ascentFt / miles : 0;
  const hill = Math.min(38, perMi / 1.8);          // ~68 ft/mi -> ~38
  const dist = Math.min(22, (miles / 20) * 22);    // 20 mi -> 22
  return Math.max(0, Math.min(100, Math.round(45 + hill + dist)));
}
