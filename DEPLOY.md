# DEPLOY.md — HoodaRoutes first deploy (click-by-click)

Three targets: **web → Vercel**, **garmin-push → Railway**, **watch → sideload**.
Do them in this order. Budget ~45 min the first time.

---

## 0. Accounts & keys you'll need

- GitHub account
- Vercel account (free) — for `web/`
- Railway account (free trial / hobby) — for `garmin-push/`
- OpenRouteService key — https://openrouteservice.org/dev/#/signup
- Strava API application — https://www.strava.com/settings/api (you have this)
- Upstash Redis — you already run one (REST URL + token)

Generate three random secrets now (keep them somewhere safe):
```
openssl rand -hex 32      # SESSION_SECRET
openssl rand -hex 16      # STRAVA_VERIFY_TOKEN
openssl rand -hex 16      # ADMIN_TOKEN
```
(No openssl? In Node: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

---

## 1. Push to GitHub

From inside the unzipped `hoodaroutes/` folder:

**Option A — GitHub CLI (fastest):**
```
gh auth login
gh repo create yashhooda1/hoodaroutes --private --source=. --remote=origin --push
```

**Option B — plain git + github.com:**
1. Go to github.com → **New repository** → name `hoodaroutes` → Private → **Create**
   (don't add a README/.gitignore; this folder already has them).
2. In the folder:
```
git init
git add .
git commit -m "Initial commit: HoodaRoutes"
git branch -M main
git remote add origin https://github.com/yashhooda1/hoodaroutes.git
git push -u origin main
```

**Before you push, confirm no secrets are staged:**
```
git status                 # should NOT list .env, .garminconnect, garmin_tokens.json
git ls-files | grep -Ei "secret|token|\.env" || echo "clean"
```
(The included `.gitignore` already excludes these.)

---

## 2. Deploy `web/` → Vercel

1. vercel.com → **Add New… → Project** → import `yashhooda1/hoodaroutes`.
2. **Root Directory → `web`** (click Edit, pick the `web` folder). Framework: **Other**.
3. **Environment Variables** — add all of these:

   | Key | Value |
   |---|---|
   | `ORS_API_KEY` | your OpenRouteService key |
   | `STRAVA_CLIENT_ID` | from Strava API settings |
   | `STRAVA_CLIENT_SECRET` | from Strava API settings |
   | `APP_URL` | `https://hoodaroutes.vercel.app` (or your custom domain, no trailing slash) |
   | `SESSION_SECRET` | the 32-byte hex from step 0 |
   | `STRAVA_VERIFY_TOKEN` | the 16-byte hex from step 0 |
   | `ADMIN_TOKEN` | the 16-byte hex from step 0 |
   | `UPSTASH_REDIS_REST_URL` | your Upstash REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | your Upstash REST token |
   | `STRAVA_REFRESH_TOKEN` | (optional) only for your own watch "Today" |

4. **Deploy.** Note the live URL. If you set a custom domain (e.g. `routes.yashhooda.ai`),
   add it in Vercel → Settings → Domains, then **update `APP_URL`** to match and redeploy.

---

## 3. Set the Strava callback domain

Strava → Settings → **My API Application** → **Authorization Callback Domain** =
your host *without* scheme or path:
```
hoodaroutes.vercel.app        (or routes.yashhooda.ai)
```
Save. (This is the #1 cause of "redirect_uri invalid" — it must match `APP_URL`'s host.)

---

## 4. Deploy `garmin-push/` → Railway

**a. Create the token store locally (once):**
```
cd garmin-push
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r requirements.txt
python init_auth.py
```
It logs you in (handles MFA) and prints a line:
```
GARMIN_TOKENS_B64=H4sIA...        <- copy this whole value
```

**b. Deploy on Railway:**
1. railway.app → **New Project → Deploy from GitHub repo** → pick `hoodaroutes`.
2. Service **Settings → Root Directory → `garmin-push`** (it auto-detects the Dockerfile).
3. **Variables** → add `GARMIN_TOKENS_B64` (paste from step a) as a secret.
4. Deploy. Copy the public URL (e.g. `https://hoodaroutes-push.up.railway.app`).
5. Smoke test: open `<railway-url>/health` → `{"ok": true}`.

**c. Wire it to Vercel:** in Vercel env add
`GARMIN_PUSH_URL = https://hoodaroutes-push.up.railway.app` → redeploy `web`.

---

## 5. Register the Strava webhook (once, after web is live)

```
curl "https://<your-app-url>/api/strava/webhook-subscribe?token=<ADMIN_TOKEN>"
```
A `{ "id": ... }` response means it's subscribed. New activities now refresh
suggestions automatically.

---

## 6. Build + sideload the watch app

1. Open `watch-connectiq/` in VS Code (Connect IQ extension + SDK installed).
2. In `source/HoodaRoutesApp.mc` set `const BASE_URL = "https://<your-app-url>";`
3. `Monkey C: Build for Device → fr970` → copy `bin/HoodaRoutes.prg` to the watch's
   `GARMIN/Apps/` over USB. Keep the watch paired to the phone.

---

## 7. Smoke tests

```
# routing (needs ORS_API_KEY)
curl -X POST https://<app>/api/routes/generate \
  -H "Content-Type: application/json" \
  -d '{"lat":29.74,"lng":-95.37,"miles":6}'

# auth round-trip: open in a browser
https://<app>/                      # click "Connect Strava"
https://<app>/api/auth/me           # after connecting -> { connected: true }
https://<app>/dashboard             # your training + routes
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri invalid` on Connect Strava | Callback Domain (step 3) must equal `APP_URL` host |
| `/api/...` returns 500 "not connected" | user hasn't connected Strava, or Upstash env missing |
| ORS 403 / quota | wrong/exhausted `ORS_API_KEY` (2k/day free) |
| Garmin push 502 | run `init_auth.py` again; re-paste `GARMIN_TOKENS_B64`; check `/health` |
| Webhook never fires | re-run step 5; verify `STRAVA_VERIFY_TOKEN` matches Vercel env |
| Strava 429 | per-app rate limit (200/15min, 2000/day) — apply to Strava for more |

---

## Secrets hygiene (do not skip)

Never commit: `ORS_API_KEY`, `STRAVA_CLIENT_SECRET`, `SESSION_SECRET`,
`UPSTASH_REDIS_REST_TOKEN`, `GARMIN_TOKENS_B64`, the `.garminconnect/` folder.
All live in Vercel/Railway env. Rotate any value you ever paste into a chat or screenshot.
