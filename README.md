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
```
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

## Suggested setup order

1. Push this repo to a **new GitHub repo** (e.g. `yashhooda1/hoodaroutes`).
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
| `POST /api/routes/save` · `GET /api/routes/list` | route history (dashboard) |
| `POST /api/garmin/push` · `push-official` | create a Garmin course |
| `GET  /api/garmin/routes` · `course` | watch options / GPX |

## Secrets hygiene

Never commit: ORS key, Strava secret, `SESSION_SECRET`, Upstash token, the Garmin
token store. Use Vercel/Railway env + a `.gitignore` for `~/.garminconnect` and `.env`.
