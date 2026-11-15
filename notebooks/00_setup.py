# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup
# MAGIC Creates the schemas and volumes, then copies **batch 1** of the synthetic data into the landing folder.
# MAGIC Run this once. Re-running it is safe.

# COMMAND ----------

import os, shutil, glob

CATALOG = "workspace"
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.atlas COMMENT 'Clinical Atlas live tables (promoted after evaluation)'")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.atlas_stage COMMENT 'Clinical Atlas pipeline output, evaluated before promotion'")
for v, c in [("landing", "Drop CSV files here: one sub-folder per entity"), ("reports", "Generated study-report PDFs")]:
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.atlas.{v} COMMENT '{c}'")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {CATALOG}.atlas.refresh_log (
  refreshed_at TIMESTAMP, trials BIGINT, results BIGINT, note STRING)
  COMMENT 'One row per successful promotion; the app shows the latest as the data version'""")

# COMMAND ----------

repo_root = os.path.dirname(os.getcwd())          # this notebook sits in <repo>/notebooks
src = os.path.join(repo_root, "data", "batch1")
landing = f"/Volumes/{CATALOG}/atlas/landing"
copied = 0
for path in glob.glob(f"{src}/*/*.csv"):
    entity = os.path.basename(os.path.dirname(path))
    os.makedirs(f"{landing}/{entity}", exist_ok=True)
    dest = f"{landing}/{entity}/{os.path.basename(path)}"
    if not os.path.exists(dest):
        shutil.copy(path, dest); copied += 1
print(f"Copied {copied} file(s) into {landing}")
display(dbutils.fs.ls(landing))
