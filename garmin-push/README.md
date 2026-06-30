# HoodaRoutes — Garmin Push Service

Creates a **Course** in your Garmin Connect account from a generated route, so the
FR970 can navigate it natively (turn-by-turn + off-route alerts). This is the
"START → it's on my watch automatically" piece.

## Why a separate Python service?

`python-garminconnect` (the maintained Garmin Connect library; `garth` is deprecated)
is Python, and your routing/web stack is Node. Keeping the Garmin auth in its own
small FastAPI service is the clean split — deploy it on **Railway** (you already use it),
and your Node `/api/garmin/push` forwards to it.

## Setup

1. **One-time local auth** (handles MFA, writes the token store):
   ```
   python -m venv .venv && .venv\Scripts\activate      # Windows
   pip install -r requirements.txt
   python init_auth.py
   ```
   This writes tokens to `~/.garminconnect`. They auto-refresh indefinitely; you only
   re-run this if the refresh token is revoked.

2. **Run locally**:
   ```
   uvicorn main:app --reload --port 8000
   curl -X POST localhost:8000/push-course -H "Content-Type: application/json" \
     -d '{"name":"Test 8mi","distanceM":12875,"ascentM":120,"geoPoints":[{"lat":29.74,"lng":-95.37,"ele":12}]}'
   ```

3. **Deploy on Railway**: push this folder; the Dockerfile uses `$PORT`. Provide the
   token store (commit-free): set `GARMINTOKENS` to a mounted path and add the two
   token files from step 1, **or** set `GARMIN_EMAIL` / `GARMIN_PASSWORD` env vars
   (works only if the account has no MFA). Token-store is the safer route.

## Endpoint

`POST /push-course`
```json
{ "name": "HoodaRoutes 8.1mi", "activityType": "RUNNING",
  "distanceM": 13036, "ascentM": 95, "descentM": 95,
  "geoPoints": [ {"lat":29.74,"lng":-95.37,"ele":12.0}, ... ] }
```
→ `{ "ok": true, "courseId": 12345678 }`

## ⚠️ The one thing to verify

`connect.garmin.com`'s web **course-service** isn't officially documented. The payload
in `main.py` matches Garmin's **published Courses-API schema** (which is the same shape),
and works for most accounts. If you get a 400/412, create a course in Garmin Connect
with Chrome DevTools open, capture the real POST, and match the field names.

## Production path (no reverse-engineering)

The sanctioned way is the **Garmin Connect Developer Program → Courses / Training API**
(apply at developer.garmin.com). It pushes courses straight to users' devices over
OAuth — required if HoodaRoutes ever serves users other than you. The course payload
this service builds is already in that program's schema, so the upgrade is mostly
swapping the transport (garth session → OAuth + partner endpoint).

## Security note

Treat the token store like a password. Don't commit it. On Railway, inject it via a
secret/volume, not the repo.
