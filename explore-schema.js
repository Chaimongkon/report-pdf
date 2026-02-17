require("dotenv").config();
const oracledb = require("oracledb");
const fs = require("fs");

async function exploreSchema() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
    });

    const owner = "ISCODOH";
    let report = "";
    const log = (msg) => {
      console.log(msg);
      report += msg + "\n";
    };

    log(`\n${"=".repeat(70)}`);
    log(`  ORACLE SCHEMA EXPLORER — Owner: ${owner}`);
    log(`  DB: ${(await connection.execute("SELECT ORA_DATABASE_NAME FROM DUAL", {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows[0].ORA_DATABASE_NAME}`);
    log(`  Date: ${new Date().toLocaleString("th-TH")}`);
    log(`${"=".repeat(70)}\n`);

    // 1. List all tables
    log("[ 1 ] ALL TABLES");
    log("-".repeat(70));
    const tables = await connection.execute(
      `SELECT TABLE_NAME, NUM_ROWS, LAST_ANALYZED 
       FROM ALL_TABLES 
       WHERE OWNER = :owner 
       ORDER BY TABLE_NAME`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const t of tables.rows) {
      log(`  ${t.TABLE_NAME.padEnd(40)} rows: ${String(t.NUM_ROWS ?? "?").padStart(10)}  analyzed: ${t.LAST_ANALYZED || "N/A"}`);
    }
    log(`\n  Total tables: ${tables.rows.length}\n`);

    // 2. Detail for MBMEMBMASTER
    log("[ 2 ] MBMEMBMASTER — COLUMNS");
    log("-".repeat(70));
    const cols = await connection.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE, COLUMN_ID
       FROM ALL_TAB_COLUMNS 
       WHERE OWNER = :owner AND TABLE_NAME = 'MBMEMBMASTER'
       ORDER BY COLUMN_ID`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const c of cols.rows) {
      const nullable = c.NULLABLE === "Y" ? "NULL" : "NOT NULL";
      log(`  ${String(c.COLUMN_ID).padStart(3)}. ${c.COLUMN_NAME.padEnd(35)} ${(c.DATA_TYPE + "(" + c.DATA_LENGTH + ")").padEnd(20)} ${nullable}`);
    }
    log(`\n  Total columns: ${cols.rows.length}\n`);

    // 3. Sample data from MBMEMBMASTER (first 3 rows)
    log("[ 3 ] MBMEMBMASTER — SAMPLE DATA (3 rows)");
    log("-".repeat(70));
    const sample = await connection.execute(
      `SELECT * FROM ${owner}.MBMEMBMASTER WHERE ROWNUM <= 3`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (let i = 0; i < sample.rows.length; i++) {
      log(`\n  --- Row ${i + 1} ---`);
      for (const [key, val] of Object.entries(sample.rows[i])) {
        const display = val instanceof Date ? val.toISOString() : (val === null ? "(null)" : String(val).substring(0, 80));
        log(`    ${key.padEnd(35)} = ${display}`);
      }
    }

    // 4. Find tables that likely relate to MBMEMBMASTER
    log(`\n\n[ 4 ] TABLES WITH 'MB' PREFIX (likely member-related)`);
    log("-".repeat(70));
    const mbTables = await connection.execute(
      `SELECT TABLE_NAME, NUM_ROWS 
       FROM ALL_TABLES 
       WHERE OWNER = :owner AND TABLE_NAME LIKE 'MB%'
       ORDER BY TABLE_NAME`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const t of mbTables.rows) {
      log(`  ${t.TABLE_NAME.padEnd(40)} rows: ${String(t.NUM_ROWS ?? "?").padStart(10)}`);
    }

    // 5. Find columns across all tables that contain 'MEMB' (potential FK to MBMEMBMASTER)
    log(`\n\n[ 5 ] COLUMNS CONTAINING 'MEMB' (potential JOIN keys)`);
    log("-".repeat(70));
    const membCols = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH
       FROM ALL_TAB_COLUMNS 
       WHERE OWNER = :owner AND COLUMN_NAME LIKE '%MEMB%'
       ORDER BY TABLE_NAME, COLUMN_NAME`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let prevTable = "";
    for (const c of membCols.rows) {
      if (c.TABLE_NAME !== prevTable) {
        log(`\n  [${c.TABLE_NAME}]`);
        prevTable = c.TABLE_NAME;
      }
      log(`    ${c.COLUMN_NAME.padEnd(35)} ${c.DATA_TYPE}(${c.DATA_LENGTH})`);
    }

    // 6. Foreign keys on MBMEMBMASTER
    log(`\n\n[ 6 ] FOREIGN KEYS referencing MBMEMBMASTER`);
    log("-".repeat(70));
    const fks = await connection.execute(
      `SELECT a.TABLE_NAME AS CHILD_TABLE, 
              a.COLUMN_NAME AS CHILD_COLUMN,
              b.TABLE_NAME AS PARENT_TABLE,
              b.COLUMN_NAME AS PARENT_COLUMN,
              c.CONSTRAINT_NAME
       FROM ALL_CONS_COLUMNS a
       JOIN ALL_CONSTRAINTS c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND a.OWNER = c.OWNER
       JOIN ALL_CONS_COLUMNS b ON c.R_CONSTRAINT_NAME = b.CONSTRAINT_NAME AND c.R_OWNER = b.OWNER
       WHERE c.CONSTRAINT_TYPE = 'R' 
         AND c.OWNER = :owner
         AND (b.TABLE_NAME = 'MBMEMBMASTER' OR a.TABLE_NAME = 'MBMEMBMASTER')
       ORDER BY a.TABLE_NAME`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (fks.rows.length === 0) {
      log("  (No foreign key constraints found — JOINs may be implicit/undocumented)");
    }
    for (const fk of fks.rows) {
      log(`  ${fk.CHILD_TABLE}.${fk.CHILD_COLUMN}  -->  ${fk.PARENT_TABLE}.${fk.PARENT_COLUMN}  [${fk.CONSTRAINT_NAME}]`);
    }

    // 7. Look for code/lookup tables (common pattern: short tables with CODE/NAME)
    log(`\n\n[ 7 ] LIKELY LOOKUP/CODE TABLES (< 500 rows, name contains CODE/TYPE/STATUS/MST)`);
    log("-".repeat(70));
    const lookups = await connection.execute(
      `SELECT TABLE_NAME, NUM_ROWS
       FROM ALL_TABLES 
       WHERE OWNER = :owner 
         AND NUM_ROWS IS NOT NULL AND NUM_ROWS < 500
         AND (TABLE_NAME LIKE '%CODE%' OR TABLE_NAME LIKE '%TYPE%' 
              OR TABLE_NAME LIKE '%STATUS%' OR TABLE_NAME LIKE '%MST%'
              OR TABLE_NAME LIKE '%MASTER%' OR TABLE_NAME LIKE '%LOOKUP%'
              OR TABLE_NAME LIKE '%REF%')
       ORDER BY TABLE_NAME`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    for (const t of lookups.rows) {
      log(`  ${t.TABLE_NAME.padEnd(40)} rows: ${String(t.NUM_ROWS).padStart(6)}`);
    }

    // Save report to file
    const outputPath = "./output/schema_report.txt";
    if (!fs.existsSync("./output")) fs.mkdirSync("./output", { recursive: true });
    fs.writeFileSync(outputPath, report, "utf-8");
    console.log(`\n>>> Full report saved to: ${outputPath}`);

  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    if (connection) await connection.close();
  }
}

exploreSchema();
