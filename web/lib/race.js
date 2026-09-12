// lib/race.js — goal-race profiles.
//
// The route "fit" score and every coaching prompt are driven by the athlete's
// CURRENT goal race, not a race welded in at build time. A score that rewards
// climbing is correct for a mountain marathon and actively wrong for a flat
// one, so the terrain target is a property of the race, not of the app.
//
// Add a race to RACES (or let a user store a custom one) and the ring, the
// dashboard, the watch list and the AI coach all follow.

export const RACES = {
  houston: {
    id: "houston",
    name: "Chevron Houston Marathon",
    distanceMi: 26.2,
    targetFtPerMi: 13, // flat, sea level
    elevationFt: 50,
    longRunMi: 20,
    month: 1,
    terrain: "flat road",
    notes:
      "Flat, sea-level, January. Rewards marathon-pace volume and late-race " +
      "fueling over hill strength; big climbs are supplemental, not specific.",
  },
  boulderthon: {
    id: "boulderthon",
    name: "Boulderthon Marathon",
    distanceMi: 26.2,
    targetFtPerMi: 68, // ~1,800 ft over the course, rolling
    elevationFt: 5400,
    longRunMi: 20,
    month: 9,
    terrain: "rolling road at altitude",
    notes:
      "Rolling course at 5,400 ft. Rewards hill specificity and sustained " +
      "climbing under fatigue.",
  },
  road_marathon: {
    id: "road_marathon",
    name: "Road marathon (generic)",
    distanceMi: 26.2,
    targetFtPerMi: 25,
    elevationFt: 0,
    longRunMi: 20,
    month: null,
    terrain: "road",
    notes: "Mixed road course with mild rollers.",
  },
  half_marathon: {
    id: "half_marathon",
    name: "Half marathon",
    distanceMi: 13.1,
    targetFtPerMi: 20,
    elevationFt: 0,
    longRunMi: 14,
    month: null,
    terrain: "road",
    notes: "Half-marathon block: shorter long runs, more threshold work.",
  },
  trail_ultra: {
    id: "trail_ultra",
    name: "Trail ultra (50K+)",
    distanceMi: 31,
    targetFtPerMi: 130,
    elevationFt: 0,
    longRunMi: 24,
    month: null,
    terrain: "trail",
    notes: "Vertical gain and time on feet matter more than pace.",
  },
};

export const DEFAULT_RACE_ID = "houston";

// Accepts a race id, a full race object, or null/undefined.
// Unknown ids fall back to the default rather than throwing — a bad value in
// a query string must never take down route generation.
export function resolveRace(race) {
  if (!race) return RACES[DEFAULT_RACE_ID];
  if (typeof race === "string") return RACES[race] || RACES[DEFAULT_RACE_ID];
  if (typeof race === "object") {
    const base = RACES[race.id] || RACES[DEFAULT_RACE_ID];
    return {
      ...base,
      ...race,
      targetFtPerMi: Number(race.targetFtPerMi ?? base.targetFtPerMi),
      longRunMi: Number(race.longRunMi ?? base.longRunMi),
    };
  }
  return RACES[DEFAULT_RACE_ID];
}

// raceFit — 0-100 "how specific is this route to the goal race".
//
//   40  base (any run is better than no run)
//  +35  terrain match
//  +25  distance relevance, relative to the race's long-run anchor.
//
// The terrain term is a Gaussian on the LOG RATIO of actual to target ft/mi,
// not on their absolute difference. That matters because elevation data is
// noisy: an earlier absolute-difference version with a 12 ft/mi spread scored
// zero terrain for anything past ~40 ft/mi, so a flat-race route measured with
// typical DEM error collapsed to the same score as a mountain route. A ratio
// is scale-free — 3x the target costs the same whether the target is 13 ft/mi
// or 130 — and NOISE_FLOOR keeps a flat race from dividing by near-zero, since
// nobody can measure the difference between 2 and 6 ft/mi anyway.
const NOISE_FLOOR = 8; // ft/mi below which elevation data isn't meaningful
const TERRAIN_K = 0.9; // width in log units; larger = more forgiving

export function raceFit(miles, ascentFt, race) {
  const goal = resolveRace(race);
  const mi = Math.max(0, Number(miles) || 0);
  const perMi = mi > 0 ? Math.max(0, Number(ascentFt) || 0) / mi : 0;

  const target = Math.max(1, goal.targetFtPerMi);
  const ratio = (perMi + NOISE_FLOOR) / (target + NOISE_FLOOR);
  const terrain = 35 * Math.exp(-Math.pow(Math.log(ratio) / TERRAIN_K, 2));

  const anchor = Math.max(3, goal.longRunMi || 20);
  const dist = 25 * Math.min(1, mi / anchor);

  return Math.max(0, Math.min(100, Math.round(40 + terrain + dist)));
}

export function fitCaption(score) {
  if (score >= 85) return "Prime prep route";
  if (score >= 75) return "Strong fit";
  return "Supplemental";
}

// One line of race context for LLM prompts — keeps every prompt in the app
// consistent with whatever race the athlete has actually selected.
export function racePromptLine(race) {
  const g = resolveRace(race);
  const when = g.month
    ? ` (${["", "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"][g.month]})`
    : "";
  return `${g.name}${when} — ${g.distanceMi} mi, ${g.terrain}, about ${g.targetFtPerMi} ft of gain per mile. ${g.notes}`;
}

// Per-user storage key for the selected goal race.
export const raceKey = (athleteId) => `race:${athleteId}`;
