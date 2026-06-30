// /api/garmin/course  — regenerate the chosen loop and return it as a GPX
// course. The watch app calls this on START; the web app links to it too.
// Import the GPX into Garmin Connect -> Courses -> sync to the FR970.
import { generateLoop } from "../../lib/ors.js";
import { toGpx } from "../../lib/gpx.js";

export default async function handler(req, res) {
  try {
    const q = req.method === "POST" ? req.body || {} : req.query;
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
