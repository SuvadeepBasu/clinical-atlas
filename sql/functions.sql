-- Clinical Atlas: evidence view and SQL functions
-- {schema} is replaced by the notebook (workspace.atlas_stage for testing, workspace.atlas for live).
-- Every number the assistant quotes comes from here, never from the language model.
-- Statements are separated by a line containing only ";;".

-- Pooled evidence per medicine and outcome (fixed-effect, inverse-variance, placebo-controlled arms only)
CREATE OR REPLACE VIEW {schema}.outcome_evidence
COMMENT 'One row per medicine and outcome: arm tallies, pooled placebo-controlled difference with 95% CI, and I2 heterogeneity.'
AS
WITH r AS (
  SELECT t.medicine, r.outcome, r.body_system, r.unit, r.result, r.is_primary, r.mean_difference AS md,
         CASE WHEN t.comparator = 'Placebo' AND r.ci_high > r.ci_low
              THEN 1.0 / POW((r.ci_high - r.ci_low) / 3.92, 2) END AS w
  FROM {schema}.results r JOIN {schema}.trials t ON r.trial_id = t.trial_id
),
p AS (
  SELECT medicine, outcome, SUM(w * md) / SUM(w) AS est, SUM(w) AS sw, COUNT(w) AS k
  FROM r GROUP BY medicine, outcome
)
SELECT r.medicine, r.outcome,
       FIRST(r.body_system) AS body_system, FIRST(r.unit) AS unit, FIRST(o.lower_is_better) AS lower_is_better,
       MAX(CAST(r.is_primary AS INT)) = 1 AS is_primary_outcome,
       COUNT(*) AS arms,
       COUNT_IF(r.result = 'Positive') AS positive_arms,
       COUNT_IF(r.result = 'Neutral') AS neutral_arms,
       COUNT_IF(r.result = 'Negative') AS negative_arms,
       FIRST(p.k) AS placebo_arms_pooled,
       ROUND(FIRST(p.est), 3) AS pooled_difference,
       ROUND(FIRST(p.est) - 1.96 * SQRT(1 / FIRST(p.sw)), 3) AS ci_low,
       ROUND(FIRST(p.est) + 1.96 * SQRT(1 / FIRST(p.sw)), 3) AS ci_high,
       CASE WHEN FIRST(p.k) > 1 AND SUM(r.w * POW(r.md - p.est, 2)) > 0
            THEN ROUND(GREATEST(0, (SUM(r.w * POW(r.md - p.est, 2)) - (FIRST(p.k) - 1)) / SUM(r.w * POW(r.md - p.est, 2))) * 100, 0)
            ELSE 0 END AS i2_percent
FROM r JOIN p ON r.medicine = p.medicine AND r.outcome = p.outcome
LEFT JOIN {schema}.outcomes o ON lower(o.outcome) = lower(r.outcome)
GROUP BY r.medicine, r.outcome
;;

CREATE OR REPLACE FUNCTION {schema}.medicine_summary(p_medicine STRING)
RETURNS TABLE (medicine STRING, code STRING, drug_class STRING, indication STRING, body_systems STRING, sponsor STRING,
               trials BIGINT, arms BIGINT, participants BIGINT, high_quality_trials BIGINT, phases STRING,
               serious_ae_pct DOUBLE, discontinuation_pct DOUBLE)
