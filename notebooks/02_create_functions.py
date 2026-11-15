# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Create evidence view and SQL functions
# MAGIC Builds `outcome_evidence` and the functions the assistant and Genie call, in the schema given by the `schema` parameter.
# MAGIC The job runs this twice: on `workspace.atlas_stage` before evaluation, and on `workspace.atlas` after promotion.

# COMMAND ----------

import os, re
dbutils.widgets.text("schema", "workspace.atlas")
schema = dbutils.widgets.get("schema")

path = os.path.join(os.path.dirname(os.getcwd()), "sql", "functions.sql")
sql_text = open(path).read()
statements = [s.strip() for s in re.split(r"(?m)^\s*;;\s*$", sql_text) if re.search(r"(?im)^\s*CREATE", s)]
for s in statements:
    s = s.replace("{schema}", schema)
    name = re.search(r"(?i)CREATE OR REPLACE (?:VIEW|FUNCTION) (\S+?)[\s(]", s).group(1)
    spark.sql(s)
    print("Created", name)

# COMMAND ----------

display(spark.sql(f"SELECT * FROM {schema}.medicine_outcomes('Glucendra')"))
