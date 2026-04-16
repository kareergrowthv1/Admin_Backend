const db = require('../src/config/db');

async function tableExists(schema, table) {
  const rows = await db.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      LIMIT 1`,
    [schema, table]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function syncTenant(tenantDb) {
  const hasInterviewEvaluations = await tableExists(tenantDb, 'interview_evaluations');
  if (!hasInterviewEvaluations) {
    console.log(`[sync-report-status] ${tenantDb}: skipped (no interview_evaluations)`);
    return { cp: 0, pc: 0, jc: 0 };
  }

  const hasCandidatePositions = await tableExists(tenantDb, 'candidate_positions');
  const hasPositionCandidates = await tableExists(tenantDb, 'position_candidates');
  const hasJobCandidates = await tableExists(tenantDb, 'job_candidates');

  let cp = 0;
  let pc = 0;
  let jc = 0;

  if (hasCandidatePositions) {
    const cpRes = await db.query(
      `UPDATE \`${tenantDb}\`.candidate_positions cp
          JOIN \`${tenantDb}\`.interview_evaluations ie
            ON UPPER(REPLACE(cp.position_id, '-', '')) = UPPER(HEX(ie.position_id))
           AND UPPER(REPLACE(cp.candidate_id, '-', '')) = UPPER(HEX(ie.candidate_id))
          JOIN \`candidates_db\`.assessment_report_generation arg
            ON arg.position_id = ie.position_id
           AND arg.candidate_id = ie.candidate_id
         SET cp.recommendation_status = UPPER(ie.recommendation_status),
             cp.status = UPPER(ie.recommendation_status),
             cp.updated_at = NOW()
       WHERE arg.is_generated = 1
         AND UPPER(COALESCE(ie.recommendation_status, '')) IN ('RECOMMENDED', 'CAUTIOUSLY_RECOMMENDED', 'NOT_RECOMMENDED')
         AND (
           UPPER(COALESCE(cp.status, '')) = 'TEST_COMPLETED'
           OR UPPER(COALESCE(cp.recommendation_status, '')) = 'TEST_COMPLETED'
         )`,
      []
    );
    cp = Number(cpRes?.affectedRows || 0);
  }

  if (hasPositionCandidates) {
    const pcRes = await db.query(
      `UPDATE \`${tenantDb}\`.position_candidates pc
          JOIN \`${tenantDb}\`.interview_evaluations ie
            ON pc.position_id = ie.position_id
           AND pc.candidate_id = ie.candidate_id
          JOIN \`candidates_db\`.assessment_report_generation arg
            ON arg.position_id = ie.position_id
           AND arg.candidate_id = ie.candidate_id
         SET pc.recommendation = UPPER(ie.recommendation_status),
             pc.updated_at = NOW()
       WHERE arg.is_generated = 1
         AND UPPER(COALESCE(ie.recommendation_status, '')) IN ('RECOMMENDED', 'CAUTIOUSLY_RECOMMENDED', 'NOT_RECOMMENDED')
         AND UPPER(COALESCE(pc.recommendation, '')) = 'TEST_COMPLETED'`,
      []
    );
    pc = Number(pcRes?.affectedRows || 0);
  }

  if (hasJobCandidates) {
    const jcRes = await db.query(
      `UPDATE \`${tenantDb}\`.job_candidates jc
          JOIN \`${tenantDb}\`.interview_evaluations ie
            ON jc.job_id = ie.position_id
           AND jc.candidate_id = ie.candidate_id
          JOIN \`candidates_db\`.assessment_report_generation arg
            ON arg.position_id = ie.position_id
           AND arg.candidate_id = ie.candidate_id
         SET jc.recommendation = UPPER(ie.recommendation_status),
             jc.updated_at = NOW()
       WHERE arg.is_generated = 1
         AND UPPER(COALESCE(ie.recommendation_status, '')) IN ('RECOMMENDED', 'CAUTIOUSLY_RECOMMENDED', 'NOT_RECOMMENDED')
         AND UPPER(COALESCE(jc.recommendation, '')) = 'TEST_COMPLETED'`,
      []
    );
    jc = Number(jcRes?.affectedRows || 0);
  }

  console.log(`[sync-report-status] ${tenantDb}: candidate_positions=${cp}, position_candidates=${pc}, job_candidates=${jc}`);
  return { cp, pc, jc };
}

async function main() {
  try {
    await db.initializePool();

    const tenantRows = await db.authQuery(
      `SELECT DISTINCT client AS tenantDb
         FROM auth_db.users
        WHERE is_admin = 1
          AND client IS NOT NULL
          AND TRIM(client) <> ''`,
      []
    );

    const tenantDbs = (tenantRows || [])
      .map((r) => String(r.tenantDb || '').trim())
      .filter(Boolean);

    if (tenantDbs.length === 0) {
      console.log('[sync-report-status] no tenant databases found');
      process.exit(0);
    }

    let totalCp = 0;
    let totalPc = 0;
    let totalJc = 0;

    for (const tenantDb of tenantDbs) {
      try {
        const out = await syncTenant(tenantDb);
        totalCp += out.cp;
        totalPc += out.pc;
        totalJc += out.jc;
      } catch (err) {
        console.warn(`[sync-report-status] ${tenantDb}: failed - ${err.message}`);
      }
    }

    console.log(`[sync-report-status] done. updated candidate_positions=${totalCp}, position_candidates=${totalPc}, job_candidates=${totalJc}`);
    process.exit(0);
  } catch (err) {
    console.error('[sync-report-status] fatal:', err.message || err);
    process.exit(1);
  }
}

main();
