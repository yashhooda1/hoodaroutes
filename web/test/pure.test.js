// Tests for the pure, network-free logic: route classification, race scoring
// and training analysis. No Strava, no ORS, no Redis, no API key — so this
// suite runs in CI on a bare checkout in well under a second.
import test from "node:test";
import assert from "node:assert/strict";

import { classifySurface, surfaceToProfile } from "../lib/ors.js";
import { raceFit, resolveRace, RACES, DEFAULT_RACE_ID } from "../lib/race.js";
import { analyzeTraining, suggestToday } from "../lib/strava.js";

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ---------------------------------------------------------------- race fit

test("raceFit rewards flat routes for a flat goal race", () => {
  const flat = raceFit(10, 120, "houston");   // 12 ft/mi
  const hilly = raceFit(10, 900, "houston");  // 90 ft/mi
  assert.ok(flat > hilly, `expected flat ${flat} > hilly ${hilly}`);
});

test("raceFit rewards hilly routes for a mountain goal race", () => {
  const hilly = raceFit(10, 700, "boulderthon");
  const flat = raceFit(10, 100, "boulderthon");
  assert.ok(hilly > flat, `expected hilly ${hilly} > flat ${flat}`);
});

test("the same route scores differently against different races", () => {
  const route = [10, 800];
  assert.notEqual(raceFit(...route, "houston"), raceFit(...route, "boulderthon"));
});

test("raceFit stays in range for degenerate input", () => {
  for (const args of [[0, 0], [0, 5000], [26, 0], [50, 40000], [-3, -3]]) {
    const s = raceFit(args[0], args[1], "houston");
    assert.ok(s >= 0 && s <= 100, `${args} -> ${s}`);
    assert.ok(Number.isFinite(s));
  }
});

test("longer routes score at least as high as shorter ones on equal terrain", () => {
  const short = raceFit(5, 5 * 13, "houston");
  const long = raceFit(20, 20 * 13, "houston");
  assert.ok(long >= short);
});

test("resolveRace falls back rather than throwing on junk", () => {
  assert.equal(resolveRace("not-a-race").id, RACES[DEFAULT_RACE_ID].id);
  assert.equal(resolveRace(null).id, RACES[DEFAULT_RACE_ID].id);
  assert.equal(resolveRace(undefined).id, RACES[DEFAULT_RACE_ID].id);
});

test("resolveRace accepts a custom override", () => {
  const r = resolveRace({ id: "custom", name: "Backyard 50K", targetFtPerMi: 200, longRunMi: 24 });
  assert.equal(r.targetFtPerMi, 200);
  assert.equal(r.longRunMi, 24);
});

// ------------------------------------------------------- surface detection

test("classifySurface reads a fully paved route as road", () => {
  const extras = { surface: { summary: [{ value: 3, amount: 95 }, { value: 2, amount: 5 }] } };
  assert.equal(classifySurface(extras).label, "road");
});

test("classifySurface reads a dirt route as trail", () => {
  const extras = { surface: { summary: [{ value: 10, amount: 90 }, { value: 3, amount: 10 }] } };
  assert.equal(classifySurface(extras).label, "trail");
});

test("classifySurface reads an even split as mixed", () => {
  const extras = { surface: { summary: [{ value: 3, amount: 50 }, { value: 10, amount: 50 }] } };
  assert.equal(classifySurface(extras).label, "mixed");
});

test("classifySurface falls back to waytype when surface is untagged", () => {
  const extras = { surface: { summary: [] }, waytype: { summary: [{ value: 4, amount: 80 }] } };
  assert.equal(classifySurface(extras).label, "trail");
});

test("classifySurface survives missing extras", () => {
  assert.ok(["road", "trail", "track", "mixed"].includes(classifySurface(undefined).label));
  assert.equal(classifySurface(undefined, "foot-hiking").label, "trail");
});

test("surfaceToProfile maps preferences to ORS foot profiles", () => {
  assert.equal(surfaceToProfile("trail"), "foot-hiking");
  assert.equal(surfaceToProfile("road"), "foot-walking");
  assert.equal(surfaceToProfile("auto"), null);
});

// -------------------------------------------------------- training analysis

test("analyzeTraining uses the most recent run's start, not an average", () => {
  const runs = [
    { miles: 6, date: daysAgo(1), movingTime: 2700, startLat: 29.76, startLng: -95.36 },
    { miles: 8, date: daysAgo(9), movingTime: 3600, startLat: 40.01, startLng: -105.27 },
  ];
  const p = analyzeTraining(runs);
  assert.equal(p.startLat, 29.76);
  assert.equal(p.startLng, -95.36);
});

test("analyzeTraining handles an empty history without throwing", () => {
  const p = analyzeTraining([]);
  assert.equal(p.runCount, 0);
  assert.equal(p.startLat, null);
  assert.equal(p.avgPaceMinMi, null);
});

test("suggestToday prescribes recovery the day after a long run", () => {
  const runs = [{ miles: 18, date: daysAgo(1), movingTime: 9000 }];
  assert.equal(suggestToday(runs).type, "RECOVERY");
});

test("suggestToday always returns a runnable distance", () => {
  for (const runs of [[], [{ miles: 22, date: daysAgo(1), movingTime: 11000 }]]) {
    const s = suggestToday(runs);
    assert.ok(s.suggestedMiles >= 3 && s.suggestedMiles <= 22);
  }
});
