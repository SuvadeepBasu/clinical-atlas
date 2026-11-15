# Databricks notebook source
# MAGIC %md
# MAGIC # 03 · Evaluate (quality gate)
# MAGIC Checks the staged data before it goes live. If any check fails the notebook raises an error,
# MAGIC the job stops, and the app keeps serving the last good data. Results are logged to MLflow.

# COMMAND ----------

import os, json, mlflow
dbutils.widgets.text("schema", "workspace.atlas_stage")
schema = dbutils.widgets.get("schema")
expected = json.load(open(os.path.join(os.path.dirname(os.getcwd()), "eval", "expected.json")))
checks = []   # (name, passed, detail)

def scalar(q): return spark.sql(q).collect()[0][0]

# 1. Nothing went missing
for table, minimum in expected["min_counts"].items():
    n = scalar(f"SELECT COUNT(*) FROM {schema}.{table}")
    checks.append((f"count_{table}", n >= minimum, f"{n} rows (minimum {minimum})"))

# 2. Integrity: every result belongs to a known arm and trial; no reversed intervals; labels valid
checks.append(("results_have_trials", scalar(f"SELECT COUNT(*) FROM {schema}.results r LEFT ANTI JOIN {schema}.trials t ON r.trial_id = t.trial_id") == 0, "orphan results"))
checks.append(("ci_ordered", scalar(f"SELECT COUNT(*) FROM {schema}.results WHERE NOT (ci_low <= mean_difference AND mean_difference <= ci_high)") == 0, "reversed intervals"))
checks.append(("labels_valid", scalar(f"SELECT COUNT(*) FROM {schema}.results WHERE result NOT IN ('Positive','Neutral','Negative')") == 0, "invalid result labels"))
checks.append(("every_trial_has_primary", scalar(f"""SELECT COUNT(*) FROM {schema}.trials t WHERE NOT EXISTS
  (SELECT 1 FROM {schema}.results r WHERE r.trial_id = t.trial_id AND r.is_primary)""") == 0, "trials without a primary outcome"))

# 3. Reference answers: medicines untouched by the new batch must give exactly the same numbers
tol = expected["tolerance"]
for ref in expected["reference_answers"]:
    rows = spark.sql(f"SELECT * FROM {schema}.pooled_effect('{ref['medicine']}', '{ref['outcome']}')").collect()
    ok = bool(rows) and rows[0]["arms"] >= ref["arms"]
    if rows and rows[0]["arms"] == ref["arms"]:
        ok = all(abs(rows[0][k] - ref[k]) <= tol for k in ("pooled_difference", "ci_low", "ci_high"))
    got = f"{rows[0]['pooled_difference']} [{rows[0]['ci_low']}, {rows[0]['ci_high']}] over {rows[0]['arms']} arms" if rows else "no rows"
    checks.append((f"ref_{ref['medicine']}_{ref['outcome'][:20]}", ok, f"expected {ref['pooled_difference']} over {ref['arms']} arms, got {got}"))

# COMMAND ----------

mlflow.set_experiment("/Shared/clinical-atlas-evals")
with mlflow.start_run(run_name=f"gate {schema}"):
    for name, ok, detail in checks:
        mlflow.log_metric(name.replace(" ", "_")[:250], 1.0 if ok else 0.0)
    passed = sum(ok for _, ok, _ in checks)
    mlflow.log_metric("checks_passed", passed); mlflow.log_metric("checks_total", len(checks))
    mlflow.log_text("\n".join(f"{'PASS' if ok else 'FAIL'}  {n}: {d}" for n, ok, d in checks), "report.txt")

display(spark.createDataFrame([(n, "PASS" if ok else "FAIL", d) for n, ok, d in checks], "check string, status string, detail string"))
failed = [n for n, ok, _ in checks if not ok]
if failed:
    raise Exception(f"Quality gate failed: {', '.join(failed)}. Live data was not changed.")
print(f"All {len(checks)} checks passed")
