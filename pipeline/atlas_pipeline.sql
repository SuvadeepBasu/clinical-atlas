-- Clinical Atlas: Lakeflow Declarative Pipeline
-- Target catalog: workspace   Target schema: atlas_stage
-- Reads every CSV dropped into /Volumes/workspace/atlas/landing/<entity>/
-- bronze_* : raw rows exactly as uploaded (all strings, plus source file and load time)
-- silver   : typed, cleaned, de-duplicated tables with data-quality expectations
-- gold     : results_enriched, one wide row per arm per outcome for Genie and the app

-- ============================ BRONZE ============================
CREATE OR REFRESH STREAMING TABLE bronze_medicines
COMMENT 'Raw medicine rows as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/medicines/', format => 'csv', header => true, inferColumnTypes => false);

CREATE OR REFRESH STREAMING TABLE bronze_outcomes
COMMENT 'Raw outcome definitions as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/outcomes/', format => 'csv', header => true, inferColumnTypes => false);

CREATE OR REFRESH STREAMING TABLE bronze_trials
COMMENT 'Raw trial rows as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/trials/', format => 'csv', header => true, inferColumnTypes => false);

CREATE OR REFRESH STREAMING TABLE bronze_arms
COMMENT 'Raw trial-arm rows as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/arms/', format => 'csv', header => true, inferColumnTypes => false);

CREATE OR REFRESH STREAMING TABLE bronze_results
COMMENT 'Raw efficacy result rows as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/results/', format => 'csv', header => true, inferColumnTypes => false);

CREATE OR REFRESH STREAMING TABLE bronze_adverse_events
COMMENT 'Raw adverse-event rows as uploaded'
AS SELECT *, _metadata.file_path AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/workspace/atlas/landing/adverse_events/', format => 'csv', header => true, inferColumnTypes => false);

-- ============================ SILVER ============================
-- The latest upload of a key wins, so re-uploading a corrected file replaces the old rows.

