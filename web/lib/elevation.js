// lib/elevation.js — trustworthy elevation for a route geometry.
//
// WHY THIS EXISTS. OpenRouteService returns per-point elevation from SRTM and
// a summed `ascent`/`descent` alongside it. In flat urban terrain SRTM is
// unusable: a measured 8.5 mi loop through downtown Houston came back as
// 1,157 ft of gain (136 ft/mi) with individual readings swinging 46 -> 118 ft
// over a few hundred metres and one point at -30 ft, below sea level. The true
// figure is under ~150 ft. Summing every micro-delta turns that noise into
// hundreds of feet of phantom climb, which then dominates any terrain-based
// score.
//
// Two fixes, applied in order:
//   1. Re-sample elevation from Copernicus DEM (Open-Meteo's elevation API —
//      free, keyless, batched), which is markedly better than SRTM over cities.
//   2. Denoise whatever we end up with: median smoothing to kill spikes, then
//      hysteresis accumulation so only sustained climbs count.
//
// Step 1 is best-effort. Any failure — network, timeout, malformed response,
// ELEVATION_SOURCE=ors — falls back to the ORS values, which still get step 2.
// The route must never fail because an elevation lookup did.

const OPEN_METEO = "https://api.open-meteo.com/v1/elevation";
const CHUNK = 100; // Open-Meteo's documented per-request coordinate limit
const MAX_POINTS = 600; // cap fan-out; longer routes are sampled and interpolated
const TIMEOUT_MS = Number(process.env.ELEVATION_TIMEOUT_MS || 4000);

const FT_PER_M = 3.28084;

// --- denoising --------------------------------------------------------------

function median(win) {
  const s = [...win].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// Median filter: removes isolated spikes (a bridge deck, a building edge in the
// DEM) without shifting a genuine hill the way a mean would.
export function smoothElevations(elesM, win = 7) {
  if (!Array.isArray(elesM) || elesM.length < 3) return elesM || [];
  const h = win >> 1;
  return elesM.map((_, i) =>
    median(elesM.slice(Math.max(0, i - h), Math.min(elesM.length, i + h + 1)))
  );
}

// Hysteresis accumulation: bank a climb only once it exceeds `thresholdM` from
// the last committed reference point. This is how Strava and Garmin avoid
// counting sensor jitter as vertical gain.
export function accumulate(elesM, thresholdM = 3) {
  if (!Array.isArray(elesM) || elesM.length < 2) return { ascentM: 0, descentM: 0 };
  let ascent = 0;
  let descent = 0;
  let ref = elesM[0];
  for (let i = 1; i < elesM.length; i++) {
    const d = elesM[i] - ref;
    if (d >= thresholdM) {
      ascent += d;
      ref = elesM[i];
    } else if (d <= -thresholdM) {
      descent += -d;
      ref = elesM[i];
    }
  }
  return { ascentM: ascent, descentM: descent };
}

// --- fetching ---------------------------------------------------------------

async function fetchChunk(latlngs, signal) {
  const lat = latlngs.map((p) => p[0].toFixed(5)).join(",");
  const lng = latlngs.map((p) => p[1].toFixed(5)).join(",");
  const r = await fetch(`${OPEN_METEO}?latitude=${lat}&longitude=${lng}`, { signal });
  if (!r.ok) throw new Error(`elevation ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data.elevation) || data.elevation.length !== latlngs.length) {
    throw new Error("elevation: unexpected response shape");
  }
  return data.elevation.map(Number);
}

// Evenly sample indices so a very long route still costs a bounded number of
// requests. Always keeps the first and last point.
function sampleIndices(n, max) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

// Linear interpolation back onto every original point.
function expand(values, indices, n) {
  const out = new Array(n);
  for (let k = 0; k < indices.length - 1; k++) {
    const i0 = indices[k];
    const i1 = indices[k + 1];
    const v0 = values[k];
    const v1 = values[k + 1];
    for (let i = i0; i <= i1; i++) {
      out[i] = i1 === i0 ? v0 : v0 + ((v1 - v0) * (i - i0)) / (i1 - i0);
    }
  }
  out[n - 1] = values[values.length - 1];
  for (let i = 0; i < n; i++) if (out[i] == null) out[i] = values[0];
  return out;
}

// Returns metres for every latlng, or null if the lookup couldn't be trusted.
export async function fetchElevationsM(latlngs) {
  if ((process.env.ELEVATION_SOURCE || "open-meteo") === "ors") return null;
  if (!Array.isArray(latlngs) || latlngs.length === 0) return null;

  const idx = sampleIndices(latlngs.length, MAX_POINTS);
  const pts = idx.map((i) => latlngs[i]);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const chunks = [];
    for (let i = 0; i < pts.length; i += CHUNK) chunks.push(pts.slice(i, i + CHUNK));
    const results = await Promise.all(chunks.map((c) => fetchChunk(c, ac.signal)));
    const flat = results.flat();
    if (flat.length !== pts.length || flat.some((v) => !Number.isFinite(v))) return null;
    return idx.length === latlngs.length ? flat : expand(flat, idx, latlngs.length);
  } catch (_) {
    return null; // any failure -> caller keeps the ORS values
  } finally {
    clearTimeout(timer);
  }
}

// --- the one function callers need -----------------------------------------
//
// Given the ORS geometry ([lng, lat, eleM]), produce a denoised elevation
// profile and honest ascent/descent totals.
export async function elevationProfile(coords) {
  const latlngs = coords.map((c) => [c[1], c[0]]);
  const orsM = coords.map((c) => Number(c[2]) || 0);

  const fetched = await fetchElevationsM(latlngs);
  const source = fetched ? "copernicus" : "srtm";
  const rawM = fetched || orsM;

  const smoothM = smoothElevations(rawM);
  const { ascentM, descentM } = accumulate(smoothM);

  return {
    source,
    elevationsM: smoothM,
    elevationsFt: smoothM.map((m) => Math.round(m * FT_PER_M)),
    ascentFt: Math.round(ascentM * FT_PER_M),
    descentFt: Math.round(descentM * FT_PER_M),
  };
}
