# Databricks notebook source
# MAGIC %md
# MAGIC # 04 · Promote
# MAGIC Copies the evaluated tables from `atlas_stage` to the live `atlas` schema, adds descriptions Genie can read,
# MAGIC and records the refresh. Only runs after `03_evaluate` passes.

# COMMAND ----------

SRC, DST = "workspace.atlas_stage", "workspace.atlas"
DROP = {"medicine_known", "trial_known", "arm_known"}      # helper columns used only by expectations
COLUMN_NOTES = {
    "results": {"mean_difference": "Difference versus comparator, in unit. Check outcomes.lower_is_better for direction.",
                "result": "Positive = significant improvement (p < 0.05); Neutral = not significant; Negative = significant worsening.",
                "is_primary": "True for the trial's primary endpoint."},
    "trials": {"quality": "High, Moderate or Low design quality.", "comparator": "Placebo, Standard of care, or None (baseline)."},
    "outcomes": {"lower_is_better": "True when a negative mean_difference is an improvement."},
}

for t in ["medicines", "outcomes", "trials", "arms", "results", "adverse_events", "results_enriched"]:
    cols = [c for c in spark.table(f"{SRC}.{t}").columns if c not in DROP]
    spark.sql(f"CREATE OR REPLACE TABLE {DST}.{t} AS SELECT {', '.join(cols)} FROM {SRC}.{t}")
    try:   # descriptions help Genie; never fail the promotion over them
        comment = spark.sql(f"DESCRIBE TABLE EXTENDED {SRC}.{t}").filter("col_name = 'Comment'").collect()
        if comment and comment[0]["data_type"]:
            spark.sql(f"COMMENT ON TABLE {DST}.{t} IS '{comment[0]['data_type'].replace(chr(39), '')}'")
        for col, note in COLUMN_NOTES.get(t, {}).items():
            spark.sql(f"ALTER TABLE {DST}.{t} ALTER COLUMN {col} COMMENT '{note.replace(chr(39), '')}'")
    except Exception as e:
        print(f"  (could not copy descriptions for {t}: {e})")
    print("Promoted", t)

spark.sql(f"""INSERT INTO {DST}.refresh_log
  SELECT current_timestamp(), (SELECT COUNT(*) FROM {DST}.trials), (SELECT COUNT(*) FROM {DST}.results), 'promoted by job'""")
display(spark.sql(f"SELECT * FROM {DST}.refresh_log ORDER BY refreshed_at DESC"))
