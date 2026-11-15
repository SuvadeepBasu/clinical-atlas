"""SQL access for the app: runs queries on the SQL warehouse as the app's service principal."""
import os, threading
from databricks import sql
from databricks.sdk.core import Config

SCHEMA = os.environ.get("ATLAS_SCHEMA", "workspace.atlas")
_lock = threading.Lock()
_cfg = None
_conn = None


def _connect():
    global _cfg, _conn
    _cfg = _cfg or Config()          # picks up the app's credentials automatically
    warehouse = os.environ["DATABRICKS_WAREHOUSE_ID"]
    _conn = sql.connect(
        server_hostname=_cfg.host.replace("https://", "").rstrip("/"),
        http_path=f"/sql/1.0/warehouses/{warehouse}",
        credentials_provider=lambda: _cfg.authenticate,
    )


def query(statement, params=None):
    """Run one SQL statement and return a list of dicts. Reconnects once if the connection dropped."""
    global _conn
    for attempt in (1, 2):
        try:
            with _lock:
                if _conn is None:
                    _connect()
                conn = _conn
            with conn.cursor() as cur:
                cur.execute(statement, params or {})
                cols = [d[0] for d in cur.description] if cur.description else []
                return [dict(zip(cols, row)) for row in cur.fetchall()]
        except Exception:
            _conn = None
            if attempt == 2:
                raise


def data_version():
    rows = query(f"SELECT CAST(MAX(refreshed_at) AS STRING) AS v FROM {SCHEMA}.refresh_log")
    return rows[0]["v"] if rows else None


def bootstrap(version=None):
    """Everything the interface needs to draw the body map, charts and tables, in one JSON document."""
    S = SCHEMA
    meds = query(f"SELECT * FROM {S}.medicines ORDER BY medicine")
    outs = query(f"SELECT * FROM {S}.outcomes")
    trials = query(f"SELECT * FROM {S}.trials ORDER BY trial_id")
    arms = query(f"SELECT * FROM {S}.arms ORDER BY trial_id, arm_id")
    res = query(f"SELECT * FROM {S}.results")
    aes = query(f"SELECT * FROM {S}.adverse_events")

    code = {m["medicine"]: m["code"] for m in meds}
    outcome_meta = {o["outcome"]: {"sys": o["body_system"], "unit": o["unit"], "better": -1 if o["lower_is_better"] else 1} for o in outs}
    res_by_arm, ae_by_arm, arms_by_trial = {}, {}, {}
    for r in res:
        meta = outcome_meta.get(r["outcome"], {})
        res_by_arm.setdefault(r["arm_id"], []).append({
            "o": r["outcome"], "sys": r["body_system"], "unit": r["unit"], "better": meta.get("better", -1),
            "md": float(r["mean_difference"]), "lo": float(r["ci_low"]), "hi": float(r["ci_high"]),
            "p": float(r["p_value"]), "dir": r["result"], "prim": bool(r["is_primary"])})
    for e in aes:
        ae_by_arm.setdefault(e["arm_id"], []).append({"ae": e["event"], "drug": float(e["drug_pct"]), "pbo": float(e["comparator_pct"])})
    for a in arms:
        arms_by_trial.setdefault(a["trial_id"], []).append({
            "dose": a["dose"], "n": int(a["n"]), "results": res_by_arm.get(a["arm_id"], []), "aes": ae_by_arm.get(a["arm_id"], []),
            "sae": float(a["serious_ae_pct"] or 0), "disc": float(a["discontinuation_pct"] or 0)})
    out_trials = []
    for t in trials:
        t_arms = [a for a in arms_by_trial.get(t["trial_id"], []) if a["results"]]
        if not t_arms:
            continue
        authors = [s.strip() for s in (t["authors"] or "").split(";") if s.strip()]
        out_trials.append({
            "id": t["trial_id"], "reg": t["registry_id"], "drug": t["medicine"], "code": code.get(t["medicine"], ""),
            "phase": t["phase"], "year": int(t["year"] or 0), "design": t["design"], "comparator": t["comparator"],
            "duration": t["duration"], "pop": t["population"], "n": int(t["participants"] or 0),
            "countries": (t["countries"] or "").split("|"), "sponsor": t["sponsor"], "authors": authors or ["Unknown"],
            "lead": authors[0].split(". ")[-1] if authors else "", "quality": t["quality"], "title": t["title"],
            "journal": t["journal"], "arms": t_arms})
    drugs = [{"name": m["medicine"], "code": m["code"], "cls": m["drug_class"], "ind": m["indication"],
              "systems": (m["body_systems"] or "").split("|"), "sponsor": m["sponsor"], "doses": (m["doses"] or "").split("|")}
             for m in meds]
    return {"drugs": drugs, "outcomes": outcome_meta, "trials": out_trials, "meta": {"version": version}}
