require("dotenv").config();
const oracledb = require("oracledb");

(async () => {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const q = async (sql) => (await conn.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;

  console.log("=== MEMBCAT_CODE distinct in MBMEMBMASTER ===");
  const cats = await q("SELECT MEMBCAT_CODE, COUNT(*) AS CNT FROM ISCODOH.MBMEMBMASTER GROUP BY MEMBCAT_CODE ORDER BY MEMBCAT_CODE");
  cats.forEach(r => console.log(JSON.stringify(r)));

  console.log("\n=== MBUCFMEMBTYPE grouped by MEMBCAT_CODE ===");
  const types = await q("SELECT MEMBCAT_CODE, MEMBTYPE_CODE, MEMBTYPE_DESC FROM ISCODOH.MBUCFMEMBTYPE WHERE COOP_ID='056001' ORDER BY MEMBCAT_CODE, MEMBTYPE_CODE");
  types.forEach(r => console.log(r.MEMBCAT_CODE.trim() + " | " + r.MEMBTYPE_CODE.trim() + " | " + r.MEMBTYPE_DESC));

  console.log("\n=== MEMBCAT columns in schema ===");
  const search = await q("SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER='ISCODOH' AND COLUMN_NAME LIKE '%MEMBCAT%' ORDER BY TABLE_NAME");
  search.forEach(r => console.log(r.TABLE_NAME + "." + r.COLUMN_NAME));

  console.log("\n=== MBUCFAPPLTYPE (might have category info) ===");
  const appl = await q("SELECT * FROM ISCODOH.MBUCFAPPLTYPE WHERE COOP_ID='056001' ORDER BY 1,2");
  appl.forEach(r => { const s = {}; Object.keys(r).forEach(k => { if (r[k] !== null) s[k] = r[k]; }); console.log(JSON.stringify(s)); });

  await conn.close();
})();
