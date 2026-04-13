-- Migration: 010_initialize_assessments_summary.sql
-- Ensure candidates_db and assessments_summary table exist

CREATE DATABASE IF NOT EXISTS candidates_db;
USE candidates_db;

CREATE TABLE IF NOT EXISTS assessments_summary (
    id BINARY(16) PRIMARY KEY,
    candidate_id BINARY(16) NOT NULL,
    position_id BINARY(16) NOT NULL,
    question_id BINARY(16) NOT NULL,
    
    total_rounds_assigned INT DEFAULT 0,
    total_rounds_completed INT DEFAULT 0,
    total_interview_time VARCHAR(255),
    assessment_start_time VARCHAR(255),
    assessment_end_time VARCHAR(255),
    
    is_assessment_completed BIT(1) DEFAULT 0,
    is_report_generated BIT(1) DEFAULT 0,
    
    -- Round 1
    round1_assigned BIT(1) DEFAULT 0,
    round1_completed BIT(1) DEFAULT 0,
    round1_start_time VARCHAR(255),
    round1_end_time VARCHAR(255),
    round1_time_taken VARCHAR(255),
    round1_given_time VARCHAR(20),
    
    -- Round 2
    round2_assigned BIT(1) DEFAULT 0,
    round2_completed BIT(1) DEFAULT 0,
    round2_start_time VARCHAR(255),
    round2_end_time VARCHAR(255),
    round2_time_taken VARCHAR(255),
    round2_given_time VARCHAR(20),
    
    -- Round 3
    round3_assigned BIT(1) DEFAULT 0,
    round3_completed BIT(1) DEFAULT 0,
    round3_start_time VARCHAR(255),
    round13_end_time VARCHAR(255), -- Keep fixed from schema
    round3_time_taken VARCHAR(255),
    round3_given_time VARCHAR(20),
    
    -- Round 4
    round4_assigned BIT(1) DEFAULT 0,
    round4_completed BIT(1) DEFAULT 0,
    round4_start_time VARCHAR(255),
    round4_end_time VARCHAR(255),
    round4_time_taken VARCHAR(255),
    round4_given_time VARCHAR(20),
    
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    
    INDEX idx_candidate_id (candidate_id),
    INDEX idx_position_id (position_id)
);
