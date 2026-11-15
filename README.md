# Clinical Atlas on Databricks Free Edition

A conversational evidence app over a **synthetic** clinical-trial database, built end to end on Databricks:

```
CSV drop ─► Volume landing/ ─► Lakeflow Job (file-arrival trigger)
                                 1 pipeline   bronze → silver (expectations) → gold   [atlas_stage]
                                 2 functions  on atlas_stage
                                 3 evaluate   quality gate, logged to MLflow   (fail = stop, live data untouched)
                                 4 promote    atlas_stage → atlas, refresh_log
                                 5 functions  on atlas
                                 6 reports    one PDF per trial → Volume reports/
                               ─► Genie space + Databricks App (React UI, FastAPI, Health AI agent, MLflow traces)
```

All medicines, trials, sponsors and results are fictional.

## What's in this folder

| Path | What it is |
|---|---|
| `data/batch1/` | Initial dataset: 11 medicines, 63 trials, 95 arms, 244 results, 380 adverse events |
| `data/batch2/` | Demo top-up: 3 new Glucendra trials plus 3 planted data problems |
| `pipeline/atlas_pipeline.sql` | Lakeflow Declarative Pipeline (bronze, silver with expectations, gold) |
| `sql/functions.sql` | Evidence view and 7 SQL functions; every number the assistant quotes comes from these |
| `notebooks/00_setup.py` | Creates schemas, volumes and log table, and lands batch 1 |
| `notebooks/01_land_batch2.py` | Drops batch 2 into the landing folder (demo) |
| `notebooks/02_create_functions.py` | Builds the view and functions in a given schema |
| `notebooks/03_evaluate.py` | Quality gate; fails the job if anything is wrong |
| `notebooks/04_promote.py` | Copies evaluated tables to the live schema |
| `notebooks/05_generate_reports.py` | Writes a study-report PDF per trial |
| `eval/expected.json` | Reference answers the gate checks |
| `genie/genie_space_setup.md` | Text to paste when creating the Genie space |
| `app/` | The Databricks App: `server.py`, `agent.py`, `db.py`, `app.yaml`, `static/` interface |

The full step-by-step guide is in the chat where this kit was delivered. Each step ends with a checkpoint.
