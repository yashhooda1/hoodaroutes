# main.py — HoodaRoutes Garmin push service.
# Creates a Course in your Garmin Connect account from a route, so the FR970
# can navigate it natively. Auth uses python-garminconnect (maintained; handles
# Garmin's mobile SSO + MFA + token refresh).
#
# Run init_auth.py ONCE locally to create the token store (handles MFA), then
# deploy the token files with the service. The server resumes without MFA.

import os
import io
import base64
import tarfile
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from garminconnect import Garmin

app = FastAPI(title="HoodaRoutes Garmin Push")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

TOKENSTORE = os.environ.get("GARMINTOKENS", os.path.expanduser("~/.garminconnect"))
_client: Optional[Garmin] = None


def _restore_tokens() -> None:
    """Env-only deploy (Railway): if GARMIN_TOKENS_B64 is set (printed by
    init_auth.py), unpack the token store from it. No volume needed."""
    blob = os.environ.get("GARMIN_TOKENS_B64")
    if not blob or os.path.exists(os.path.join(TOKENSTORE, "oauth2_token.json")):
        return
    os.makedirs(TOKENSTORE, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(blob)), mode="r:gz") as tar:
        tar.extractall(TOKENSTORE)


def client() -> Garmin:
    """Lazily auth and cache the Garmin client. Resumes from the token store."""
    global _client
    if _client is not None:
        return _client
    _restore_tokens()
    g = Garmin(
        email=os.environ.get("GARMIN_EMAIL"),
        password=os.environ.get("GARMIN_PASSWORD"),
    )
    # Resume from saved tokens (created by init_auth.py). Falls back to a fresh
    # credential login only if the refresh token is gone — that path may need MFA.
    g.login(TOKENSTORE)
    _client = g
    return g


class GeoPoint(BaseModel):
    lat: float
    lng: float
    ele: Optional[float] = 0.0


class CourseReq(BaseModel):
    name: str
    activityType: str = "RUNNING"  # Garmin enum, e.g. RUNNING, TRAIL_RUNNING
    distanceM: float
    ascentM: float = 0.0
    descentM: float = 0.0
    geoPoints: List[GeoPoint]


@app.get("/health")
def health():
    return {"ok": True}


# Garmin activityTypePk values (from the consumer course-service). Running is 1;
# we default trail running to running too, since an unknown pk can 400 and the
# value only affects the course's icon/category, not navigation.
ACTIVITY_PK = {"RUNNING": 1, "TRAIL_RUNNING": 1}

# Course privacy (rulePK): 1 = Public, 2 = Private, 4 = Group. Personal generated
# routes default to Private.
PRIVACY_PRIVATE = 2


@app.post("/push-course")
def push_course(req: CourseReq):
    g = client()

    # Resolve the authenticated session (garth on most versions, client on others).
    sess = getattr(g, "garth", None) or getattr(g, "client", None)
    if sess is None:
        raise HTTPException(status_code=502, detail="No auth session (garth/client) found on this version")

    # Best-effort: fetch the owner's Garmin profile id. Optional — the server also
    # derives ownership from auth — so failure here is non-fatal.
    user_pk = None
    try:
        pr = sess.get("connectapi", "/userprofile-service/socialProfile", api=True)
        pj = pr.json() if hasattr(pr, "json") else {}
        user_pk = pj.get("profileId") or pj.get("userProfilePk") or pj.get("id")
    except Exception:
        user_pk = None

    pts = [
        {
            "latitude": float(p.lat),
            "longitude": float(p.lng),
            "elevation": float(p.ele or 0.0),
            "timestamp": None,
        }
        for p in req.geoPoints
    ]

    # Payload mirrors the request Garmin Connect's own course builder sends to
    # POST /course-service/course (captured from the live UI). Key fields the
    # service validates: rulePK (privacy), activityTypePk, sourceTypeId, and the
    # *Meter field names (NOT "distance"/"elevationGain").
    payload = {
        "courseName": req.name,
        "activityTypePk": ACTIVITY_PK.get(req.activityType, 1),
        "coordinateSystem": "WGS84",
        "sourceTypeId": 3,            # manually created course
        "rulePK": PRIVACY_PRIVATE,    # 1=Public, 2=Private, 4=Group
        "distanceMeter": float(req.distanceM),
        "elevationGainMeter": float(req.ascentM),
        "elevationLossMeter": float(req.descentM),
        "openStreetMap": False,
        "hasTurnDetectionDisabled": False,
        "coursePoints": [],
        "geoPoints": pts,
        "startPoint": pts[0] if pts else None,
    }
    if user_pk:
        payload["userProfilePk"] = user_pk

    try:
        resp = sess.post("connectapi", "/course-service/course", json=payload, api=True)
        data = resp.json() if hasattr(resp, "json") else resp
        course_id = data.get("courseId") if isinstance(data, dict) else None
        return {"ok": True, "courseId": course_id}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Garmin course push failed: {e}")
