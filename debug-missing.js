require('dotenv').config();
const db = require('./src/db/oracle');

const OWNER = 'ISCODOH';

async function debugMissing() {
  try {
    await db.initialize();

    // Check these 2 members directly - no filters, search with LIKE
    const sql = `
      SELECT 
        m.MEMBER_NO,
        m.MEMBER_DATE,
        m.MEMBTYPE_CODE,
        mt.MEMBTYPE_DESC,
        m.RESIGN_STATUS,
        m.DEAD_STATUS,
        m.MEMBER_STATUS,
        m.RETIRE_STATUS
      FROM ${OWNER}.MBMEMBMASTER m
      LEFT JOIN ${OWNER}.MBUCFMEMBTYPE mt ON m.COOP_ID = mt.COOP_ID AND m.MEMBTYPE_CODE = mt.MEMBTYPE_CODE
      WHERE m.MEMBER_NO LIKE '%35402' OR m.MEMBER_NO LIKE '%35403'
    `;

    const rows = await db.execute(sql, {});
    console.log('=== Members 35402 & 35403 ===');
    rows.forEach(r => {
      console.log(`MEMBER_NO: ${r.MEMBER_NO}, MEMBER_DATE: ${r.MEMBER_DATE}, MEMBTYPE_CODE: ${r.MEMBTYPE_CODE}, MEMBTYPE_DESC: ${r.MEMBTYPE_DESC}, RESIGN_STATUS: ${r.RESIGN_STATUS}, DEAD_STATUS: ${r.DEAD_STATUS}, MEMBER_STATUS: ${r.MEMBER_STATUS}, RETIRE_STATUS: ${r.RETIRE_STATUS}`);
    });

    // Check the excluded member type
    const sql2 = `
      SELECT MEMBTYPE_CODE, MEMBTYPE_DESC 
      FROM ${OWNER}.MBUCFMEMBTYPE 
      WHERE COOP_ID = '056001' AND TRIM(MEMBTYPE_DESC) = 'สังกัดหน่วยงาน'
    `;
    const rows2 = await db.execute(sql2, {});
    console.log('\n=== Excluded MembType (สังกัดหน่วยงาน) ===');
    rows2.forEach(r => console.log(`MEMBTYPE_CODE: ${r.MEMBTYPE_CODE}, MEMBTYPE_DESC: "${r.MEMBTYPE_DESC}"`));

    await db.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

debugMissing();
