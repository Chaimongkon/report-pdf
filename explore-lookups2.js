require("dotenv").config();
const oracledb = require("oracledb");

async function run() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const owner = "ISCODOH";
  const q = async (sql, binds) => {
    const r = await conn.execute(sql, binds || {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return r.rows;
  };

  // 1. MBUCFMEMBTYPE
  console.log("=== MBUCFMEMBTYPE (ประเภทสมาชิก) ===");
  const mt = await q(`SELECT * FROM ${owner}.MBUCFMEMBTYPE WHERE ROWNUM <= 15`);
  if (mt.length > 0) console.log("Cols:", Object.keys(mt[0]).join(", "));
  mt.forEach(r => {
    const keys = Object.keys(r);
    const short = {};
    keys.forEach(k => { if (r[k] !== null) short[k] = r[k]; });
    console.log(JSON.stringify(short));
  });

  // 2. MBMEMBMASTERSTATUSDET
  console.log("\n=== MBMEMBMASTERSTATUSDET (สถานะสมาชิก) ===");
  const st = await q(`SELECT * FROM ${owner}.MBMEMBMASTERSTATUSDET`);
  if (st.length > 0) console.log("Cols:", Object.keys(st[0]).join(", "));
  st.forEach(r => {
    const short = {};
    Object.keys(r).forEach(k => { if (r[k] !== null) short[k] = r[k]; });
    console.log(JSON.stringify(short));
  });

  // 3. PRENAME columns search
  console.log("\n=== PRENAME column search ===");
  const pn = await q(
    `SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :o AND COLUMN_NAME LIKE '%PRENAME%' ORDER BY TABLE_NAME`,
    { o: owner }
  );
  pn.forEach(r => console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME}`));

  // 4. Try to find prename lookup
  console.log("\n=== Looking for prename lookup data ===");
  const prenameGuesses = ["CMUCFPRENAME", "MBUCFPRENAME", "CMPRENAME", "HRUCFPRENAME"];
  for (const tbl of prenameGuesses) {
    try {
      const r = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 10`);
      if (r.length > 0) {
        console.log(`FOUND: ${tbl}`);
        console.log("Cols:", Object.keys(r[0]).join(", "));
        r.forEach(row => console.log(JSON.stringify(row)));
        break;
      }
    } catch { /* skip */ }
  }

  // 5. Address lookup tables
  console.log("\n=== Address lookup tables ===");
  const addr = await q(
    `SELECT TABLE_NAME, NUM_ROWS FROM ALL_TABLES WHERE OWNER = :o AND (TABLE_NAME LIKE '%PROVINCE%' OR TABLE_NAME LIKE '%DISTRICT%' OR TABLE_NAME LIKE '%TAMBOL%' OR TABLE_NAME LIKE '%AMPHUR%') ORDER BY TABLE_NAME`,
    { o: owner }
  );
  addr.forEach(r => console.log(`  ${r.TABLE_NAME} (${r.NUM_ROWS} rows)`));

  // Try to get province sample
  for (const tbl of ["CMUCFPROVINCE", "HRUCFPROVINCE", "PROVINCE"]) {
    try {
      const r = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 5`);
      if (r.length > 0) {
        console.log(`\nFOUND province: ${tbl}`);
        console.log("Cols:", Object.keys(r[0]).join(", "));
        r.forEach(row => { const s = {}; Object.keys(row).forEach(k => { if (row[k] !== null) s[k] = row[k]; }); console.log(JSON.stringify(s)); });
        break;
      }
    } catch { /* skip */ }
  }

  for (const tbl of ["CMUCFDISTRICT", "HRUCFDISTRICT", "DISTRICT"]) {
    try {
      const r = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 3`);
      if (r.length > 0) {
        console.log(`\nFOUND district: ${tbl}`);
        console.log("Cols:", Object.keys(r[0]).join(", "));
        r.forEach(row => { const s = {}; Object.keys(row).forEach(k => { if (row[k] !== null) s[k] = row[k]; }); console.log(JSON.stringify(s)); });
        break;
      }
    } catch { /* skip */ }
  }

  for (const tbl of ["CMUCFTAMBOL", "HRUCFTAMBOL", "TAMBOL"]) {
    try {
      const r = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 3`);
      if (r.length > 0) {
        console.log(`\nFOUND tambol: ${tbl}`);
        console.log("Cols:", Object.keys(r[0]).join(", "));
        r.forEach(row => { const s = {}; Object.keys(row).forEach(k => { if (row[k] !== null) s[k] = row[k]; }); console.log(JSON.stringify(s)); });
        break;
      }
    } catch { /* skip */ }
  }

  // 6. Position lookup
  console.log("\n=== Position lookup ===");
  const posTables = await q(
    `SELECT TABLE_NAME, NUM_ROWS FROM ALL_TABLES WHERE OWNER = :o AND TABLE_NAME LIKE '%POSITION%' ORDER BY TABLE_NAME`,
    { o: owner }
  );
  posTables.forEach(r => console.log(`  ${r.TABLE_NAME} (${r.NUM_ROWS} rows)`));

  for (const tbl of ["HRUCFPOSITION", "CMUCFPOSITION", "MBUCFPOSITION"]) {
    try {
      const r = await q(`SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 5`);
      if (r.length > 0) {
        console.log(`FOUND position: ${tbl}`);
        console.log("Cols:", Object.keys(r[0]).join(", "));
        r.forEach(row => { const s = {}; Object.keys(row).forEach(k => { if (row[k] !== null) s[k] = row[k]; }); console.log(JSON.stringify(s)); });
        break;
      }
    } catch { /* skip */ }
  }

  // 7. MEMBGROUP sample (already found MBUCFMEMBGROUP)
  console.log("\n=== MBUCFMEMBGROUP sample (3 rows) ===");
  try {
    const r = await q(`SELECT COOP_ID, MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${owner}.MBUCFMEMBGROUP WHERE ROWNUM <= 10 ORDER BY MEMBGROUP_CODE`);
    r.forEach(row => console.log(`  ${row.MEMBGROUP_CODE} = ${row.MEMBGROUP_DESC}`));
  } catch (e) { console.log("  Error:", e.message); }

  await conn.close();
}

run().catch(e => console.error("ERROR:", e.message));
