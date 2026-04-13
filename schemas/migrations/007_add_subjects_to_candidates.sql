-- Migration: Add subjects column to college_candidates
-- Description: Adds the missing subjects column required by the attendance system

ALTER TABLE college_candidates ADD COLUMN IF NOT EXISTS subjects TEXT AFTER department_name;
