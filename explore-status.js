require("dotenv").config();
const oracledb = require("oracledb");

(async () => {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const q = async (sql) => (await conn.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;

  console.log("=== MEMBER_STATUS ===");
  (await q("SELECT MEMBER_STATUS, COUNT(*) CNT FROM ISCODOH.MBMEMBMASTER GROUP BY MEMBER_STATUS ORDER BY MEMBER_STATUS")).forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== RESIGN_STATUS ===");
  (await q("SELECT RESIGN_STATUS, COUNT(*) CNT FROM ISCODOH.MBMEMBMASTER GROUP BY RESIGN_STATUS ORDER BY RESIGN_STATUS")).forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== DEAD_STATUS ===");
  (await q("SELECT DEAD_STATUS, COUNT(*) CNT FROM ISCODOH.MBMEMBMASTER GROUP BY DEAD_STATUS ORDER BY DEAD_STATUS")).forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== Combined status ===");
  const rows = await q(`
    SELECT 
      CASE 
        WHEN m.RESIGN_STATUS = 1 THEN 'resigned'
        WHEN m.DEAD_STATUS = 1 THEN 'dead'
        WHEN m.MEMBER_STATUS = 0 THEN 'normal'
        WHEN m.MEMBER_STATUS = 1 THEN 'retired'
        WHEN m.MEMBER_STATUS = 2 THEN 'expelled'
        ELSE 'other_' || m.MEMBER_STATUS
      END AS STATUS_KEY,
      COUNT(*) CNT
    FROM ISCODOH.MBMEMBMASTER m
    GROUP BY 
      CASE 
        WHEN m.RESIGN_STATUS = 1 THEN 'resigned'
        WHEN m.DEAD_STATUS = 1 THEN 'dead'
        WHEN m.MEMBER_STATUS = 0 THEN 'normal'
        WHEN m.MEMBER_STATUS = 1 THEN 'retired'
        WHEN m.MEMBER_STATUS = 2 THEN 'expelled'
        ELSE 'other_' || m.MEMBER_STATUS
      END
    ORDER BY CNT DESC
  `);
  rows.forEach(r => console.log(JSON.stringify(r)));

  await conn.close();
})();
