require("dotenv").config();
const db = require("./src/db/oracle");
const OWNER = process.env.DB_OWNER || "ISCODOH";

async function check() {
  try {
    await db.initialize();
    // Check all DEPTTYPE_CODE values
    const types = await db.execute(
      `SELECT dt.DEPTTYPE_CODE, dt.DEPTTYPE_DESC, COUNT(dm.DEPTACCOUNT_NO) as CNT
       FROM ${OWNER}.DPDEPTTYPE dt
       LEFT JOIN ${OWNER}.DPDEPTMASTER dm ON dt.COOP_ID = dm.COOP_ID AND dt.DEPTTYPE_CODE = dm.DEPTTYPE_CODE AND dm.DEPTCLOSE_STATUS = 0
       GROUP BY dt.DEPTTYPE_CODE, dt.DEPTTYPE_DESC
       ORDER BY dt.DEPTTYPE_CODE`
    );
    console.log("=== DEPTTYPE_CODE list ===");
    types.forEach(r => console.log(`  Code: '${r.DEPTTYPE_CODE}' | Desc: ${r.DEPTTYPE_DESC} | Active accounts: ${r.CNT}`));

    // Also check sample deposit accounts for a known member
    const sample = await db.execute(
      `SELECT dm.MEMBER_NO, dm.DEPTTYPE_CODE, dm.DEPTACCOUNT_NO, dm.DEPTCLOSE_STATUS
       FROM ${OWNER}.DPDEPTMASTER dm
       WHERE dm.DEPTCLOSE_STATUS = 0
       AND ROWNUM <= 10
       ORDER BY dm.MEMBER_NO`
    );
    console.log("\n=== Sample deposit accounts ===");
    sample.forEach(r => console.log(`  Member: ${r.MEMBER_NO} | Type: '${r.DEPTTYPE_CODE}' | Account: ${r.DEPTACCOUNT_NO}`));

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
check();
