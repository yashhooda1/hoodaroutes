// Tests for the pure, network-free logic: route classification, race scoring
// and training analysis. No Strava, no ORS, no Redis, no API key — so this
// suite runs in CI on a bare checkout in well under a second.
import test from "node:test";
import assert from "node:assert/strict";

import { classifySurface, surfaceToProfile } from "../lib/ors.js";
import { raceFit, resolveRace, RACES, DEFAULT_RACE_ID } from "../lib/race.js";
import { analyzeTraining, suggestToday } from "../lib/strava.js";
import { smoothElevations, accumulate, cumulativeM } from "../lib/elevation.js";
import { encodeCourseFit, crc16 } from "../lib/fit.js";

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

// -------------------------------------------------- elevation denoising

test("smoothElevations removes isolated spikes", () => {
  const noisy = [10, 10, 40, 10, 10, 10, 11, 10];
  const clean = smoothElevations(noisy);
  assert.ok(Math.max(...clean) < 20, `spike survived: ${clean}`);
});

test("a distance window rejects a sustained building plateau", () => {
  // 60 points ~27 m apart (the real sampling density), flat ground at 15 m,
  // with a ~160 m run of rooftop at 46 m — the width of a city block.
  const latlngs = [];
  for (let i = 0; i < 60; i++) latlngs.push([29.76 + i * 0.00024, -95.37]);
  const eles = latlngs.map((_, i) => (i >= 20 && i < 26 ? 46 : 15));
  const narrow = smoothElevations(eles, latlngs, 100);  // ~4 points
  const wide = smoothElevations(eles, latlngs, 500);    // ~19 points
  assert.ok(Math.max(...narrow) > 40, "narrow window should NOT reject it");
  assert.ok(Math.max(...wide) < 20, `wide window should reject it: ${Math.max(...wide)}`);
});

test("a distance window preserves a genuine long climb", () => {
  // 2 km of steady ascent, 100 m of gain — must survive smoothing.
  const latlngs = [];
  for (let i = 0; i < 80; i++) latlngs.push([39.99 + i * 0.000225, -105.27]);
  const eles = latlngs.map((_, i) => 1600 + (i / 79) * 100);
  const { ascentM } = accumulate(smoothElevations(eles, latlngs, 500), 3);
  assert.ok(ascentM > 80, `real climb was flattened: ${ascentM}`);
});

test("cumulativeM measures route distance sanely", () => {
  const km = cumulativeM([[29.76, -95.37], [29.769, -95.37]]);
  assert.ok(km[1] > 950 && km[1] < 1050, `expected ~1 km, got ${km[1]}`);
});

test("accumulate ignores jitter below the threshold", () => {
  const jitter = [];
  for (let i = 0; i < 200; i++) jitter.push(100 + (i % 2 ? 1 : -1)); // 2 m swings
  assert.equal(accumulate(jitter, 3).ascentM, 0);
});

test("accumulate still counts a real climb", () => {
  const hill = [0, 20, 40, 60, 80, 100];
  const { ascentM, descentM } = accumulate(hill, 3);
  assert.equal(ascentM, 100);
  assert.equal(descentM, 0);
});

test("accumulate reports descent separately on a loop", () => {
  const loop = [0, 50, 100, 50, 0];
  const { ascentM, descentM } = accumulate(loop, 3);
  assert.equal(ascentM, 100);
  assert.equal(descentM, 100);
});

test("denoising a real noisy SRTM profile cuts phantom climb substantially", () => {
  // Excerpt of the measured downtown-Houston profile, in metres.
  const srtm = [26.6, 26.9, 27.9, 29.6, 35, 35, 50, 50, 36, 17, 17, 37, 29, 9,
    9, 10.6, 14, 11, 11, 5.4, 17, 17, 17, 14.6, 13, 15, 14, 17, 17, 15];
  const raw = srtm.reduce((g, v, i) => (i && v > srtm[i - 1] ? g + v - srtm[i - 1] : g), 0);
  const { ascentM } = accumulate(smoothElevations(srtm), 3);
  assert.ok(ascentM < raw * 0.6, `expected big reduction, got ${ascentM} vs ${raw}`);
});

// ------------------------------------- terrain scoring must tolerate noise

test("a flat route with realistic DEM error still scores well for a flat race", () => {
  // 8.5 mi, 250 ft measured gain (~29 ft/mi) when the truth is nearer 13.
  assert.ok(raceFit(8.5, 250, "houston") >= 60);
});

test("terrain scoring is driven by ratio, not absolute difference", () => {
  // Both routes are ~2x their race's target ft/mi. Under the old absolute
  // Gaussian the flat race scored ~0 terrain and the mountain race scored
  // most of it; under a log ratio they land close together.
  const flat = raceFit(10, 10 * 26, "houston");        // 26 vs 13 ft/mi
  const mountain = raceFit(10, 10 * 136, "boulderthon"); // 136 vs 68 ft/mi
  assert.ok(Math.abs(flat - mountain) <= 8, `flat ${flat} vs mountain ${mountain}`);
  assert.ok(flat > 60 && mountain > 60);
});

test("a wildly wrong route still scores below a correct one", () => {
  assert.ok(raceFit(10, 130, "houston") > raceFit(10, 1360, "houston"));
});

