require("dotenv").config();
const oracledb = require("oracledb");

(async () => {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const q = async (sql) => (await conn.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;

  console.log("=== Cross-tab: MEMBER_STATUS x RESIGN_STATUS x DEAD_STATUS ===");
  const rows = await q(`
    SELECT MEMBER_STATUS, RESIGN_STATUS, DEAD_STATUS, COUNT(*) CNT
    FROM ISCODOH.MBMEMBMASTER
    GROUP BY MEMBER_STATUS, RESIGN_STATUS, DEAD_STATUS
    ORDER BY MEMBER_STATUS, RESIGN_STATUS, DEAD_STATUS
  `);
  rows.forEach(r => console.log(`MEMBER=${r.MEMBER_STATUS}  RESIGN=${r.RESIGN_STATUS}  DEAD=${r.DEAD_STATUS}  => ${r.CNT}`));

  console.log("\n=== Sample MEMBER_STATUS=1, RESIGN=0, DEAD=0 (top 3) ===");
  const active = await q(`
    SELECT MEMBER_NO, MEMB_NAME, MEMB_LNAME, MEMBTYPE_CODE, MEMBCAT_CODE, RESIGN_DATE
    FROM ISCODOH.MBMEMBMASTER
    WHERE MEMBER_STATUS = 1 AND RESIGN_STATUS = 0 AND DEAD_STATUS = 0
    AND ROWNUM <= 3
  `);
  active.forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== Sample MEMBER_STATUS=-1, RESIGN=1 (top 3) ===");
  const resigned = await q(`
    SELECT MEMBER_NO, MEMB_NAME, MEMB_LNAME, MEMBTYPE_CODE, MEMBCAT_CODE, RESIGN_DATE, RESIGN_STATUS
    FROM ISCODOH.MBMEMBMASTER
    WHERE MEMBER_STATUS = -1 AND RESIGN_STATUS = 1
    AND ROWNUM <= 3
  `);
  resigned.forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== Sample MEMBER_STATUS=1, RESIGN=1 (top 3) ===");
  const retiredResigned = await q(`
    SELECT MEMBER_NO, MEMB_NAME, MEMB_LNAME, MEMBTYPE_CODE, MEMBCAT_CODE, RESIGN_DATE, DEAD_STATUS
    FROM ISCODOH.MBMEMBMASTER
    WHERE MEMBER_STATUS = 1 AND RESIGN_STATUS = 1
    AND ROWNUM <= 3
  `);
  retiredResigned.forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== Check if MBUCFMEMBSTATUS table exists ===");
  const tbls = await q("SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER='ISCODOH' AND TABLE_NAME LIKE '%STATUS%'");
  tbls.forEach(r => console.log(r.TABLE_NAME));

  await conn.close();
})();
