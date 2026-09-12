// lib/fit.js — minimal FIT *course* file encoder.
//
// WHY: Garmin wearables load courses as FIT. GPX is only supported on the
// outdoor/handheld line, so a Forerunner can't take our GPX directly — but a
// Connect IQ app CAN download a FIT course over the air, and the system saves
// it into the device's course list automatically. That's the whole point of
// this file: it lets the watch app put a route on the watch with no Garmin
// Connect account linkage and no partner-program approval.
//
// This writes the smallest course file Garmin's navigation will accept:
//   file_id -> course -> lap -> event(start) -> record* -> event(stop_all)
//
// Reference: FIT Protocol 2.0. Little-endian throughout.

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z, in Unix seconds
const SEMI = 2147483648 / 180; // degrees -> semicircles (2^31 / 180)
const MAX_RECORDS = 1000; // watches are memory-limited; 1000 points is plenty

// Global message numbers
const MSG = { FILE_ID: 0, LAP: 19, RECORD: 20, EVENT: 21, COURSE: 31 };

// Base types (high bit set = endian-sensitive)
const T = {
  ENUM: 0x00,
  UINT8: 0x02,
  STRING: 0x07,
  UINT16: 0x84,
  SINT32: 0x85,
  UINT32: 0x86,
  UINT32Z: 0x8c,
};
const SIZE = { 0x00: 1, 0x02: 1, 0x84: 2, 0x85: 4, 0x86: 4, 0x8c: 4 };

// --- CRC ---------------------------------------------------------------------
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

export function crc16(buf, crc = 0) {
  for (const b of buf) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc & 0xffff;
}

// --- writer ------------------------------------------------------------------
class Writer {
  constructor() {
    this.chunks = [];
  }
  push(buf) {
    this.chunks.push(buf);
    return this;
  }
  u8(v) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    return this.push(b);
  }
  u16(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    return this.push(b);
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    return this.push(b);
  }
  i32(v) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    return this.push(b);
  }
  str(s, len) {
    const b = Buffer.alloc(len, 0);
    Buffer.from(String(s), "utf8").copy(b, 0, 0, Math.min(len - 1, Buffer.byteLength(s, "utf8")));
    return this.push(b);
  }
  get buffer() {
    return Buffer.concat(this.chunks);
  }
}

// A definition message: [0x40|local][reserved][arch][globalMsg][nFields][field...]
function defineMessage(w, local, global, fields) {
  w.u8(0x40 | local).u8(0).u8(0).u16(global).u8(fields.length);
  for (const f of fields) w.u8(f.num).u8(f.size ?? SIZE[f.type]).u8(f.type);
}

const toSemi = (deg) => Math.round(Number(deg) * SEMI);
const toFitTime = (unixSec) => Math.round(unixSec - FIT_EPOCH);
// altitude is stored as (metres + 500) * 5
const toAlt = (m) => Math.max(0, Math.round((Number(m || 0) + 500) * 5));

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Encode a course as a FIT file.
 *
 * @param {object}   o
 * @param {string}   o.name         course name shown on the device
 * @param {number[][]} o.coordinates [lng, lat, eleM] — the ORS geometry order
 * @param {string}   [o.sport]      "running" | "cycling" | "hiking"
 * @param {number}   [o.startTime]  Unix seconds; defaults to now
 * @param {number}   [o.speedMps]   assumed pace, only used to synthesise
 *                                  plausible timestamps (courses have no real
 *                                  clock, but records need increasing times)
 * @returns {Buffer}
 */
