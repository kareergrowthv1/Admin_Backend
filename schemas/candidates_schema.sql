-- Create candidates database
CREATE DATABASE IF NOT EXISTS candidates_db;
USE candidates_db;

-- 1. College Candidates Table (Main candidate information)
CREATE TABLE IF NOT EXISTS college_candidates (
    candidate_id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    
    candidate_code VARCHAR(50) UNIQUE,
    register_no VARCHAR(100) UNIQUE,
    
    candidate_name VARCHAR(255) NOT NULL,
    department VARCHAR(255),
    semester INT,
    year_of_passing INT,
    
    email VARCHAR(255) NOT NULL,
    mobile_number VARCHAR(20),
    location VARCHAR(255),
    address TEXT,
    birthdate DATE,
    
    resume_filename VARCHAR(255),
    resume_url VARCHAR(500),
    
    interview_notes TEXT,
    internal_notes TEXT,
    notes_by VARCHAR(255),
    notes_date DATE,
    
    status VARCHAR(50) DEFAULT 'All',
    skills JSON DEFAULT NULL,
    
    candidate_created_by VARCHAR(36),
    candidate_created_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    subjects TEXT,
    
    INDEX idx_organization_id (organization_id),
    INDEX idx_status (status),
    INDEX idx_candidate_email (email),
    INDEX idx_candidate_code (candidate_code),
    INDEX idx_created_by (candidate_created_by),
    UNIQUE KEY uk_email_org (email, organization_id)
);

-- 2. Private Link Table (Admin-generated private assessment links)
CREATE TABLE IF NOT EXISTS private_link (
    id BINARY(16) PRIMARY KEY,
    candidate_id BINARY(16) NOT NULL,
    candidate_name VARCHAR(255),
    
    client_id VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    
    email VARCHAR(255) NOT NULL,
    position_id BINARY(16) NOT NULL,
    position_name VARCHAR(255),
    
    question_set_id BINARY(16) NOT NULL,
    interview_platform ENUM('EXE', 'BROWSER') NOT NULL,
    
    link VARCHAR(255),
    verification_code VARCHAR(6) NOT NULL,
    
    link_active_at DATETIME(6),
    link_expires_at DATETIME(6),
    
    interview_taken BIT(1) NOT NULL DEFAULT 0,
    is_active BIT(1) NOT NULL DEFAULT 1,
    
    created_by BINARY(16),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6),
    
    INDEX idx_candidate_id (candidate_id),
    INDEX idx_position_id (position_id),
    INDEX idx_link (link),
    INDEX idx_verification_code (verification_code)
);

-- 3. Public Link Table (Self-registration public assessment links)
CREATE TABLE IF NOT EXISTS public_link (
    id BINARY(16) PRIMARY KEY,
    
    client_id VARCHAR(255) NOT NULL,
    position_id BINARY(16) NOT NULL,
    question_set_id BINARY(16) NOT NULL,
    question_section_id BINARY(16),
    tenant_id VARCHAR(255),
    
    link VARCHAR(255),
    
    active_at DATETIME(6),
    expire_at DATETIME(6),
    
    created_by BINARY(16),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6),
    
    INDEX idx_position_id (position_id),
    INDEX idx_link (link),
    INDEX idx_active_expire (active_at, expire_at)
);

-- 4. Assessment Summary Table (Detailed assessment tracking)
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
    
    is_assessment_completed BIT(1),
    is_report_generated BIT(1),
    
    -- Round 1
    round1_assigned BIT(1),
    round1_completed BIT(1),
    round1_start_time VARCHAR(255),
    round1_end_time VARCHAR(255),
    round1_time_taken VARCHAR(255),
    round1_given_time VARCHAR(20),
    
    -- Round 2
    round2_assigned BIT(1),
    round2_completed BIT(1),
    round2_start_time VARCHAR(255),
    round2_end_time VARCHAR(255),
    round2_time_taken VARCHAR(255),
    round2_given_time VARCHAR(20),
    
    -- Round 3
    round3_assigned BIT(1),
    round3_completed BIT(1),
    round3_start_time VARCHAR(255),
    round3_end_time VARCHAR(255),
    round3_time_taken VARCHAR(255),
    round3_given_time VARCHAR(20),
    
    -- Round 4
    round4_assigned BIT(1),
    round4_completed BIT(1),
    round4_start_time VARCHAR(255),
    round4_end_time VARCHAR(255),
    round4_time_taken VARCHAR(255),
    round4_given_time VARCHAR(20),
    
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    
    INDEX idx_candidate_id (candidate_id),
    INDEX idx_position_id (position_id)
);

