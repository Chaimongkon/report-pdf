require("dotenv").config();
const oracledb = require("oracledb");

async function exploreLookups() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
    });

    const owner = "ISCODOH";

    // 1. MBUCFMEMBTYPE — ประเภทสมาชิก
    console.log("=== MBUCFMEMBTYPE (ประเภทสมาชิก) ===");
    const membTypes = await connection.execute(
      `SELECT * FROM ${owner}.MBUCFMEMBTYPE ORDER BY 1,2`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log(`Columns: ${Object.keys(membTypes.rows[0] || {}).join(", ")}`);
    for (const r of membTypes.rows.slice(0, 20)) {
      console.log(" ", JSON.stringify(r));
    }

    // 2. MBUCFAPPLTYPE — ประเภทคำขอ
    console.log("\n=== MBUCFAPPLTYPE (ประเภทคำขอ) ===");
    const applTypes = await connection.execute(
      `SELECT * FROM ${owner}.MBUCFAPPLTYPE ORDER BY 1,2`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log(`Columns: ${Object.keys(applTypes.rows[0] || {}).join(", ")}`);
    for (const r of applTypes.rows.slice(0, 20)) {
      console.log(" ", JSON.stringify(r));
    }

    // 3. Find prename lookup - search all tables for PRENAME
    console.log("\n=== SEARCHING FOR PRENAME LOOKUP TABLE ===");
    const prenameSearch = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_COLUMNS 
       WHERE OWNER = :owner AND COLUMN_NAME LIKE '%PRENAME%'
       ORDER BY TABLE_NAME`,
      { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of prenameSearch.rows) {
      console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME}`);
    }

    // 4. Try common prename table names
    const prenameGuesses = ["CMUCFPRENAME", "MBUCFPRENAME", "UCFPRENAME", "CMPRENAME"];
    for (const tbl of prenameGuesses) {
      try {
        const r = await connection.execute(
          `SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 10`,
          {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (r.rows.length > 0) {
          console.log(`\n=== ${tbl} (FOUND!) ===`);
          console.log(`Columns: ${Object.keys(r.rows[0]).join(", ")}`);
          for (const row of r.rows) console.log(" ", JSON.stringify(row));
        }
      } catch { /* table doesn't exist */ }
    }

    // 5. Find province/district/tambol lookup tables
    console.log("\n=== SEARCHING FOR ADDRESS LOOKUP TABLES ===");
    const addrSearch = await connection.execute(
      `SELECT TABLE_NAME, NUM_ROWS FROM ALL_TABLES 
       WHERE OWNER = :owner 
         AND (TABLE_NAME LIKE '%PROVINCE%' OR TABLE_NAME LIKE '%DISTRICT%' 
              OR TABLE_NAME LIKE '%TAMBOL%' OR TABLE_NAME LIKE '%AMPHUR%'
              OR TABLE_NAME LIKE '%ADDRESS%' OR TABLE_NAME LIKE '%ZIPCODE%')
       ORDER BY TABLE_NAME`,
      { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of addrSearch.rows) {
      console.log(`  ${r.TABLE_NAME.padEnd(40)} rows: ${r.NUM_ROWS}`);
    }

    // Try to find the address tables
    for (const tbl of ["CMUCFPROVINCE", "CMUCFDISTRICT", "CMUCFTAMBOL"]) {
      try {
        const r = await connection.execute(
          `SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 5`,
          {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (r.rows.length > 0) {
          console.log(`\n=== ${tbl} (FOUND!) ===`);
          console.log(`Columns: ${Object.keys(r.rows[0]).join(", ")}`);
          for (const row of r.rows) console.log(" ", JSON.stringify(row));
        }
      } catch { /* table doesn't exist */ }
    }

    // 6. MBMEMBMASTERSTATUSDET — สถานะสมาชิก
    console.log("\n=== MBMEMBMASTERSTATUSDET (สถานะสมาชิก 7 rows) ===");
    try {
      const statuses = await connection.execute(
        `SELECT * FROM ${owner}.MBMEMBMASTERSTATUSDET ORDER BY 1,2`,
        {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      console.log(`Columns: ${Object.keys(statuses.rows[0] || {}).join(", ")}`);
      for (const r of statuses.rows) {
        console.log(" ", JSON.stringify(r));
      }
    } catch (e) { console.log("  Error:", e.message); }

    // 7. POSITION lookup
    console.log("\n=== SEARCHING FOR POSITION LOOKUP TABLE ===");
    const posSearch = await connection.execute(
      `SELECT TABLE_NAME, NUM_ROWS FROM ALL_TABLES 
       WHERE OWNER = :owner 
         AND (TABLE_NAME LIKE '%POSITION%' OR TABLE_NAME LIKE '%HRUCF%')
       ORDER BY TABLE_NAME`,
      { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of posSearch.rows) {
      console.log(`  ${r.TABLE_NAME.padEnd(40)} rows: ${r.NUM_ROWS}`);
    }

    // 8. MEMBGROUP lookup
    console.log("\n=== SEARCHING FOR MEMBGROUP LOOKUP TABLE ===");
    const grpSearch = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_COLUMNS 
       WHERE OWNER = :owner AND COLUMN_NAME LIKE '%MEMBGROUP%'
       ORDER BY TABLE_NAME`,
      { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of grpSearch.rows) {
      console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME}`);
    }

    // Try common group table names
    for (const tbl of ["MBUCFMEMBGROUP", "CMUCFMEMBGROUP", "MBMEMBGROUP"]) {
      try {
        const r = await connection.execute(
          `SELECT * FROM ${owner}.${tbl} WHERE ROWNUM <= 10`,
          {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (r.rows.length > 0) {
          console.log(`\n=== ${tbl} (FOUND!) ===`);
          console.log(`Columns: ${Object.keys(r.rows[0]).join(", ")}`);
          for (const row of r.rows.slice(0, 10)) console.log(" ", JSON.stringify(row));
          if (r.rows.length > 10) console.log(`  ... and ${r.rows.length - 10} more`);
        }
      } catch { /* table doesn't exist */ }
    }

  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    if (connection) await connection.close();
  }
}

exploreLookups();
