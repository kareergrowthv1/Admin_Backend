const db = require('../src/config/db');

async function seed() {
    try {
        await db.initializePool();
        const database = 'candidates_db';
        console.log('--- Seeding Requested ATS Stages ---');

        const defaultStages = [
            ['active_candidates', 'Active', 'Potential candidates for this job', 'User', 'bg-slate-50 border-slate-200 text-slate-500', 0, 1],
            ['invitations', 'Invited', 'Candidates who have been invited to this job', 'Mail', 'bg-indigo-50 border-indigo-100 text-indigo-500', 1, 0],
            ['ai_test', 'KareerGrowth Assessment', 'Candidates undergoing AI screening', 'Bot', 'bg-purple-50 border-purple-100 text-purple-500', 2, 0],
            ['recommended', 'Recommended', 'Profiles strongly recommended by AI', 'CheckCircle', 'bg-emerald-50 border-emerald-100 text-emerald-500', 3, 0],
            ['not_recommended', 'Not Recommended', 'Profiles flagged as not suitable', 'XCircle', 'bg-rose-50 border-rose-100 text-rose-500', 4, 0],
            ['cautious', 'Cautiously Recommended', 'Profiles requiring human review', 'Activity', 'bg-amber-50 border-amber-100 text-amber-500', 5, 0],
            ['rejected', 'Rejected', 'Candidates rejected after review', 'UserX', 'bg-rose-100 border-rose-200 text-rose-600', 6, 0],
            ['resume_rejected', 'Resume Rejected', 'Candidates whose resumes did not match', 'FileX', 'bg-slate-100 border-slate-200 text-slate-600', 7, 0],
            ['scheduled', 'Schedule Interview', 'Candidates scheduled for human interview', 'Calendar', 'bg-blue-50 border-blue-100 text-blue-500', 8, 0],
            ['hr_round', 'HR Round', 'Candidates selected for HR review', 'UserCheck', 'bg-amber-50 border-amber-100 text-amber-500', 9, 0],
            ['shortlisted', 'Shortlisted', 'Candidates finalized for offer', 'Award', 'bg-emerald-50 border-emerald-100 text-emerald-500', 10, 0],
            ['offer', 'Offer letter sent', 'Candidates who have been sent an offer letter', 'Send', 'bg-sky-50 border-sky-100 text-sky-500', 11, 0]
        ];

        for (const stage of defaultStages) {
            await db.query(
                `INSERT INTO \`${database}\`.\`ats_job_stages\` (stage_id, title, description, icon, color, sort_order, is_fixed) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE title = VALUES(title), color = VALUES(color), sort_order = VALUES(sort_order)`,
                stage
            );
        }

        console.log('--- Seeding Complete ---');
        process.exit(0);
    } catch (error) {
        console.error('Seed failed:', error);
        process.exit(1);
    }
}

seed();
