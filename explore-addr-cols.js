require("dotenv").config();
const oracledb = require("oracledb");

async function run() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const owner = "ISCODOH";
  const q = async (sql, b) => (await conn.execute(sql, b || {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;

  const tables = ["MBUCFPROVINCE", "MBUCFDISTRICT", "MBUCFTAMBOL", "MBUCFPOSITION"];
  for (const tbl of tables) {
    console.log(`\n=== ${tbl} — COLUMNS ===`);
    const cols = await q(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, COLUMN_ID FROM ALL_TAB_COLUMNS WHERE OWNER = :o AND TABLE_NAME = :t ORDER BY COLUMN_ID`,
      { o: owner, t: tbl }
    );
    cols.forEach(c => console.log(`  ${String(c.COLUMN_ID).padStart(2)}. ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE}(${c.DATA_LENGTH})`));

    console.log(`--- SAMPLE (2 rows) ---`);
    const sample = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 2`);
    sample.forEach(r => {
      const s = {};
      Object.keys(r).forEach(k => { if (r[k] !== null) s[k] = r[k]; });
      console.log(`  ${JSON.stringify(s)}`);
    });
  }

  await conn.close();
}
run().catch(e => console.error("ERROR:", e.message));
