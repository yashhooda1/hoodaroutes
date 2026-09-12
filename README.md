# HoodaRoutes

Worldwide running-route generation, personalized to each runner's Strava training,
with a Garmin Forerunner companion. **One repo, three deploy targets** — keep them
separate because they have three different runtimes.

```
hoodaroutes/
├─ web/               → Vercel    (static site + Node serverless API + Strava OAuth)
├─ garmin-push/       → Railway   (Python FastAPI: pushes courses to Garmin Connect)
└─ watch-connectiq/   → sideload  (Garmin Connect IQ app — built locally, not hosted)
```

## Where each part goes (and why)

### `web/` → **Vercel** (its own project, ideally `routes.yashhooda.ai`)
Static `index.html` + `dashboard.html` and the whole `api/` (ES-module serverless
functions) + `lib/`. This is the product: route generation, Strava login, per-user
training analysis, the dashboard.

**Recommendation: deploy this as its OWN Vercel project on a subdomain, not folded
into the yashhooda.ai repo.** It's now a multi-user app with its own auth, user
tokens, rate limits, and a Strava webhook — keep that security surface isolated from
your personal site. Link to it from yashhooda.ai as a project. (It reuses your Upstash;
just use a separate prefix or database.)

Env (Vercel):
```
ORS_API_KEY               OpenRouteService key (routing)
STRAVA_CLIENT_ID          Strava API app
STRAVA_CLIENT_SECRET
APP_URL                   e.g. https://routes.yashhooda.ai  (no trailing slash)
SESSION_SECRET            long random string
STRAVA_VERIFY_TOKEN       any random string (webhook handshake)
ADMIN_TOKEN               protects /api/strava/webhook-subscribe
UPSTASH_REDIS_REST_URL    your Upstash REST URL
UPSTASH_REDIS_REST_TOKEN
GARMIN_PUSH_URL           the Railway push service base URL (optional)
STRAVA_REFRESH_TOKEN      only for YOUR watch's "Today" option (single-user)
ANTHROPIC_API_KEY         optional — enables the AI coach + /api/routes/interpret
AI_MODEL                  optional — defaults to claude-sonnet-4-6
```

Only `ORS_API_KEY` is load-bearing. Without `UPSTASH_*` the app falls back to an
in-process store (fine for `vercel dev`, useless in production — it logs a warning
saying so). Without `ANTHROPIC_API_KEY` every AI path degrades to a deterministic
heuristic instead of erroring.
In your Strava API app set **Authorization Callback Domain** = `APP_URL` host.
After deploy, register the webhook once:
`GET /api/strava/webhook-subscribe?token=$ADMIN_TOKEN`

### `garmin-push/` → **Railway** (its own service)
Python + `python-garminconnect`. Holds Garmin credentials/tokens, so it lives apart
from everything else for security. Dockerfile uses `$PORT` (your Railway pattern).
Run `init_auth.py` locally once (MFA), deploy with the token store. See its README.
Point `GARMIN_PUSH_URL` (in Vercel) at this service.

> This is the **unofficial** single-account push (yours). For multi-user Garmin you'd
> use the official Courses API path in `web/lib/garmin-official.js` — gated behind
> Garmin partner approval (currently paused for new sign-ups).

### `watch-connectiq/` → **not hosted**
Built with the Connect IQ SDK + VS Code and sideloaded to your FR970 (or published to
the Connect IQ store). Set `BASE_URL` in `source/HoodaRoutesApp.mc` to your `web/`
deployment. See `watch-connectiq` files and the build steps you already have.

## Goal race

The route **fit** score, the AI coach prompt and the natural-language parser are
all driven by the athlete's selected goal race (`web/lib/race.js`), not by a race
fixed at build time — a score that rewards climbing is right for a mountain
marathon and wrong for a flat one. Pick a race in the sidebar; connected athletes
get the choice persisted server-side (`/api/race`), anonymous visitors keep it in
`localStorage`. Add a race by adding an entry to `RACES`.

## Tests

```
cd web && npm test          # node --test — no network, no keys, no Redis
```

Covers the pure logic: race scoring, OSM surface classification, and the Strava
training analysis. CI runs it on Node 20 and 22 alongside a credential scan.

## Setup order

1. Clone the repo.
2. Vercel → New Project → import the repo → **Root Directory = `web`** → add env → deploy.
3. Railway → New Project → deploy from repo → **Root Directory = `garmin-push`** → set
   Garmin env / token store. Copy its URL into Vercel's `GARMIN_PUSH_URL`.
4. Register the Strava webhook (URL above), then open `routes.yashhooda.ai`.
5. Build the watch app locally, point `BASE_URL` at the Vercel URL, sideload.

## API surface (web)

| Route | Purpose |
|---|---|
| `GET  /api/auth/strava/login` / `callback` | Login with Strava (OAuth 2.0) |
| `GET  /api/auth/me` · `POST /api/auth/logout` | session / disconnect |
| `GET  /api/strava/profile` · `suggest` | training analysis + today's run |
| `POST /api/strava/webhook` · `webhook-subscribe` | live updates on new activities |
| `GET  /api/routes/for-me` | loop sized to the user's training |
| `POST /api/routes/generate` | loop from any lat/lng + distance |
| `GET  /api/routes/ai-suggest` | AI coach's run for today (cached) |
| `POST /api/routes/interpret` | plain English -> route params |
| `GET  /api/race` · `POST /api/race` | read / set the goal race |
| `POST /api/routes/save` · `GET /api/routes/list` | route history (dashboard) |
| `POST /api/garmin/push` · `push-official` | create a Garmin course |
| `GET  /api/garmin/routes` · `course` | watch options / GPX |

`/api/routes/generate` and `/api/routes/interpret` are intentionally
unauthenticated (drop a pin, get a loop) and therefore IP rate limited — 60
generations and 20 interpretations per hour, enforced through the same Upstash.

## Secrets hygiene

No API key is ever sent to the browser: route generation, Strava, Garmin and
every LLM call go through `web/api/*`. Never commit: ORS key, Strava secret,
`ANTHROPIC_API_KEY`, `SESSION_SECRET`, Upstash token, the Garmin token store. Use Vercel/Railway env + a `.gitignore` for `~/.garminconnect` and `.env`.