export function encodeCourseFit({
  name = "HoodaRoutes",
  coordinates = [],
  sport = "running",
  startTime = Math.floor(Date.now() / 1000),
  speedMps = 3.0,
} = {}) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("encodeCourseFit: need at least 2 coordinates");
  }

  // Downsample evenly, always keeping first and last point.
  let pts = coordinates;
  if (pts.length > MAX_RECORDS) {
    const step = (pts.length - 1) / (MAX_RECORDS - 1);
    pts = Array.from({ length: MAX_RECORDS }, (_, i) => coordinates[Math.round(i * step)]);
  }

  // Cumulative distance and synthesised timestamps.
  const dist = [0];
  for (let i = 1; i < pts.length; i++) dist[i] = dist[i - 1] + haversineM(pts[i - 1], pts[i]);
  const totalM = dist[dist.length - 1];
  const t0 = toFitTime(startTime);
  const timeAt = (i) => t0 + Math.round(dist[i] / speedMps);

  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = (Number(pts[i][2]) || 0) - (Number(pts[i - 1][2]) || 0);
    if (d > 0) ascentM += d;
    else descentM += -d;
  }

  const SPORTS = { running: 1, cycling: 2, hiking: 17, walking: 11 };
  const sportId = SPORTS[sport] ?? 1;
  const NAME_LEN = 24;

  const w = new Writer();

  // --- file_id (local 0) : type=course(6)
  defineMessage(w, 0, MSG.FILE_ID, [
    { num: 0, type: T.ENUM },      // type
    { num: 1, type: T.UINT16 },    // manufacturer
    { num: 2, type: T.UINT16 },    // product
    { num: 3, type: T.UINT32Z },   // serial_number
    { num: 4, type: T.UINT32 },    // time_created
  ]);
  w.u8(0).u8(6).u16(255).u16(0).u32(0).u32(t0); // manufacturer 255 = development

  // --- course (local 1)
  defineMessage(w, 1, MSG.COURSE, [
    { num: 4, type: T.ENUM },                        // sport
    { num: 5, type: T.STRING, size: NAME_LEN },      // name
  ]);
  w.u8(1).u8(sportId).str(name, NAME_LEN);

  // --- lap (local 2) : bounds + totals, so the device can preview the course
  defineMessage(w, 2, MSG.LAP, [
    { num: 253, type: T.UINT32 },  // timestamp
    { num: 2, type: T.UINT32 },    // start_time
    { num: 3, type: T.SINT32 },    // start_position_lat
    { num: 4, type: T.SINT32 },    // start_position_long
    { num: 5, type: T.SINT32 },    // end_position_lat
    { num: 6, type: T.SINT32 },    // end_position_long
    { num: 7, type: T.UINT32 },    // total_elapsed_time (ms)
    { num: 8, type: T.UINT32 },    // total_timer_time (ms)
    { num: 9, type: T.UINT32 },    // total_distance (cm)
    { num: 21, type: T.UINT16 },   // total_ascent (m)
    { num: 22, type: T.UINT16 },   // total_descent (m)
  ]);
  const last = pts.length - 1;
  const elapsedMs = Math.round((totalM / speedMps) * 1000);
  w.u8(2)
    .u32(timeAt(last))
    .u32(t0)
    .i32(toSemi(pts[0][1]))
    .i32(toSemi(pts[0][0]))
    .i32(toSemi(pts[last][1]))
    .i32(toSemi(pts[last][0]))
    .u32(elapsedMs)
    .u32(elapsedMs)
    .u32(Math.round(totalM * 100))
    .u16(Math.round(ascentM))
    .u16(Math.round(descentM));

  // --- event (local 3)
  defineMessage(w, 3, MSG.EVENT, [
    { num: 253, type: T.UINT32 },  // timestamp
    { num: 0, type: T.ENUM },      // event  (0 = timer)
    { num: 1, type: T.ENUM },      // event_type
    { num: 4, type: T.UINT8 },     // event_group
  ]);
  w.u8(3).u32(t0).u8(0).u8(0).u8(0); // timer / start

  // --- record (local 4)
  defineMessage(w, 4, MSG.RECORD, [
    { num: 253, type: T.UINT32 },  // timestamp
    { num: 0, type: T.SINT32 },    // position_lat
    { num: 1, type: T.SINT32 },    // position_long
    { num: 2, type: T.UINT16 },    // altitude
    { num: 5, type: T.UINT32 },    // distance (cm)
  ]);
  for (let i = 0; i < pts.length; i++) {
    w.u8(4)
      .u32(timeAt(i))
      .i32(toSemi(pts[i][1]))
      .i32(toSemi(pts[i][0]))
      .u16(toAlt(pts[i][2]))
      .u32(Math.round(dist[i] * 100));
  }

  // --- event: stop_all
  w.u8(3).u32(timeAt(last)).u8(0).u8(4).u8(0);

  const data = w.buffer;

  // Header: 14 bytes, with its own CRC over the first 12.
  const head = Buffer.alloc(14);
  head.writeUInt8(14, 0);
  head.writeUInt8(0x20, 1);        // protocol 2.0
  head.writeUInt16LE(2140, 2);     // profile 21.40
  head.writeUInt32LE(data.length, 4);
  head.write(".FIT", 8, "ascii");
  head.writeUInt16LE(crc16(head.subarray(0, 12)), 12);

  // File CRC covers the whole file: the 14-byte header plus every data record.
  const tail = Buffer.alloc(2);
  tail.writeUInt16LE(crc16(data, crc16(head)), 0);

  return Buffer.concat([head, data, tail]);
}
