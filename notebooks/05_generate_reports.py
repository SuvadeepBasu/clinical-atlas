# Databricks notebook source
# MAGIC %md
# MAGIC # 05 · Generate study reports
# MAGIC Writes one PDF per trial to `/Volumes/workspace/atlas/reports/`. The app streams these when a user opens a study.

# COMMAND ----------

# MAGIC %pip install reportlab==4.2.5
# MAGIC %restart_python

# COMMAND ----------

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

OUT = "/Volumes/workspace/atlas/reports"
S = getSampleStyleSheet()
small = ParagraphStyle("small", parent=S["Normal"], fontSize=8.5, leading=11)
warn = ParagraphStyle("warn", parent=small, textColor=colors.HexColor("#b23a2b"))
fmt = lambda v: f"{v:+.2f}".replace("-", "−")

trials = {r["trial_id"]: r for r in spark.table("workspace.atlas.trials").collect()}
res = spark.sql("""SELECT r.*, a.dose, a.n FROM workspace.atlas.results r JOIN workspace.atlas.arms a ON a.arm_id = r.arm_id
                   ORDER BY r.trial_id, a.dose, r.is_primary DESC, r.outcome""").collect()
aes = spark.sql("""SELECT e.*, a.dose FROM workspace.atlas.adverse_events e JOIN workspace.atlas.arms a ON a.arm_id = e.arm_id
                   ORDER BY e.trial_id, a.dose, e.event""").collect()
by = lambda rows: {k: [r for r in rows if r["trial_id"] == k] for k in trials}
R, E = by(res), by(aes)

def table(data, widths):
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 8.5), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
                           ("LINEABOVE", (0, 0), (-1, 0), 1, colors.black), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.black),
                           ("LINEBELOW", (0, -1), (-1, -1), 0.6, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t

os.makedirs(OUT, exist_ok=True)
for tid, t in trials.items():
    doc = SimpleDocTemplate(f"{OUT}/{tid}.pdf", pagesize=A4, leftMargin=50, rightMargin=50, topMargin=46, bottomMargin=46,
                            title=t["title"], author=t["authors"])
    prim = [r for r in R[tid] if r["is_primary"]]
    story = [Paragraph("SYNTHETIC DOCUMENT · FICTIONAL DATA FOR DEMONSTRATION", warn), Spacer(1, 6),
             Paragraph(f"{t['journal']} · {t['year']} · {t['phase']}", small), Spacer(1, 6),
             Paragraph(t["title"], S["Title"]), Paragraph(t["authors"].replace(";", ","), S["Normal"]),
             Paragraph(f"Registry {t['registry_id']} · Trial {tid} · Sponsor {t['sponsor']}", small), Spacer(1, 10),
             Paragraph("<b>Methods.</b> " + f"{t['design']} trial in {t['population'].lower()}, {t['duration']}, comparator {t['comparator'].lower()}, "
                       f"{t['participants']} participants across {t['countries'].replace('|', ', ')}.", S["Normal"]), Spacer(1, 6),
             Paragraph("<b>Results.</b> " + " ".join(f"At {r['dose']}, {r['outcome'].lower()} changed by {fmt(r['mean_difference'])} {r['unit']} "
                       f"(95% CI {fmt(r['ci_low'])} to {fmt(r['ci_high'])}; p {'< 0.001' if r['p_value'] < 0.001 else '= ' + format(r['p_value'], '.3f')})."
                       for r in prim), S["Normal"]), Spacer(1, 14),
             Paragraph("Table 2. Efficacy outcomes, difference versus comparator", S["Heading4"]),
             table([["Dose", "Outcome", "Difference", "95% CI", "p", "Result"]] +
                   [[r["dose"], Paragraph(r["outcome"] + (" *" if r["is_primary"] else ""), small), f"{fmt(r['mean_difference'])} {r['unit']}",
                     f"{fmt(r['ci_low'])} to {fmt(r['ci_high'])}", f"{r['p_value']:.3g}", r["result"]] for r in R[tid]],
                   [50, 150, 95, 95, 45, 60]),
             Paragraph("* Primary endpoint.", small), Spacer(1, 14),
             Paragraph("Table 3. Adverse events, % of participants", S["Heading4"]),
             table([["Dose", "Event", "Medicine", "Comparator"]] + [[e["dose"], e["event"], f"{e['drug_pct']}%", f"{e['comparator_pct']}%"] for e in E[tid]],
                   [60, 200, 90, 90])]
    doc.build(story)
print(f"Wrote {len(trials)} reports to {OUT}")
