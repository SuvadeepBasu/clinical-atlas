"""Health AI: a tool-calling agent. The model plans and writes; every number comes from the SQL functions."""
import os, json, re, contextlib
import db

SCHEMA = db.SCHEMA
ENDPOINT = os.environ.get("SERVING_ENDPOINT", "")
THOROUGH_ENDPOINT = os.environ.get("SERVING_ENDPOINT_THOROUGH") or ENDPOINT
GENIE_SPACE = os.environ.get("GENIE_SPACE_ID", "")
SYSTEMS = ["Nervous", "Cardiovascular", "Respiratory", "Digestive", "Hepatic", "Renal", "Musculoskeletal", "Endocrine"]

# ---------- tracing (optional: on when MLFLOW_EXPERIMENT_ID is set) ----------
try:
    import mlflow
    if os.environ.get("MLFLOW_EXPERIMENT_ID"):
        mlflow.set_tracking_uri("databricks")
        mlflow.set_experiment(experiment_id=os.environ["MLFLOW_EXPERIMENT_ID"])
        mlflow.openai.autolog()
        TRACING = True
    else:
        TRACING = False
except Exception:
    TRACING = False


def span(name, inputs):
    if TRACING:
        return mlflow.start_span(name=name, span_type="TOOL")
    return contextlib.nullcontext()


# ---------- tools ----------
def q(fn, *args):
    marks = ", ".join(f":a{i}" for i in range(len(args)))
    return db.query(f"SELECT * FROM {SCHEMA}.{fn}({marks})", {f"a{i}": a for i, a in enumerate(args)})


def tool_medicine_summary(a):
    s = q("medicine_summary", a["medicine"])
    if not s:
        return {"error": f"No medicine called {a['medicine']}"}
    return {"summary": s[0], "outcomes": q("medicine_outcomes", a["medicine"]), "top_adverse_events": q("safety_profile", a["medicine"])[:4]}


def tool_ask_genie(a):
    from databricks.sdk import WorkspaceClient
    w = WorkspaceClient()
    msg = w.genie.start_conversation_and_wait(GENIE_SPACE, a["question"])
    out = {"answer_text": [], "sql": None, "rows": []}
    for att in msg.attachments or []:
        if getattr(att, "text", None) and att.text.content:
            out["answer_text"].append(att.text.content)
        if getattr(att, "query", None) and att.query.query:
            out["sql"] = att.query.query
            out["rows"] = db.query(att.query.query)[:50]
    return out


TOOLS = {
    "medicine_summary": (tool_medicine_summary, "Overview of one medicine (name or code): trial counts, phases, every outcome with arm tallies and pooled placebo-controlled difference and 95% CI, and top adverse events.",
                         {"medicine": {"type": "string"}}, ["medicine"]),
    "pooled_effect": (lambda a: q("pooled_effect", a["medicine"], a["outcome"]), "Pooled placebo-controlled difference for one medicine and one outcome (outcome name or part of it).",
                      {"medicine": {"type": "string"}, "outcome": {"type": "string"}}, ["medicine", "outcome"]),
    "safety_profile": (lambda a: {"summary": (q("medicine_summary", a["medicine"]) or [{}])[0], "events": q("safety_profile", a["medicine"])},
                       "Adverse events for one medicine: % on medicine vs comparator per event, plus serious adverse event and discontinuation rates.",
                       {"medicine": {"type": "string"}}, ["medicine"]),
    "system_medicines": (lambda a: q("system_medicines", a["system"]), "Every medicine with outcomes in one body system, with pooled results per outcome.",
                         {"system": {"type": "string", "enum": SYSTEMS}}, ["system"]),
    "search_trials": (lambda a: q("search_trials", a.get("medicine", ""), a.get("system", ""), a.get("quality", "")),
                      "Find trials by medicine, body system and/or quality (High, Moderate, Low). Returns per-arm results for the primary outcome, or for outcomes in the requested system.",
                      {"medicine": {"type": "string"}, "system": {"type": "string", "enum": SYSTEMS}, "quality": {"type": "string", "enum": ["High", "Moderate", "Low"]}}, []),
    "trial_detail": (lambda a: q("trial_detail", a["trial_id"]), "Every arm and outcome result for one trial ID, e.g. GLD-212.",
                     {"trial_id": {"type": "string"}}, ["trial_id"]),
    "show_in_atlas": (None, "Point the app's 3D body map and evidence panel at a medicine and/or body system and optionally an outcome. Call once per answer about a medicine or system.",
                      {"drug": {"type": "string"}, "system": {"type": "string", "enum": SYSTEMS}, "outcome": {"type": "string"}}, []),
}
if GENIE_SPACE:
    TOOLS["ask_genie"] = (tool_ask_genie, "Ask the Genie space a question the other tools cannot answer (for example counts by country, sponsor or year). Returns Genie's SQL and rows.",
                          {"question": {"type": "string"}}, ["question"])