COMMENT 'Overview of one medicine (name or code): trial and participant counts, phases, quality, and average serious adverse event and discontinuation rates.'
RETURN
  WITH m AS (
    SELECT * FROM {schema}.medicines
    WHERE lower(medicine) = lower(trim(p_medicine)) OR lower(code) = lower(trim(p_medicine))
  ),
  t AS (SELECT t.* FROM {schema}.trials t JOIN m ON lower(t.medicine) = lower(m.medicine)),
  ts AS (
    SELECT COUNT(*) AS trials, SUM(participants) AS participants, COUNT_IF(quality = 'High') AS high_quality_trials,
           ARRAY_JOIN(ARRAY_SORT(COLLECT_SET(phase)), ', ') AS phases
    FROM t
  ),
  a AS (
    SELECT COUNT(*) AS arms, ROUND(AVG(serious_ae_pct), 1) AS sae, ROUND(AVG(discontinuation_pct), 1) AS disc
    FROM {schema}.arms a JOIN t ON a.trial_id = t.trial_id
  )
  SELECT m.medicine, m.code, m.drug_class, m.indication, m.body_systems, m.sponsor,
         ts.trials, a.arms, ts.participants, ts.high_quality_trials, ts.phases, a.sae, a.disc
  FROM m CROSS JOIN ts CROSS JOIN a
;;

CREATE OR REPLACE FUNCTION {schema}.medicine_outcomes(p_medicine STRING)
RETURNS TABLE (medicine STRING, outcome STRING, body_system STRING, unit STRING, lower_is_better BOOLEAN, is_primary_outcome BOOLEAN,
               arms BIGINT, positive_arms BIGINT, neutral_arms BIGINT, negative_arms BIGINT, placebo_arms_pooled BIGINT,
               pooled_difference DOUBLE, ci_low DOUBLE, ci_high DOUBLE, i2_percent DOUBLE)
COMMENT 'Every outcome measured for one medicine (name or code), with arm tallies and the pooled placebo-controlled difference and 95% CI.'
RETURN
  SELECT e.medicine, e.outcome, e.body_system, e.unit, e.lower_is_better, e.is_primary_outcome,
         e.arms, e.positive_arms, e.neutral_arms, e.negative_arms, e.placebo_arms_pooled,
         e.pooled_difference, e.ci_low, e.ci_high, CAST(e.i2_percent AS DOUBLE)
  FROM {schema}.outcome_evidence e
  JOIN {schema}.medicines m ON lower(m.medicine) = lower(e.medicine)
  WHERE lower(m.medicine) = lower(trim(p_medicine)) OR lower(m.code) = lower(trim(p_medicine))
  ORDER BY e.is_primary_outcome DESC, e.arms DESC
;;

CREATE OR REPLACE FUNCTION {schema}.pooled_effect(p_medicine STRING, p_outcome STRING)
RETURNS TABLE (medicine STRING, outcome STRING, unit STRING, lower_is_better BOOLEAN, arms BIGINT, positive_arms BIGINT,
               placebo_arms_pooled BIGINT, pooled_difference DOUBLE, ci_low DOUBLE, ci_high DOUBLE, i2_percent DOUBLE)
COMMENT 'Pooled placebo-controlled difference for one medicine and one outcome (outcome name or part of it, e.g. HbA1c).'
RETURN
  SELECT e.medicine, e.outcome, e.unit, e.lower_is_better, e.arms, e.positive_arms, e.placebo_arms_pooled,
         e.pooled_difference, e.ci_low, e.ci_high, CAST(e.i2_percent AS DOUBLE)
  FROM {schema}.outcome_evidence e
  JOIN {schema}.medicines m ON lower(m.medicine) = lower(e.medicine)
  WHERE (lower(m.medicine) = lower(trim(p_medicine)) OR lower(m.code) = lower(trim(p_medicine)))
    AND lower(e.outcome) LIKE concat('%', lower(trim(p_outcome)), '%')
;;

