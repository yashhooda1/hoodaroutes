// lib/ors.js — HoodaRoutes routing engine (worldwide).
// Generates a real, snapped running LOOP from a start point using
// OpenRouteService round-trip routing over OpenStreetMap data.
//
// Works anywhere ORS/OSM has coverage (i.e. most of the planet).
// Free key: https://openrouteservice.org/dev/#/signup  -> set ORS_API_KEY.

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
const M_PER_MI = 1609.34;
const FT_PER_M = 3.28084;

// profile: "foot-walking" (roads/sidewalks) | "foot-hiking" (trails/paths)
export async function generateLoop({ lat, lng, miles, profile = "foot-walking", seed = 1 }) {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY is not set");

  const body = {
    coordinates: [[Number(lng), Number(lat)]],
    elevation: true,
    instructions: false,
    options: {
      round_trip: { length: Math.round(miles * M_PER_MI), points: 6, seed: Number(seed) },
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

  const coords = f.geometry.coordinates;            // [lng, lat, ele]
  const summary = f.properties.summary || {};
  const distanceMi = +(((summary.distance || 0) / M_PER_MI) || miles).toFixed(2);
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
    reqMiles: Number(miles),
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