STEP_LABEL = {"medicine_summary": "Summarised {medicine}", "pooled_effect": "Pooled {outcome}", "safety_profile": "Read safety for {medicine}",
              "system_medicines": "Searched {system} system", "search_trials": "Searched trials", "trial_detail": "Read {trial_id}",
              "show_in_atlas": "Updated body map", "ask_genie": "Asked Genie"}

TOOL_SCHEMAS = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p, "required": r}}}
                for n, (_, d, p, r) in TOOLS.items()]

_catalogue = None


def system_prompt():
    global _catalogue
    if _catalogue is None:
        rows = db.query(f"SELECT medicine, code, drug_class, indication, body_systems FROM {SCHEMA}.medicines ORDER BY medicine")
        _catalogue = "\n".join(f"{r['medicine']} ({r['code']}) | {r['drug_class']} | {r['indication']} | systems: {r['body_systems'].replace('|', ', ')}" for r in rows)
    return f"""You are Health AI, the evidence assistant inside the Clinical Atlas web app. You answer questions about a SYNTHETIC clinical-trial database. Every medicine, trial, sponsor and result in it is fictional and exists only for this demo.

Medicines (name (code) | class | indication | body systems):
{_catalogue}

Body systems: {", ".join(SYSTEMS)}.

How to work:
- Get every number from the tools. Never estimate, recall or invent figures, trials or medicines. If the tools return nothing, say so.
- medicine_summary gives a full overview in one call; use the narrower tools for follow-ups.
- Whenever the answer is about a medicine or body system, call show_in_atlas once so the body map follows the conversation.
- Cite trials by ID in square brackets, e.g. [CLV-209]; the app turns them into links to the study report.
- Differences are versus comparator; lower_is_better says which direction is favourable. Say improved or worsened, with units and 95% CI where useful.
- Start with a one or two sentence direct answer, then a few bullets or a small markdown table. Under 220 words unless asked for more. Headings no larger than ###.
- If someone asks for personal medical advice, say this database is fictional and they should speak to a clinician, then answer about the data only."""


def _client():
    from databricks.sdk import WorkspaceClient
    return WorkspaceClient().serving_endpoints.get_open_ai_client()


def _run(messages, mode="quick", client=None):
    client = client or _client()
    model = THOROUGH_ENDPOINT if mode == "default" else ENDPOINT
    convo = [{"role": "system", "content": system_prompt()}] + [
        {"role": "assistant" if m["role"] in ("ai", "assistant") else "user", "content": m["content"]}
        for m in messages if m.get("content")]
    steps, ui = [], None
    for _ in range(8 if mode == "default" else 6):
        r = client.chat.completions.create(model=model, messages=convo, tools=TOOL_SCHEMAS, max_tokens=1800)
        m = r.choices[0].message
        if not m.tool_calls:
            return {"text": m.content or "", "steps": steps, "ui": ui}
        convo.append({"role": "assistant", "content": m.content or "",
                      "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments or "{}"}} for c in m.tool_calls]})
        for c in m.tool_calls:
            name = c.function.name
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            with span(name, args):
                try:
                    if name == "show_in_atlas":
                        ui = {k: args.get(k) for k in ("drug", "system", "outcome")}
                        out = "Displayed"
                    elif name in TOOLS:
                        out = TOOLS[name][0](args)
                    else:
                        out = {"error": f"Unknown tool {name}"}
                except Exception as e:
                    out = {"error": str(e)[:500]}
            label = STEP_LABEL.get(name, name)
            try:
                label = label.format(**{k: args.get(k, "") for k in ("medicine", "outcome", "system", "trial_id")})
            except Exception:
                pass
            if isinstance(out, list):
                label += f" · {len(out)} rows"
            steps.append(label)
            convo.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(out, default=str)[:24000]})
    return {"text": "I ran out of steps before finishing. Try a narrower question.", "steps": steps, "ui": ui}


run = mlflow.trace(name="health_ai", span_type="AGENT")(_run) if TRACING else _run
