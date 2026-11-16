// lib/coursejson.js — a route as compact JSON for the Apple Watch app.
//
// Garmin gets FIT (the device files it as a native course) and everyone else
// gets GPX. watchOS has no native course list to hand a file to, so the watch
// app draws and tracks the route itself and just needs the geometry. JSON
// saves it an XML parser, and rounding keeps a long loop small enough to pull
// over a watch's cellular link: 6 dp of lat/lng is ~0.1 m, 1 dp of elevation
// is already below DEM noise.

const round = (v, dp) => {
  const k = 10 ** dp;
  return Math.round(Number(v) * k) / k;
};

export function toCourseJson({ name, route }) {
  const coordinates = [];
  for (const c of route.coordinates || []) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // GeoJSON order, same as everywhere else in this codebase: [lng, lat, ele].
    // Elevation is dropped (not zero-filled) when the DEM had no value.
    const ele = c[2] == null ? NaN : Number(c[2]);
    coordinates.push(
      Number.isFinite(ele)
        ? [round(lng, 6), round(lat, 6), round(ele, 1)]
        : [round(lng, 6), round(lat, 6)]
    );
  }
  return {
    name,
    distanceMi: route.distanceMi,
    ascentFt: route.ascentFt,
    descentFt: route.descentFt,
    surface: route.surface,
    profile: route.profile,
    elevationSource: route.elevationSource,
    coordinates,
  };
}
