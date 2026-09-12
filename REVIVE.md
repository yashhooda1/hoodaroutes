# HoodaRoutes — revive checklist

Apply the patch first:

```bash
cd hoodaroutes
git checkout -b revive
git apply /path/to/hoodaroutes-revive.patch
cd web && npm test        # 17 passing, no network/keys/Redis needed
git add -A && git commit -m "Revive: server-side AI, configurable goal race, rate limiting, CI"
git push -u origin revive
```

## 1. Vercel project

`routes.yashhooda.ai` currently 404s — the project is gone or unlinked.

- New Project → import `yashhooda1/hoodaroutes` → **Root Directory = `web`**
- Framework preset: **Other** (no build step; it's static + ES-module functions)
- Node version: 20.x or 22.x
- Domain: add `routes.yashhooda.ai`, point the CNAME at Vercel

## 2. Environment variables

| Var | Required | Notes |
|---|---|---|
| `ORS_API_KEY` | **yes** | the only load-bearing one |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | for login | scope `activity:read_all` |
| `APP_URL` | for login | `https://routes.yashhooda.ai`, no trailing slash |
| `SESSION_SECRET` | for login | `openssl rand -base64 48` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | for login | separate DB or key prefix from your other apps |
| `STRAVA_VERIFY_TOKEN` / `ADMIN_TOKEN` | for webhook | any long random strings |
| `ANTHROPIC_API_KEY` | optional | without it, AI paths fall back to heuristics |
| `AI_MODEL` | optional | defaults to `claude-sonnet-4-6` |
| `GARMIN_PUSH_URL` | optional | the Railway service base URL |
| `STRAVA_REFRESH_TOKEN` | optional | your own watch's "Today" option only |

In the Strava API app, set **Authorization Callback Domain** to the `APP_URL`
host.

## 3. Post-deploy

```bash
# register the webhook once
curl "https://routes.yashhooda.ai/api/strava/webhook-subscribe?token=$ADMIN_TOKEN"

# smoke tests
curl -s "https://routes.yashhooda.ai/api/race" | jq .
curl -s -XPOST "https://routes.yashhooda.ai/api/routes/generate" \
  -H 'content-type: application/json' \
  -d '{"lat":29.7604,"lng":-95.3698,"miles":8,"seed":3}' | jq '.distanceMi,.ascentFt,.fit,.race'
curl -s -XPOST "https://routes.yashhooda.ai/api/routes/interpret" \
  -H 'content-type: application/json' -d '{"q":"easy 6 miles"}' | jq .
```

The generate call should return `fit` and `race`. If `interpret` returns
`"source":"fallback"`, `ANTHROPIC_API_KEY` isn't set or the model string is
wrong — the feature still works, just without the model.

## 4. Railway (only if you want Send-to-Garmin)

Unchanged by this patch. Root Directory = `garmin-push`, run `init_auth.py`
locally once for MFA, deploy with the token store, then set `GARMIN_PUSH_URL`
in Vercel.

## 5. Watch app

`watch-connectiq` now reads `fit` instead of `boulderFit`. The API still emits
`boulderFit` as a deprecated alias, so an old sideloaded build keeps working —
but rebuild and re-sideload when convenient, then delete the alias in
`web/api/garmin/routes.js`.

## Not done (deliberately)

- **Official Garmin Courses API** (`web/lib/garmin-official.js`) is still gated
  behind partner approval. Unchanged.
- **`state.key` / `state.pushUrl`** in `index.html` are dead client-side
  override fields left over from the single-user era. Harmless, but they could
  be deleted along with the key panel.
- **`dashboard.html`** still renders `r.fit` from saved history, which now
  carries a `race` id per entry. A "scored for: X" column would be a small win.
