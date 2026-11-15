# Genie space setup: copy and paste

**Name:** Clinical Atlas Evidence
**Description:** Ask about fictional medicines, synthetic trials, efficacy and safety across eight body systems.

## Tables to add (schema workspace.atlas)
results_enriched, trials, medicines, outcomes, arms, results, adverse_events, outcome_evidence

## Instructions (General instructions box)
- All data is fictional and exists only for demonstration.
- A trial arm is one dose of a medicine within a trial. Count arms with COUNT(*) on arms or results_enriched rows for one outcome; count trials with COUNT(DISTINCT trial_id).
- mean_difference is the difference versus the trial's comparator, in the outcome's unit. Join outcomes (or use results_enriched.lower_is_better) to decide direction: when lower_is_better is true, a negative difference is an improvement.
- result = 'Positive' means a statistically significant improvement (p < 0.05); 'Neutral' means not significant; 'Negative' means significant worsening.
- For pooled or overall effects, use outcome_evidence or the pooled_effect function. Do not average mean_difference yourself.
- quality is High, Moderate or Low. "High-quality" means quality = 'High'.
- Body systems: Nervous, Cardiovascular, Respiratory, Digestive, Hepatic, Renal, Musculoskeletal, Endocrine.

## SQL functions to add as trusted assets
workspace.atlas.pooled_effect, workspace.atlas.medicine_summary, workspace.atlas.medicine_outcomes,
workspace.atlas.safety_profile, workspace.atlas.system_medicines, workspace.atlas.search_trials, workspace.atlas.trial_detail

## Sample questions
- Which medicines lower systolic blood pressure?
- Summarise Glucendra's effect on HbA1c
- Which Bronquel trials were high quality?
- What are the most common side effects of Arteval compared with placebo?
- How many trials were run in each country?

## Benchmarks (question → expected answer, from batch 1)
| Question | Expected |
|---|---|
| Pooled effect of Hepatrisol on liver fat | −1.498 % points (−1.818 to −1.178), 7 arms |
| Pooled effect of Arteval on systolic blood pressure | −4.776 mmHg (−5.615 to −3.937), 11 arms |
| Pooled effect of Lipovance on LDL cholesterol | −21.019 mg/dL (−23.315 to −18.723), 12 arms |
| How many trials are in the database? | 63 (66 after batch 2) |
| How many trials of Glucendra? | 7 (10 after batch 2) |