-- 5. Assessment Report Generation Table (Report generation tracking)
CREATE TABLE IF NOT EXISTS assessment_report_generation (
    id BINARY(16) PRIMARY KEY,
    candidate_id BINARY(16) NOT NULL,
    position_id BINARY(16) NOT NULL,
    
    is_generated TINYINT(1) NOT NULL DEFAULT 0,
    
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    
    UNIQUE KEY uk_arg_candidate_position (candidate_id, position_id),
    INDEX idx_candidate_id (candidate_id),
    INDEX idx_position_id (position_id)
);

-- 6. Candidate Applied Table (Track candidate applications for positions)
CREATE TABLE IF NOT EXISTS candidate_applied (
    applied_id BINARY(16) PRIMARY KEY,
    candidate_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    position_id BINARY(16) NOT NULL,
    
    candidate_name VARCHAR(255),
    position_name VARCHAR(255),
    email VARCHAR(255),
    
    source ENUM('SELF_APPLIED', 'ADMIN_ADDED', 'REFERRAL', 'IMPORTED') NOT NULL DEFAULT 'ADMIN_ADDED',
    application_status VARCHAR(50) NOT NULL DEFAULT 'Applied',
    
    remarks TEXT,
    applied_by VARCHAR(36),
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6),
    
    INDEX idx_candidate_id (candidate_id),
    INDEX idx_organization_id (organization_id),
    INDEX idx_position_id (position_id),
    INDEX idx_applied_at (applied_at),
    INDEX idx_source (source),
    UNIQUE KEY uk_candidate_position_app (candidate_id, position_id, organization_id)
);

-- 7. Candidate Status Enum Table (Lookup table for all candidate statuses)
CREATE TABLE IF NOT EXISTS candidate_status_enum (
    status_id INT PRIMARY KEY AUTO_INCREMENT,
    status_value VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    description TEXT,
    color_code VARCHAR(10),
    sequence INT
);

INSERT IGNORE INTO candidate_status_enum (status_value, display_name, description, color_code, sequence) VALUES
('All', 'All', 'All Candidates', '#808080', 0),
('Pending', 'Pending', 'Candidate pending review', '#90A4AE', 1),
('Applied', 'Applied', 'Candidate has applied', '#2196F3', 2),
('Invited', 'Invited', 'Candidate has been invited for assessment', '#FF9800', 3),
('Manually Invited', 'Manually Invited', 'Candidate manually invited by admin', '#9C27B0', 4),
('Resume Rejected', 'Resume Rejected', 'Resume has been rejected', '#F44336', 5),
('Recommended', 'Recommended', 'Candidate recommended for next round', '#4CAF50', 6),
('Not-Recommended', 'Not-Recommended', 'Candidate not recommended', '#FF5722', 7),
('Cautiously Recommended', 'Cautiously Recommended', 'Candidate cautiously recommended', '#FFC107', 8),
('Test Started', 'Test Started', 'Candidate started assessment', '#42A5F5', 9),
('In Progress', 'In Progress', 'Assessment in progress', '#29B6F6', 10),
('Test Completed', 'Test Completed', 'Assessment test completed', '#00BCD4', 11),
('Expired', 'Expired', 'Assessment link expired', '#8D6E63', 12),
('Unattended', 'Unattended', 'Candidate did not attend', '#BDBDBD', 13),
('Network Disconnected', 'Network Disconnected', 'Assessment failed due to network', '#E91E63', 14),
('Round1', 'Round 1', 'Round 1 - Assessment', '#00ACC1', 15),
('Round2', 'Round 2', 'Round 2 - Assessment', '#0097A7', 16),
('Round3', 'Round 3', 'Round 3 - Assessment', '#0288D1', 17),
('Round4', 'Round 4', 'Round 4 - Assessment', '#1976D2', 18),
('Network Issue', 'Network Issue', 'Assessment failed due to network issue', '#E91E63', 19);

-- 8. Candidate Question Answers: removed (Q&A stored in MongoDB). Drop if exists from previous installs.
DROP TABLE IF EXISTS candidate_question_answers;