CREATE OR REFRESH MATERIALIZED VIEW medicines (
  CONSTRAINT medicine_named EXPECT (medicine IS NOT NULL AND code IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'One row per medicine. body_systems and doses are pipe-separated lists.'
AS SELECT medicine, code, drug_class, indication, body_systems, sponsor, doses FROM (
  SELECT trim(medicine) AS medicine, upper(trim(code)) AS code, trim(drug_class) AS drug_class, trim(indication) AS indication,
         trim(body_systems) AS body_systems, trim(sponsor) AS sponsor, trim(doses) AS doses,
         row_number() OVER (PARTITION BY lower(trim(medicine)) ORDER BY ingested_at DESC) AS rn
  FROM bronze_medicines) WHERE rn = 1;

CREATE OR REFRESH MATERIALIZED VIEW outcomes (
  CONSTRAINT outcome_has_system EXPECT (body_system IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT direction_known EXPECT (lower_is_better IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'Outcome definitions. lower_is_better tells you which direction of mean_difference is an improvement.'
AS SELECT outcome, body_system, unit, lower_is_better FROM (
  SELECT trim(outcome) AS outcome, trim(body_system) AS body_system, trim(unit) AS unit,
         try_cast(lower_is_better AS BOOLEAN) AS lower_is_better,
         row_number() OVER (PARTITION BY lower(trim(outcome)) ORDER BY ingested_at DESC) AS rn
  FROM bronze_outcomes) WHERE rn = 1;

CREATE OR REFRESH MATERIALIZED VIEW trials (
  CONSTRAINT trial_id_present EXPECT (trial_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT known_medicine EXPECT (medicine_known) ON VIOLATION DROP ROW,
  CONSTRAINT plausible_year EXPECT (year BETWEEN 1990 AND 2030),
  CONSTRAINT known_quality EXPECT (quality IN ('High', 'Moderate', 'Low'))
)
COMMENT 'One row per trial. quality: High = randomised double-blind with at least 60 per arm; Moderate = other randomised; Low = single-arm.'
AS SELECT t.*, m.medicine IS NOT NULL AS medicine_known FROM (
  SELECT trial_id, registry_id, medicine, phase, year, design, comparator, duration, population, participants,
         countries, sponsor, authors, quality, title, journal FROM (
    SELECT upper(trim(trial_id)) AS trial_id, trim(registry_id) AS registry_id, trim(medicine) AS medicine, trim(phase) AS phase,
           try_cast(year AS INT) AS year, trim(design) AS design, trim(comparator) AS comparator, trim(duration) AS duration,
           trim(population) AS population, try_cast(participants AS INT) AS participants, trim(countries) AS countries,
           trim(sponsor) AS sponsor, trim(authors) AS authors, initcap(trim(quality)) AS quality, trim(title) AS title, trim(journal) AS journal,
           row_number() OVER (PARTITION BY upper(trim(trial_id)) ORDER BY ingested_at DESC) AS rn
    FROM bronze_trials) WHERE rn = 1) t
LEFT JOIN medicines m ON lower(m.medicine) = lower(t.medicine);

CREATE OR REFRESH MATERIALIZED VIEW arms (
  CONSTRAINT arm_has_trial EXPECT (trial_known) ON VIOLATION DROP ROW,
  CONSTRAINT positive_n EXPECT (n > 0) ON VIOLATION DROP ROW
)
COMMENT 'One row per trial arm (a dose of the medicine). serious_ae_pct and discontinuation_pct are % of participants in the arm.'
AS SELECT a.*, t.trial_id IS NOT NULL AS trial_known FROM (
  SELECT arm_id, trial_id, dose, n, serious_ae_pct, discontinuation_pct FROM (
    SELECT upper(trim(arm_id)) AS arm_id, upper(trim(trial_id)) AS trial_id, trim(dose) AS dose, try_cast(n AS INT) AS n,
           try_cast(serious_ae_pct AS DOUBLE) AS serious_ae_pct, try_cast(discontinuation_pct AS DOUBLE) AS discontinuation_pct,
           row_number() OVER (PARTITION BY upper(trim(arm_id)) ORDER BY ingested_at DESC) AS rn
    FROM bronze_arms) WHERE rn = 1) a
LEFT JOIN trials t ON t.trial_id = a.trial_id;

CREATE OR REFRESH MATERIALIZED VIEW results (
  CONSTRAINT result_has_arm EXPECT (arm_known) ON VIOLATION DROP ROW,
  CONSTRAINT ci_ordered EXPECT (ci_low <= mean_difference AND mean_difference <= ci_high) ON VIOLATION DROP ROW,
  CONSTRAINT result_label_valid EXPECT (result IN ('Positive', 'Neutral', 'Negative')) ON VIOLATION DROP ROW,
  CONSTRAINT p_in_range EXPECT (p_value BETWEEN 0 AND 1)
)
COMMENT 'One row per arm per outcome. mean_difference is versus the trial comparator, in unit; join outcomes.lower_is_better to read direction. result is Positive when p < 0.05 and favourable.'
AS SELECT r.*, a.arm_id IS NOT NULL AS arm_known FROM (
  SELECT arm_id, trial_id, outcome, body_system, is_primary, mean_difference, ci_low, ci_high, unit, p_value, result FROM (
    SELECT upper(trim(arm_id)) AS arm_id, upper(trim(trial_id)) AS trial_id, trim(outcome) AS outcome, trim(body_system) AS body_system,
           try_cast(is_primary AS BOOLEAN) AS is_primary, try_cast(mean_difference AS DOUBLE) AS mean_difference,
           try_cast(ci_low AS DOUBLE) AS ci_low, try_cast(ci_high AS DOUBLE) AS ci_high, trim(unit) AS unit,
           try_cast(p_value AS DOUBLE) AS p_value,
           -- normalise known label typos (Postive, positve, neutral, Negativa ...)
           CASE WHEN lower(trim(result)) LIKE 'pos%' THEN 'Positive'
                WHEN lower(trim(result)) LIKE 'neu%' THEN 'Neutral'
                WHEN lower(trim(result)) LIKE 'neg%' THEN 'Negative'
                ELSE trim(result) END AS result,
           row_number() OVER (PARTITION BY upper(trim(arm_id)), lower(trim(outcome)) ORDER BY ingested_at DESC) AS rn
    FROM bronze_results) WHERE rn = 1) r
LEFT JOIN arms a ON a.arm_id = r.arm_id;

CREATE OR REFRESH MATERIALIZED VIEW adverse_events (
  CONSTRAINT event_has_arm EXPECT (arm_known) ON VIOLATION DROP ROW,
  CONSTRAINT pct_in_range EXPECT (drug_pct BETWEEN 0 AND 100 AND comparator_pct BETWEEN 0 AND 100) ON VIOLATION DROP ROW
)
COMMENT 'Adverse-event rates per arm: % of participants on the medicine (drug_pct) and on the comparator (comparator_pct).'
AS SELECT e.*, a.arm_id IS NOT NULL AS arm_known FROM (
  SELECT arm_id, trial_id, event, drug_pct, comparator_pct FROM (
    SELECT upper(trim(arm_id)) AS arm_id, upper(trim(trial_id)) AS trial_id, trim(event) AS event,
           try_cast(drug_pct AS DOUBLE) AS drug_pct, try_cast(comparator_pct AS DOUBLE) AS comparator_pct,
           row_number() OVER (PARTITION BY upper(trim(arm_id)), lower(trim(event)) ORDER BY ingested_at DESC) AS rn
    FROM bronze_adverse_events) WHERE rn = 1) e
LEFT JOIN arms a ON a.arm_id = e.arm_id;

-- ============================ GOLD ============================
CREATE OR REFRESH MATERIALIZED VIEW results_enriched
COMMENT 'One wide row per arm per outcome with trial, medicine and outcome context. Best table for free-text questions.'
AS SELECT r.trial_id, r.arm_id, t.medicine, m.code AS medicine_code, m.drug_class, m.indication, t.phase, t.year, t.design,
          t.comparator, t.quality, t.participants, a.dose, a.n AS arm_n, r.outcome, r.body_system, r.is_primary,
          r.mean_difference, r.ci_low, r.ci_high, r.unit, o.lower_is_better, r.p_value, r.result
FROM results r
JOIN arms a ON a.arm_id = r.arm_id
JOIN trials t ON t.trial_id = r.trial_id
JOIN medicines m ON lower(m.medicine) = lower(t.medicine)
LEFT JOIN outcomes o ON lower(o.outcome) = lower(r.outcome);
