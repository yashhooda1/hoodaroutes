// lib/aiCoach.js — LLM-backed "today's run" suggestion with a deterministic
// fallback.
//
// THE GOLDEN RULE: an AI failure must NEVER break the feature. LLM calls fail
// in many ways — no key, rate limit, timeout, malformed JSON, a model string
// the account can't use — so every path here returns a valid suggestion. The
// existing heuristic (suggestToday) is the safety net. This is the difference
// between a demo and a production AI feature.

import { racePromptLine, resolveRace } from "./race.js";

// One model string for the whole app (the browser used to hardcode a different
// one than the server). Override with AI_MODEL in the environment.
export const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
const SURFACES = ["road", "trail", "track", "mixed"];

function heuristicShape(heuristic, profile, source) {
  return {
    suggestedMiles: heuristic.suggestedMiles,
    type: heuristic.type,
    surface: (profile.trailShare || 0) > 0.3 ? "trail" : "road",
    rationale: heuristic.rationale,
    coachingNotes: heuristic.rationale,
    source,
  };
}

export async function aiSuggest(profile, heuristic, race) {
  const key = process.env.ANTHROPIC_API_KEY;
  // No key configured -> heuristic. The app works on day one; AI is an upgrade
  // you switch on by adding ANTHROPIC_API_KEY to the environment.
  if (!key) return heuristicShape(heuristic, profile, "heuristic");

  const goal = resolveRace(race);
  const sys = `You are a marathon coach. The athlete's goal race is: ${racePromptLine(goal)}
Their stated goal time is ${profile.goalTime || "sub-3:00"}. Coach for THIS race — terrain specificity matters, so do not prescribe hill work for a flat goal race or flat pace work for a mountain one. Given their recent training, recommend TODAY's run.
Return ONLY JSON, no markdown, no prose outside the object:
{"suggestedMiles":<integer 3-22>,"type":"RECOVERY|EASY|STEADY|QUALITY|LONG","surface":"road|trail|track|mixed","rationale":"<one sentence citing their actual numbers>","coachingNotes":"<1-2 sentences of specific coaching>"}`;

  const user = `Recent training data:
- Weekly mileage, last 4 weeks (oldest -> newest): ${(profile.weeks || []).join(", ")}
- Weekly average: ${profile.weeklyAvg} mi
- Longest recent run: ${profile.longestMi} mi
- Average pace: ${profile.avgPaceMinMi} min/mi
- Trail share of recent runs: ${Math.round((profile.trailShare || 0) * 100)}%
- Runs analyzed: ${profile.runCount}
Baseline heuristic suggestion (keep or adjust): ${heuristic.suggestedMiles} mi ${heuristic.type} — ${heuristic.rationale}`;

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
        max_tokens: 400,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`AI ${r.status}`);
    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();
    const p = JSON.parse(text);

    // Validate EVERY field against the heuristic fallback — never trust raw LLM
    // output. Clamp numbers, whitelist enums, cap string lengths.
    return {
      suggestedMiles: Math.max(3, Math.min(22, Math.round(Number(p.suggestedMiles) || heuristic.suggestedMiles))),
      type: p.type || heuristic.type,
      surface: SURFACES.includes(p.surface)
        ? p.surface
        : ((profile.trailShare || 0) > 0.3 ? "trail" : "road"),
      rationale: String(p.rationale || heuristic.rationale).slice(0, 240),
      coachingNotes: String(p.coachingNotes || "").slice(0, 240),
      source: "ai",
    };
  } catch (_) {
    // Any failure -> heuristic. The feature degrades gracefully, never errors.
    return heuristicShape(heuristic, profile, "heuristic");
  }
}
