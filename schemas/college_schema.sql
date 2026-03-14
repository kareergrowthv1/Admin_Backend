-- College Schema - For Educational Institutions (ADMIN Role)
-- This schema supports position-based campus recruitment

-- Credits table (College - No Screening)
CREATE TABLE IF NOT EXISTS credits (
  id BINARY(16) NOT NULL PRIMARY KEY,
  organization_id BINARY(16) NOT NULL,
  total_interview_credits INT NOT NULL DEFAULT 0,
  utilized_interview_credits INT NOT NULL DEFAULT 0,
  total_position_credits INT NOT NULL DEFAULT 0,
  utilized_position_credits INT NOT NULL DEFAULT 0,
  valid_till DATE DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Candidate Positions mapping (for candidates_db linkage)
CREATE TABLE IF NOT EXISTS candidate_positions (
    position_candidate_id VARCHAR(36) NOT NULL PRIMARY KEY,
    candidate_id VARCHAR(36) NOT NULL,
    position_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,

    candidate_code VARCHAR(50),
    candidate_name VARCHAR(255),
    job_title VARCHAR(255),
    domain_type VARCHAR(50),
    position_code VARCHAR(100),

    invited_date DATETIME,
    resume_score DECIMAL(5,2),
    status VARCHAR(50),
    recommendation_status VARCHAR(50),

    question_set_id VARCHAR(36),
    question_section_id VARCHAR(36),
    question_set_duration VARCHAR(10),

    interview_notes TEXT,
    internal_notes TEXT,
    notes_by VARCHAR(255),
    notes_date DATE,

    link_active_at DATETIME,
    link_expires_at DATETIME,
    interview_scheduled_by VARCHAR(36),
    interview_completed_at DATETIME,
    application_deadline DATE,

    minimum_experience INT,
    maximum_experience INT,

    workflow_stage VARCHAR(100) DEFAULT 'Initial Review',
    invitation_sent_at DATETIME,
    created_by VARCHAR(36),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_candidate_positions_candidate (candidate_id),
    INDEX idx_candidate_positions_position (position_id),
    INDEX idx_candidate_positions_org (organization_id),
    INDEX idx_candidate_positions_status (status),
    UNIQUE KEY uk_candidate_positions (candidate_id, position_id, organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_credits_valid_till ON credits (valid_till);
CREATE INDEX idx_credits_active ON credits (is_active);
CREATE INDEX idx_credits_organization_id ON credits (organization_id);


-- Positions table (College-specific for campus placements)
CREATE TABLE IF NOT EXISTS positions (
    id BINARY(16) NOT NULL PRIMARY KEY,
    code VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    domain_type VARCHAR(50) NOT NULL,
    minimum_experience INT NOT NULL DEFAULT 0,
    maximum_experience INT NOT NULL DEFAULT 0,
    job_description_document_path VARCHAR(255),
    job_description_document_file_name VARCHAR(255),
    position_status ENUM('ACTIVE', 'CLOSED', 'ON_HOLD', 'DRAFT', 'EXPIRED', 'INACTIVE') NOT NULL DEFAULT 'DRAFT',
    no_of_positions INT NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    interview_invite_sent INT DEFAULT 0,
    completed_interviews INT DEFAULT 0,
    expected_start_date DATE,
    application_deadline DATE,
    internal_notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_position_code (code),
    INDEX idx_position_status (position_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Position Mandatory Skills table
CREATE TABLE IF NOT EXISTS position_mandatory_skills (
    position_id BINARY(16) NOT NULL,
    skill VARCHAR(255) NOT NULL,

    INDEX idx_mandatory_skill (skill),

    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Position Optional Skills table
CREATE TABLE IF NOT EXISTS position_optional_skills (
    position_id BINARY(16) NOT NULL,
    skill VARCHAR(255) NOT NULL,

    INDEX idx_optional_skill (skill),

    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Question Sets table
CREATE TABLE IF NOT EXISTS question_sets (
    id BINARY(16) NOT NULL PRIMARY KEY,
    question_set_code VARCHAR(100) NOT NULL UNIQUE,
    position_id BINARY(16) NOT NULL,
    total_questions INT NOT NULL CHECK (total_questions >= 1),
    total_duration VARCHAR(255) NOT NULL,
    instruction TEXT,
    interview_platform ENUM('EXE', 'BROWSER') NOT NULL,
    interview_mode ENUM('CONVERSATIONAL', 'NON_CONVERSATIONAL') NOT NULL,
    created_by VARCHAR(50) NOT NULL,
    version INT,
    complexity_level ENUM('ENTRY', 'JUNIOR', 'INTERMEDIATE', 'SENIOR', 'EXPERT'),
    general_questions_count INT,
    position_specific_questions_count INT,
    coding_questions_count INT,
    aptitude_questions_count INT,
    status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED', 'UNDER_REVIEW'),
    is_active BOOLEAN DEFAULT TRUE,
    question_section_ids TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_question_set_code (question_set_code),
    INDEX idx_question_set_position (position_id),
    INDEX idx_question_set_active (is_active),
    INDEX idx_question_set_status (status),
    INDEX idx_question_set_complexity (complexity_level),

    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Question Sections table
CREATE TABLE IF NOT EXISTS question_sections (
    id BINARY(16) NOT NULL PRIMARY KEY,
    question_set_id BINARY(16) NOT NULL,
    question_set_code VARCHAR(100),
    general_questions JSON,
    position_specific_questions JSON,
    coding_questions JSON,
    aptitude_questions JSON,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_section_question_set (question_set_id),
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interview Instructions table
CREATE TABLE IF NOT EXISTS interview_instructions (
    id BINARY(16) NOT NULL PRIMARY KEY,
    question_set_id BINARY(16) NOT NULL,
    position_id BINARY(16) NOT NULL,
    content_type VARCHAR(50),
    content TEXT,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_instruction_set_pos (question_set_id, position_id, is_active),
    INDEX idx_instruction_question_set (question_set_id),
    INDEX idx_instruction_position (position_id),
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Main InterviewEvaluation Table
CREATE TABLE IF NOT EXISTS interview_evaluations (
    id BINARY(16) PRIMARY KEY,
    total_score INTEGER,
    position_id BINARY(16) NOT NULL,
    candidate_id BINARY(16) NOT NULL,
    recommendation_status VARCHAR(255),
    report_generated BOOLEAN NOT NULL DEFAULT TRUE,

    -- Embedded SoftSkills fields
    soft_skills_fluency INTEGER,
    soft_skills_grammar INTEGER,
    soft_skills_confidence INTEGER,
    soft_skills_clarity INTEGER,

    -- Embedded SectionScores fields
    section_scores_general INTEGER,
    section_scores_position_specific INTEGER,
    section_scores_aptitude INTEGER,
    section_scores_coding INTEGER,

    -- Timestamp fields
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE KEY uk_interview_position_candidate (position_id, candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Separate table for final_remarks (ElementCollection)
CREATE TABLE IF NOT EXISTS final_remarks (
    evaluation_id BINARY(16) NOT NULL,
    remark VARCHAR(1000),

    -- Foreign key constraint
    CONSTRAINT fk_final_remarks_evaluation
        FOREIGN KEY (evaluation_id)
        REFERENCES interview_evaluations(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for better performance
CREATE INDEX idx_interview_evaluations_position_id ON interview_evaluations(position_id);
CREATE INDEX idx_interview_evaluations_candidate_id ON interview_evaluations(candidate_id);
CREATE INDEX idx_interview_evaluations_position_candidate ON interview_evaluations(position_id, candidate_id);
CREATE INDEX idx_interview_evaluations_created_at ON interview_evaluations(created_at);
CREATE INDEX idx_interview_evaluations_updated_at ON interview_evaluations(updated_at);
CREATE INDEX idx_final_remarks_evaluation_id ON final_remarks(evaluation_id);
 
 -- College Details table
 CREATE TABLE IF NOT EXISTS college_details (
     id BINARY(16) NOT NULL PRIMARY KEY,
     organization_id BINARY(16) NOT NULL,
     college_name VARCHAR(255) NOT NULL,
     college_email VARCHAR(255) NOT NULL,
     address VARCHAR(255),
     country VARCHAR(100),
     state VARCHAR(100),
     city VARCHAR(100),
     pincode VARCHAR(20),
     university VARCHAR(255),
     website_url VARCHAR(255),
     about_us TEXT,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 
     UNIQUE KEY uk_college_details_org (organization_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Scoring / Resume ATS settings (per organization)
CREATE TABLE IF NOT EXISTS ai_scoring_settings (
    id BINARY(16) NOT NULL PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    ai_scoring_enabled TINYINT(1) NOT NULL DEFAULT 1,
    -- Resume Score Weightage (must sum to 100)
    weightage_skills INT NOT NULL DEFAULT 30,
    weightage_experience INT NOT NULL DEFAULT 25,
    weightage_education INT NOT NULL DEFAULT 20,
    weightage_certifications INT NOT NULL DEFAULT 15,
    weightage_projects INT NOT NULL DEFAULT 10,
    -- Resume: single threshold (score < threshold_not_selected = Rejected, >= = Invited). selected/rejected kept for compat.
    threshold_selected INT NOT NULL DEFAULT 50,
    threshold_not_selected INT NOT NULL DEFAULT 50,
    threshold_rejected INT NOT NULL DEFAULT 50,
    threshold_recommended INT NOT NULL DEFAULT 70,
    threshold_cautiously_recommended INT NOT NULL DEFAULT 50,
    threshold_not_recommended INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ai_scoring_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cross-question settings per organization (1-4 follow-up questions per main question in Conversational mode)
CREATE TABLE IF NOT EXISTS cross_question_settings (
    id BINARY(16) NOT NULL PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    cross_question_count_general TINYINT NOT NULL DEFAULT 2,
    cross_question_count_position TINYINT NOT NULL DEFAULT 2,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cross_question_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- JD extract: one row per position (upsert by position_id). Keywords extracted from PDF/DOCX on upload.
CREATE TABLE IF NOT EXISTS jd_extract (
    id CHAR(36) NOT NULL PRIMARY KEY,
    position_id VARCHAR(36) NOT NULL,
    org_id VARCHAR(36) NOT NULL,
    extracted_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_jd_extract_position (position_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Resume extract: one row per (candidate_id, position_id). Keywords extracted from PDF/DOCX on add candidate.
CREATE TABLE IF NOT EXISTS resume_extract (
    id CHAR(36) NOT NULL PRIMARY KEY,
    candidate_id VARCHAR(36) NOT NULL,
    position_id VARCHAR(36) NOT NULL,
    org_id VARCHAR(36) NOT NULL,
    extracted_data JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_resume_extract_candidate_position (candidate_id, position_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
