// /api/routes/interpret — natural language -> route-generation parameters.
//
// This used to run in the browser, calling api.anthropic.com directly with no
// credentials. That only works inside an in-chat artifact sandbox; on a real
// deployment it 401s and the whole "Interpret + generate" feature silently
// fails. The key belongs on the server, so the call does too.
//
// POST { q, race? } -> { miles, profile, seed, structure[], coachingNotes,
//                        fluidStrategy, source: "ai" | "fallback" }
//
// Same golden rule as lib/aiCoach.js: an AI failure degrades to a usable
// answer, it never returns an error to the UI.
import { AI_MODEL } from "../../lib/aiCoach.js";
import { racePromptLine, resolveRace } from "../../lib/race.js";
import { enforce } from "../../lib/ratelimit.js";

const clampMiles = (n, d = 8) => Math.max(1, Math.min(26, Math.round(Number(n) || d)));

// Keyword fallback for when there's no API key, the model errors, or the JSON
// doesn't parse. Crude, but it always produces something generatable.
function fallbackParse(q, goal) {
  const text = String(q || "").toLowerCase();
  const num = text.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles|k\b)?/);
  let miles = num ? Number(num[1]) : 8;
  if (/\bk\b|kilomet/.test(text) && num) miles = miles * 0.621371;
  if (/long/.test(text) && !num) miles = goal.longRunMi;
  if (/recovery|shakeout|easy/.test(text) && !num) miles = 5;
  const trail = /trail|dirt|singletrack|woods|park|hill/.test(text);
  return {
    miles: clampMiles(miles),
    profile: trail ? "foot-hiking" : "foot-walking",
    seed: Math.floor(Math.random() * 9999) + 1,
    structure: [],
    coachingNotes: "",
    fluidStrategy: "",
    source: "fallback",
  };
}

export default async function handler(req, res) {
  if (await enforce(req, res, { bucket: "interpret", limit: 20, windowSec: 3600 })) return;

  const body = req.method === "POST" ? req.body || {} : req.query;
  const q = String(body.q || "").slice(0, 500);
  const goal = resolveRace(body.race);

  if (!q.trim()) return res.status(400).json({ error: "q is required" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json(fallbackParse(q, goal));

  const sys = `You turn a runner's request into route-generation parameters for HoodaRoutes. Their goal race is: ${racePromptLine(goal)}
Return ONLY JSON, no markdown:
{"miles":<1-26>,"profile":"foot-walking"|"foot-hiking","seed":<1-9999>,"structure":[{"miles":<n>,"segment":"<text>","effort":"<EASY|STEADY|TEMPO|MP|HILLS|COOLDOWN>"}],"coachingNotes":"<1-2 sentences>","fluidStrategy":"<short note>"}
Use foot-hiking for trail/hill requests, foot-walking for road/pavement. Sum of structure miles ~= miles. Keep coaching specific to the goal race above.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1000,
        system: sys,
        messages: [{ role: "user", content: q }],
      }),
    });
    if (!r.ok) throw new Error(`AI ${r.status}`);
    const data = await r.json();
    // Claude 5 / extended-thinking models put a thinking block first, so filter
    // on type rather than reading content[0].
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();
    const p = JSON.parse(text);

    // Validate every field — never hand raw model output to the route engine.
    const structure = Array.isArray(p.structure)
      ? p.structure.slice(0, 12).map((s) => ({
          miles: Math.max(0, Math.min(26, Number(s.miles) || 0)),
          segment: String(s.segment || "").slice(0, 120),
          effort: String(s.effort || "EASY").slice(0, 16).toUpperCase(),
        }))
      : [];

    res.status(200).json({
      miles: clampMiles(p.miles),
      profile: p.profile === "foot-hiking" ? "foot-hiking" : "foot-walking",
      seed: Math.max(1, Math.min(9999, Math.round(Number(p.seed) || Math.floor(Math.random() * 9999) + 1))),
      structure,
      coachingNotes: String(p.coachingNotes || "").slice(0, 400),
      fluidStrategy: String(p.fluidStrategy || "").slice(0, 200),
      source: "ai",
    });
  } catch (_) {
    res.status(200).json(fallbackParse(q, goal));
  }
}
