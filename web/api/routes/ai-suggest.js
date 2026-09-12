// /api/routes/ai-suggest — event-driven AI "today's run" suggestion.
//
// Reasons over the athlete's recent Strava training with an LLM, returns a
// structured suggestion, and (when we know their usual start) generates the
// route too.
//
// NOT on a timer. It recomputes only when the answer can actually change:
//   - the calendar day rolls over, or
//   - a new run appears (runCount changes; the Strava webhook also busts cache).
// That's the event-driven design — no wasteful 5-minute polling.
import { sessionFromReq } from "../../lib/session.js";
import { getValidToken, recentRuns, analyzeTraining, suggestToday } from "../../lib/strava.js";
import { generateLoop } from "../../lib/ors.js";
import { aiSuggest } from "../../lib/aiCoach.js";
import { kvGet, kvSet } from "../../lib/store.js";
import { raceForRequest } from "../race.js";

export default async function handler(req, res) {
  try {
    const s = sessionFromReq(req);
    if (!s) return res.status(401).json({ error: "connect Strava first" });

    const athleteId = s.athleteId;
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `ai-suggest:${athleteId}`;
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    // Resolved before the cache check: switching goal races must invalidate a
    // cached suggestion, so the race id is part of the cache identity.
    const race = await raceForRequest(req, s);

    // Training data: reuse the cached profile (from /api/strava/profile) so we
    // don't spend extra Strava rate limit re-fetching activities.
    let profile = await kvGet(`profile:${athleteId}`);
    if (!profile) {
      const token = await getValidToken(athleteId);
      const runs = await recentRuns(token, 28);
      profile = { ...analyzeTraining(runs), suggestion: suggestToday(runs) };
    }
    const heuristic = profile.suggestion || suggestToday([]);

    // Event-driven cache: reuse unless day changed or a new run appeared.
    if (!force) {
      const cached = await kvGet(cacheKey);
      if (cached && cached.day === today && cached.runCount === profile.runCount && cached.raceId === race.id) {
        return res.status(200).json({ ...cached.payload, cached: true });
      }
    }

    const ai = await aiSuggest(profile, heuristic, race);

    // Generate the actual route from the athlete's usual start, if known.
    let route = null;
    if (profile.startLat && profile.startLng) {
      try {
        const g = await generateLoop({
          lat: profile.startLat,
          lng: profile.startLng,
          miles: ai.suggestedMiles,
          surface: ai.surface,
          seed: 7,
          race,
        });
        route = {
          lat: profile.startLat,
          lng: profile.startLng,
          distanceMi: g.distanceMi,
          ascentFt: g.ascentFt,
          surface: g.surface,
          fit: g.fit,
          race: g.race,
          seed: g.seed,
          profile: g.profile,
          latlngs: g.latlngs,
          coordinates: g.coordinates,
        };
      } catch (_) {
        /* route optional — the suggestion still returns without it */
      }
    }

    const payload = {
      suggestedMiles: ai.suggestedMiles,
      type: ai.type,
      surface: ai.surface,
      rationale: ai.rationale,
      coachingNotes: ai.coachingNotes,
      source: ai.source, // "ai" | "heuristic" — lets the UI show which fired
      basis: { weeklyAvg: profile.weeklyAvg, longestMi: profile.longestMi, weeks: profile.weeks },
      race: { id: race.id, name: race.name },
      route,
    };

    // Cache 12h; the day/runCount check above also forces a natural recompute.
    await kvSet(cacheKey, { day: today, runCount: profile.runCount, raceId: race.id, payload }, 12 * 3600);
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
