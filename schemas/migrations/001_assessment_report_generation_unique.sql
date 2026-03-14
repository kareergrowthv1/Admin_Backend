-- Migration 001: Add UNIQUE constraint on assessment_report_generation(candidate_id, position_id)
-- This prevents duplicate rows being inserted on each test-start / report-trigger call.
-- Safe to run multiple times (checks constraint existence first).

-- Step 1: Delete duplicate rows, keeping only the most recent per (candidate_id, position_id)
DELETE t1
FROM `candidates_db`.assessment_report_generation t1
INNER JOIN `candidates_db`.assessment_report_generation t2
  ON  t1.candidate_id = t2.candidate_id
  AND t1.position_id  = t2.position_id
  AND t1.created_at   < t2.created_at;

-- If two rows have the identical created_at, break the tie by keeping the larger id
DELETE t1
FROM `candidates_db`.assessment_report_generation t1
INNER JOIN `candidates_db`.assessment_report_generation t2
  ON  t1.candidate_id = t2.candidate_id
  AND t1.position_id  = t2.position_id
  AND t1.created_at   = t2.created_at
  AND t1.id           < t2.id;

-- Step 2: Add the UNIQUE constraint (harmless if it already exists)
ALTER TABLE `candidates_db`.assessment_report_generation
  ADD CONSTRAINT uk_arg_candidate_position UNIQUE (candidate_id, position_id);
