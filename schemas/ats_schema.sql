-- ATS Schema - For Recruitment Agencies (ATS Role)
-- This schema supports job-based recruitment and candidate screening

-- Credits table (ATS - Includes Screening)
CREATE TABLE IF NOT EXISTS credits (
  id BINARY(16) NOT NULL PRIMARY KEY,
  organization_id BINARY(16) NOT NULL,
  total_interview_credits INT NOT NULL DEFAULT 0,
  utilized_interview_credits INT NOT NULL DEFAULT 0,
  total_position_credits INT NOT NULL DEFAULT 0,
  utilized_position_credits INT NOT NULL DEFAULT 0,
  total_screening_credits INT NOT NULL DEFAULT 0,
  utilized_screening_credits INT NOT NULL DEFAULT 0,
  screening_credits_min INT NOT NULL DEFAULT 0,
  screening_credits_cost_per_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  valid_till DATE DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_credits_valid_till ON credits (valid_till);
CREATE INDEX idx_credits_active ON credits (is_active);
CREATE INDEX idx_credits_organization_id ON credits (organization_id);


-- Clients table (End clients for recruitment)
CREATE TABLE IF NOT EXISTS clients (
    id BINARY(16) NOT NULL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    client_phone VARCHAR(20),
    manager_name VARCHAR(255),
    manager_email VARCHAR(255),
    manager_phone VARCHAR(20),
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_by BINARY(16) NOT NULL,
    updated_by BINARY(16),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_client_code (code),
    INDEX idx_client_name (client_name),
    INDEX idx_client_status (status),
    INDEX idx_client_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Vendors table (External recruitment vendors)
CREATE TABLE IF NOT EXISTS vendors (
    id BINARY(16) NOT NULL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    vendor_name VARCHAR(255) NOT NULL,
    vendor_email VARCHAR(255),
    vendor_phone VARCHAR(20),
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    login_email VARCHAR(255) UNIQUE,
    login_password VARCHAR(255),
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BINARY(16) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_vendor_code (code),
    INDEX idx_vendor_name (vendor_name),
    INDEX idx_vendor_login_email (login_email),
    INDEX idx_vendor_active (is_active),
    INDEX idx_vendor_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Jobs table (ATS-specific for external recruitment)
CREATE TABLE IF NOT EXISTS jobs (
    id BINARY(16) NOT NULL PRIMARY KEY,
    code VARCHAR(255) NOT NULL UNIQUE,
    
    -- Basic job info
    job_title VARCHAR(255) NOT NULL,
    job_role ENUM('IT', 'NON_IT') DEFAULT 'IT',
    job_description TEXT,
    
    -- Client relationship
    client_id BINARY(16),
    
    -- Status and category
    status ENUM('ACTIVE', 'INACTIVE', 'HOLD') NOT NULL DEFAULT 'ACTIVE',
    priority_level ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') DEFAULT 'MEDIUM',
    
    -- Positions and compensation
    no_of_positions INT NOT NULL DEFAULT 1,
    offered_ctc DECIMAL(10,2) COMMENT 'In Lacs',
    salary_range VARCHAR(100),
    
    -- Experience requirements
    experience_required VARCHAR(100),
    
    -- Location details
    location VARCHAR(255),
    
    -- Job type and details
    job_type ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE') DEFAULT 'FULL_TIME',
    
    -- Manager and SPOC details
    manager_details TEXT,
    spoc_name VARCHAR(255),
    spoc_email VARCHAR(255),
    spoc_phone VARCHAR(20),
    
    
    -- Document storage
    job_description_document_path VARCHAR(255),
    job_description_document_file_name VARCHAR(255),
    
    -- Dates
    application_deadline DATE,
    expected_start_date DATE,
    
    -- Show to vendor flag
    show_to_vendor TINYINT(1) NOT NULL DEFAULT 1,
    
    -- Tracking
    interview_invite_sent INT DEFAULT 0,
    completed_interviews INT DEFAULT 0,
    internal_notes TEXT,
    
    -- Metadata
    created_by BINARY(16) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_job_code (code),
    INDEX idx_job_status (status),
    INDEX idx_job_title (job_title),
    INDEX idx_job_client (client_id),
    INDEX idx_job_priority (priority_level),
    INDEX idx_job_deadline (application_deadline),
    INDEX idx_job_created_at (created_at),
    
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Job Mandatory Skills table
CREATE TABLE IF NOT EXISTS job_mandatory_skills (
    job_id BINARY(16) NOT NULL,
    skill VARCHAR(255) NOT NULL,

    INDEX idx_mandatory_skill (skill),

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Job Optional Skills table
CREATE TABLE IF NOT EXISTS job_optional_skills (
    job_id BINARY(16) NOT NULL,
    skill VARCHAR(255) NOT NULL,

    INDEX idx_optional_skill (skill),

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Job Vendors junction table (Many-to-Many)
CREATE TABLE IF NOT EXISTS job_vendors (
    id BINARY(16) NOT NULL PRIMARY KEY,
    job_id BINARY(16) NOT NULL,
    vendor_id BINARY(16) NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by BINARY(16) NOT NULL,
    
    UNIQUE KEY uk_job_vendor (job_id, vendor_id),
    INDEX idx_job_vendor_job (job_id),
    INDEX idx_job_vendor_vendor (vendor_id),
    
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Job Platforms table (Post to job portals)
CREATE TABLE IF NOT EXISTS job_platforms (
    id BINARY(16) NOT NULL PRIMARY KEY,
    job_id BINARY(16) NOT NULL,
    platform_name ENUM('LINKEDIN', 'NAUKRI', 'INDEED', 'SHINE', 'MONSTER', 'OTHER') NOT NULL,
    posted_at DATETIME,
    post_url VARCHAR(500),
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    posted_by BINARY(16),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_job_platform (job_id, platform_name),
    INDEX idx_job_platform_job (job_id),
    INDEX idx_job_platform_name (platform_name),
    INDEX idx_job_platform_active (is_active),
    
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Question Sets table
CREATE TABLE IF NOT EXISTS question_sets (
    id BINARY(16) NOT NULL PRIMARY KEY,
    question_set_code VARCHAR(100) NOT NULL UNIQUE,
    job_id BINARY(16) NOT NULL,
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
    INDEX idx_question_set_job (job_id),
    INDEX idx_question_set_active (is_active),
    INDEX idx_question_set_status (status),
    INDEX idx_question_set_complexity (complexity_level),

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
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

-- Job Candidates table
CREATE TABLE IF NOT EXISTS job_candidates (
    id BINARY(16) NOT NULL PRIMARY KEY,
    job_id BINARY(16) NOT NULL,
    candidate_id BINARY(16) NOT NULL,
    question_set_id BINARY(16) NOT NULL,
    recommendation ENUM(
        'RECOMMENDED', 'CAUTIOUSLY_RECOMMENDED', 'NOT_RECOMMENDED',
        'UNATTACHED', 'PENDING', 'RESUME_ANALYZING', 'INVITED', 'REINVITED',
        'TEST_STARTED', 'IN_PROGRESS', 'TEST_COMPLETED', 'AWAITING_EVALUATION',
        'RESUME_REJECTED', 'EXPIRED', 'UNATTENDED', 'TEST_ABANDONED',
        'NETWORK_DISCONNECTED', 'TECHNICAL_ISSUE', 'MANUALLY_INVITED', 'CANCELED'
    ) NOT NULL DEFAULT 'PENDING',
    status_changed_by BINARY(16),
    status_changed_at DATETIME,
    resume_match_score DECIMAL(5,2),
    skills_match_percentage DECIMAL(5,2),
    experience_match_percentage DECIMAL(5,2),
    invitation_sent_at DATETIME,
    last_invitation_sent_at DATETIME,
    link_active_at DATETIME,
    link_expires_at DATETIME,
    room_id VARCHAR(100),
    recording_link VARCHAR(500),
    feedback_link VARCHAR(500),
    interview_scheduled_by BINARY(16),
    candidate_overall_score DECIMAL(4,2),
    interview_completed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_job_candidate (job_id, candidate_id),

    INDEX idx_job_candidate_status (recommendation),
    INDEX idx_job_candidate_job (job_id),
    INDEX idx_job_candidate_candidate (candidate_id),
    INDEX idx_job_candidate_created (created_at),
    INDEX idx_job_candidate_invitation (invitation_sent_at),

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Main InterviewEvaluation Table
CREATE TABLE IF NOT EXISTS interview_evaluations (
    id BINARY(16) PRIMARY KEY,
    total_score INTEGER,
    job_id BINARY(16) NOT NULL,
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
    UNIQUE KEY uk_interview_job_candidate (job_id, candidate_id),
    
    -- Foreign Keys
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
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
CREATE INDEX idx_interview_evaluations_job_id ON interview_evaluations(job_id);
CREATE INDEX idx_interview_evaluations_candidate_id ON interview_evaluations(candidate_id);
CREATE INDEX idx_interview_evaluations_job_candidate ON interview_evaluations(job_id, candidate_id);
CREATE INDEX idx_interview_evaluations_created_at ON interview_evaluations(created_at);
CREATE INDEX idx_interview_evaluations_updated_at ON interview_evaluations(updated_at);
CREATE INDEX idx_final_remarks_evaluation_id ON final_remarks(evaluation_id);
 
 -- Company Details table
 CREATE TABLE IF NOT EXISTS company_details (
     id BINARY(16) NOT NULL PRIMARY KEY,
     organization_id BINARY(16) NOT NULL,
     company_name VARCHAR(255) NOT NULL,
     company_email VARCHAR(255) NOT NULL,
     address VARCHAR(255),
     country VARCHAR(100),
     state VARCHAR(100),
     city VARCHAR(100),
     pincode VARCHAR(20),
     industry_type VARCHAR(100),
     founded_year INT,
     website_url VARCHAR(255),
     linkedin_url VARCHAR(255),
     instagram_url VARCHAR(255),
     facebook_url VARCHAR(255),
     about_us TEXT,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 
     UNIQUE KEY uk_company_details_org (organization_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