// ------------------------------------------------------------ FIT encoding

// Minimal FIT reader: enough to prove the file we emit is well-formed without
// adding a dependency. Walks definition/data records the way a device would.
function readFit(buf) {
  const headerSize = buf.readUInt8(0);
  const dataSize = buf.readUInt32LE(4);
  const magic = buf.subarray(8, 12).toString("ascii");
  const fileCrc = buf.readUInt16LE(buf.length - 2);
  const defs = new Map();
  const counts = new Map();
  const fields = [];
  let p = headerSize;
  const end = headerSize + dataSize;
  while (p < end) {
    const h = buf.readUInt8(p++);
    const local = h & 0x0f;
    if (h & 0x40) {
      p += 2; // reserved + architecture
      const global = buf.readUInt16LE(p); p += 2;
      const n = buf.readUInt8(p++);
      const fs = [];
      for (let i = 0; i < n; i++) {
        fs.push({ num: buf.readUInt8(p), size: buf.readUInt8(p + 1), type: buf.readUInt8(p + 2) });
        p += 3;
      }
      defs.set(local, { global, fields: fs });
    } else {
      const d = defs.get(local);
      if (!d) throw new Error(`data record for undefined local type ${local}`);
      const rec = {};
      for (const f of d.fields) {
        if (f.type === 0x85) rec[f.num] = buf.readInt32LE(p);
        else if (f.type === 0x86 || f.type === 0x8c) rec[f.num] = buf.readUInt32LE(p);
        else if (f.type === 0x84) rec[f.num] = buf.readUInt16LE(p);
        else if (f.type === 0x07) rec[f.num] = buf.subarray(p, p + f.size).toString("utf8").replace(/\0.*$/, "");
        else rec[f.num] = buf.readUInt8(p);
        p += f.size;
      }
      counts.set(d.global, (counts.get(d.global) || 0) + 1);
      fields.push({ global: d.global, rec });
    }
  }
  return { headerSize, dataSize, magic, fileCrc, counts, fields, consumed: p };
}

const squareLoop = () => {
  const pts = [];
  for (let i = 0; i < 40; i++) pts.push([-95.3698 + i * 0.0002, 29.7604 + i * 0.0001, 12 + (i % 7)]);
  return pts;
};

test("FIT file has a valid header and magic", () => {
  const buf = encodeCourseFit({ name: "T", coordinates: squareLoop() });
  const f = readFit(buf);
  assert.equal(f.magic, ".FIT");
  assert.equal(f.headerSize, 14);
  assert.equal(f.headerSize + f.dataSize + 2, buf.length);
});

test("FIT header and file CRCs verify", () => {
  const buf = encodeCourseFit({ name: "T", coordinates: squareLoop() });
  assert.equal(crc16(buf.subarray(0, 12)), buf.readUInt16LE(12));
  assert.equal(crc16(buf.subarray(0, buf.length - 2)), buf.readUInt16LE(buf.length - 2));
});

test("FIT declares itself a course file with the right sport", () => {
  const buf = encodeCourseFit({ name: "Houston Loop", coordinates: squareLoop(), sport: "running" });
  const f = readFit(buf);
  const fileId = f.fields.find((x) => x.global === 0).rec;
  assert.equal(fileId[0], 6); // file type 6 = course
  const course = f.fields.find((x) => x.global === 31).rec;
  assert.equal(course[4], 1); // sport 1 = running
  assert.equal(course[5], "Houston Loop");
});

test("FIT record count matches the geometry and positions round-trip", () => {
  const pts = squareLoop();
  const buf = encodeCourseFit({ name: "T", coordinates: pts });
  const f = readFit(buf);
  assert.equal(f.counts.get(20), pts.length);
  const first = f.fields.find((x) => x.global === 20).rec;
  const lat = first[0] / (2147483648 / 180);
  const lng = first[1] / (2147483648 / 180);
  assert.ok(Math.abs(lat - pts[0][1]) < 1e-5, `lat ${lat}`);
  assert.ok(Math.abs(lng - pts[0][0]) < 1e-5, `lng ${lng}`);
});

test("FIT brackets the course with timer start and stop events", () => {
  const buf = encodeCourseFit({ name: "T", coordinates: squareLoop() });
  const f = readFit(buf);
  const events = f.fields.filter((x) => x.global === 21).map((x) => x.rec);
  assert.equal(events.length, 2);
  assert.equal(events[0][1], 0); // start
  assert.equal(events[1][1], 4); // stop_all
});

test("FIT downsamples very long routes instead of emitting thousands of points", () => {
  const long = [];
  for (let i = 0; i < 5000; i++) long.push([-95.37 + i * 0.00001, 29.76 + i * 0.00001, 10]);
  const f = readFit(encodeCourseFit({ name: "T", coordinates: long }));
  assert.ok(f.counts.get(20) <= 1000, `got ${f.counts.get(20)} records`);
});

test("encodeCourseFit refuses geometry it cannot make a course from", () => {
  assert.throws(() => encodeCourseFit({ name: "T", coordinates: [] }));
  assert.throws(() => encodeCourseFit({ name: "T", coordinates: [[0, 0, 0]] }));
});
