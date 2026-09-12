// /api/garmin/course  — regenerate the chosen loop and return it as a course
// file, in either format:
//
//   ?format=gpx  (default)  for Garmin Connect import / handheld devices
//   ?format=fit             for the Connect IQ app to pull over the air
//
// The FIT path is what makes "send to my watch" work for anyone: Connect IQ
// can download a FIT course and the system files it into the device's course
// list directly, so no Garmin account linkage and no partner approval.
import { generateLoop } from "../../lib/ors.js";
import { toGpx } from "../../lib/gpx.js";
import { encodeCourseFit } from "../../lib/fit.js";
import { enforce } from "../../lib/ratelimit.js";

export default async function handler(req, res) {
  if (await enforce(req, res, { bucket: "course", limit: 60, windowSec: 3600 })) return;
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
    const format = String(q.format || "gpx").toLowerCase();
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    const miles = parseFloat(q.miles || q.reqMiles || "8");
    const profile = q.profile || "foot-walking";
    const seed = parseInt(q.seed || "1", 10);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const route = await generateLoop({ lat, lng, miles, profile, seed });
    const name = `HoodaRoutes ${route.distanceMi}mi`;

    if (format === "fit") {
      const fit = encodeCourseFit({
        name,
        coordinates: route.coordinates,
        sport: profile === "foot-hiking" ? "hiking" : "running",
      });
      // Garmin's own MIME type for FIT; Connect IQ accepts it with
      // :responseType => HTTP_RESPONSE_CONTENT_TYPE_FIT.
      res.setHeader("Content-Type", "application/vnd.ant.fit");
      res.setHeader("Content-Length", String(fit.length));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="hoodaroutes-${route.distanceMi}mi.fit"`
      );
      return res.status(200).send(fit);
    }

    const gpx = toGpx({ name, coordinates: route.coordinates });

    res.setHeader("Content-Type", "application/gpx+xml");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hoodaroutes-${route.distanceMi}mi.gpx"`
    );
    res.status(200).send(gpx);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
