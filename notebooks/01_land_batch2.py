# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Land batch 2 (demo)
# MAGIC Copies three new Glucendra trials into the landing folder. If the job has a file-arrival trigger, it starts on its own.
# MAGIC Batch 2 contains three planted problems so you can watch the pipeline expectations work:
# MAGIC * a result labelled **"Postive"** (normalised to Positive)
# MAGIC * a result whose confidence interval is reversed (dropped by `ci_ordered`)
# MAGIC * a result for a trial that does not exist, `GLD-999` (dropped by `result_has_arm`)

# COMMAND ----------

import os, shutil, glob
src = os.path.join(os.path.dirname(os.getcwd()), "data", "batch2")
landing = "/Volumes/workspace/atlas/landing"
for path in glob.glob(f"{src}/*/*.csv"):
    entity = os.path.basename(os.path.dirname(path))
    os.makedirs(f"{landing}/{entity}", exist_ok=True)
    shutil.copy(path, f"{landing}/{entity}/{os.path.basename(path)}")
    print("Landed", entity, os.path.basename(path))
