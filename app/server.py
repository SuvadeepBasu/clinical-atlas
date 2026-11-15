"""Clinical Atlas web app: serves the interface and the /api endpoints."""
import os, re, time, logging
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import db, agent

log = logging.getLogger("atlas")
app = FastAPI(title="Clinical Atlas")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.environ.get("REPORTS_VOLUME", "/Volumes/workspace/atlas/reports")
_cache = {"version": "unset", "data": None, "checked": 0.0}


@app.get("/api/health")
def health():
    return {"ok": True, "ai": bool(agent.ENDPOINT), "tracing": agent.TRACING, "genie": bool(agent.GENIE_SPACE)}


@app.get("/api/bootstrap")
def bootstrap():
    now = time.time()
    if _cache["data"] is None or now - _cache["checked"] > 60:   # look for a new refresh at most once a minute
        version = db.data_version()
        _cache["checked"] = now
        if _cache["data"] is None or version != _cache["version"]:
            _cache["data"] = db.bootstrap(version)
            _cache["version"] = version
    return _cache["data"]


class ChatIn(BaseModel):
    messages: list[dict]
    mode: str = "quick"


@app.post("/api/chat")
def chat(body: ChatIn):
    if not agent.ENDPOINT:
        raise HTTPException(503, "SERVING_ENDPOINT is not configured")
    try:
        return agent.run(body.messages[-12:], body.mode)
    except Exception as e:
        log.exception("chat failed")
        raise HTTPException(502, f"Health AI could not answer: {str(e)[:300]}")


@app.get("/api/report/{trial_id}")
def report(trial_id: str):
    tid = trial_id.upper()
    if not re.fullmatch(r"[A-Z]{3}-\d{3}", tid):
        raise HTTPException(400, "Not a trial ID")
    from databricks.sdk import WorkspaceClient
    try:
        data = WorkspaceClient().files.download(f"{REPORTS}/{tid}.pdf").contents.read()
    except Exception:
        raise HTTPException(404, f"No report for {tid} yet. Run the report notebook.")
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{tid}.pdf"'})


app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "static", "index.html"))
