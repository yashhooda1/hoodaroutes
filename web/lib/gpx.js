// lib/gpx.js — build a Garmin-importable GPX course from route geometry.
// Garmin Connect imports a GPX <trk> as a Course (then syncs to the FR970
// for native turn-by-turn navigation with off-route alerts).

export function toGpx({ name, coordinates }) {
  // coordinates: [lng, lat, ele]
  const pts = coordinates
    .map((c) => {
      const ele = c[2] != null ? `<ele>${(+c[2]).toFixed(1)}</ele>` : "";
      return `      <trkpt lat="${(+c[1]).toFixed(6)}" lon="${(+c[0]).toFixed(6)}">${ele}</trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="HoodaRoutes" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

function esc(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
  );
}
