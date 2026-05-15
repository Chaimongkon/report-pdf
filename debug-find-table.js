require('dotenv').config();
const db = require('./src/db/oracle');

const OWNER = 'ISCODOH';

async function findAppTable() {
  try {
    await db.initialize();

    // Count by APPL_STATUS
    const sql1 = `
      SELECT APPL_STATUS, COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      GROUP BY APPL_STATUS
      ORDER BY APPL_STATUS
    `;
    const rows1 = await db.execute(sql1, {});
    console.log('=== Count by APPL_STATUS ===');
    rows1.forEach(r => console.log(`  APPL_STATUS=${r.APPL_STATUS}: ${r.CNT}`));

    // Count by APPLTYPE_CODE  
    const sql2 = `
      SELECT a.APPLTYPE_CODE, at.APPLTYPE_DESC, COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      LEFT JOIN ${OWNER}.MBUCFAPPLTYPE at ON a.COOP_ID = at.COOP_ID AND a.APPLTYPE_CODE = at.APPLTYPE_CODE
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      GROUP BY a.APPLTYPE_CODE, at.APPLTYPE_DESC
      ORDER BY a.APPLTYPE_CODE
    `;
    const rows2 = await db.execute(sql2, {});
    console.log('\n=== Count by APPLTYPE_CODE ===');
    rows2.forEach(r => console.log(`  ${r.APPLTYPE_CODE} (${r.APPLTYPE_DESC}): ${r.CNT}`));

    // Count with APPL_STATUS=1 (approved)
    const sql3 = `
      SELECT COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      AND a.APPL_STATUS = 1
    `;
    const rows3 = await db.execute(sql3, {});
    console.log('\n=== APPL_STATUS=1 (approved) count ===');
    console.log('  Total:', rows3[0].CNT);

    // Count by APPLTYPE + STATUS=1
    const sql4 = `
      SELECT a.APPLTYPE_CODE, at.APPLTYPE_DESC, COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      LEFT JOIN ${OWNER}.MBUCFAPPLTYPE at ON a.COOP_ID = at.COOP_ID AND a.APPLTYPE_CODE = at.APPLTYPE_CODE
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      AND a.APPL_STATUS = 1
      GROUP BY a.APPLTYPE_CODE, at.APPLTYPE_DESC
      ORDER BY a.APPLTYPE_CODE
    `;
    const rows4 = await db.execute(sql4, {});
    console.log('\n=== APPL_STATUS=1 by APPLTYPE_CODE ===');
    rows4.forEach(r => console.log(`  ${r.APPLTYPE_CODE} (${r.APPLTYPE_DESC}): ${r.CNT}`));

    // Try: only "สมัครใหม่" types with APPL_STATUS=1
    const sql5 = `
      SELECT COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      LEFT JOIN ${OWNER}.MBUCFAPPLTYPE at ON a.COOP_ID = at.COOP_ID AND a.APPLTYPE_CODE = at.APPLTYPE_CODE
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      AND a.APPL_STATUS = 1
      AND TRIM(at.APPLTYPE_DESC) = 'สมัครใหม่'
    `;
    const rows5 = await db.execute(sql5, {});
    console.log('\n=== APPL_STATUS=1 + สมัครใหม่ only ===');
    console.log('  Total:', rows5[0].CNT);

    // Also try MEMBTYPE exclude
    const sql6 = `
      SELECT COUNT(*) as CNT
      FROM ${OWNER}.MBREQAPPL a
      WHERE a.APPLY_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND a.APPLY_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
      AND a.APPL_STATUS = 1
      AND a.MEMBTYPE_CODE NOT IN (
        SELECT mt2.MEMBTYPE_CODE FROM ${OWNER}.MBUCFMEMBTYPE mt2 
        WHERE mt2.COOP_ID = '056001' AND TRIM(mt2.MEMBTYPE_DESC) = 'สังกัดหน่วยงาน'
      )
    `;
    const rows6 = await db.execute(sql6, {});
    console.log('\n=== APPL_STATUS=1 + exclude สังกัดหน่วยงาน ===');
    console.log('  Total:', rows6[0].CNT);

    await db.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

findAppTable();