CREATE OR REPLACE FUNCTION {schema}.safety_profile(p_medicine STRING)
RETURNS TABLE (medicine STRING, event STRING, arms BIGINT, drug_pct DOUBLE, comparator_pct DOUBLE, excess_pct DOUBLE)
COMMENT 'Adverse events for one medicine (name or code): average % on the medicine vs comparator across arms, largest excess first.'
RETURN
  SELECT t.medicine, e.event, COUNT(*) AS arms,
         ROUND(AVG(e.drug_pct), 1) AS drug_pct, ROUND(AVG(e.comparator_pct), 1) AS comparator_pct,
         ROUND(AVG(e.drug_pct) - AVG(e.comparator_pct), 1) AS excess_pct
  FROM {schema}.adverse_events e
  JOIN {schema}.trials t ON e.trial_id = t.trial_id
  JOIN {schema}.medicines m ON lower(m.medicine) = lower(t.medicine)
  WHERE lower(m.medicine) = lower(trim(p_medicine)) OR lower(m.code) = lower(trim(p_medicine))
  GROUP BY t.medicine, e.event
  ORDER BY excess_pct DESC
;;

CREATE OR REPLACE FUNCTION {schema}.system_medicines(p_system STRING)
RETURNS TABLE (body_system STRING, medicine STRING, outcome STRING, unit STRING, lower_is_better BOOLEAN, arms BIGINT,
               positive_arms BIGINT, pooled_difference DOUBLE, ci_low DOUBLE, ci_high DOUBLE)
COMMENT 'Every medicine with outcomes in one body system (Nervous, Cardiovascular, Respiratory, Digestive, Hepatic, Renal, Musculoskeletal, Endocrine), with pooled results per outcome.'
RETURN
  SELECT body_system, medicine, outcome, unit, lower_is_better, arms, positive_arms, pooled_difference, ci_low, ci_high
  FROM {schema}.outcome_evidence
  WHERE lower(body_system) = lower(trim(p_system))
  ORDER BY outcome, positive_arms DESC
;;

CREATE OR REPLACE FUNCTION {schema}.search_trials(p_medicine STRING DEFAULT '', p_system STRING DEFAULT '', p_quality STRING DEFAULT '')
RETURNS TABLE (trial_id STRING, medicine STRING, phase STRING, year INT, design STRING, quality STRING, participants INT,
               dose STRING, outcome STRING, mean_difference DOUBLE, ci_low DOUBLE, ci_high DOUBLE, unit STRING, p_value DOUBLE, result STRING)
COMMENT 'Find trials by medicine, body system and/or quality (pass an empty string for any). Returns the primary outcome per arm, or the outcomes in the requested body system.'
RETURN
  SELECT e.trial_id, e.medicine, e.phase, e.year, e.design, e.quality, e.participants,
         e.dose, e.outcome, e.mean_difference, e.ci_low, e.ci_high, e.unit, e.p_value, e.result
  FROM {schema}.results_enriched e
  WHERE (trim(p_medicine) = '' OR lower(e.medicine) = lower(trim(p_medicine)) OR lower(e.medicine_code) = lower(trim(p_medicine)))
    AND (trim(p_quality) = '' OR lower(e.quality) = lower(trim(p_quality)))
    AND (CASE WHEN trim(p_system) = '' THEN e.is_primary ELSE lower(e.body_system) = lower(trim(p_system)) END)
  ORDER BY e.year DESC, e.trial_id
  LIMIT 60
;;

CREATE OR REPLACE FUNCTION {schema}.trial_detail(p_trial_id STRING)
RETURNS TABLE (trial_id STRING, medicine STRING, phase STRING, year INT, design STRING, comparator STRING, quality STRING,
               participants INT, dose STRING, arm_n INT, outcome STRING, is_primary BOOLEAN, mean_difference DOUBLE,
               ci_low DOUBLE, ci_high DOUBLE, unit STRING, p_value DOUBLE, result STRING)
COMMENT 'Every arm and outcome result for one trial ID, e.g. GLD-212.'
RETURN
  SELECT trial_id, medicine, phase, year, design, comparator, quality, participants, dose, arm_n, outcome, is_primary,
         mean_difference, ci_low, ci_high, unit, p_value, result
  FROM {schema}.results_enriched
  WHERE upper(trial_id) = upper(trim(replace(replace(p_trial_id, '[', ''), ']', '')))
  ORDER BY dose, is_primary DESC, outcome
