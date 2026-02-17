require("dotenv").config();
const oracledb = require("oracledb");

async function testConnection() {
  console.log("=== Oracle Connection Test ===\n");

  // Show config (mask password)
  const user = process.env.ORACLE_USER;
  const pass = process.env.ORACLE_PASSWORD;
  const connStr = process.env.ORACLE_CONNECTION_STRING;

  console.log(`User:              ${user}`);
  console.log(`Password:          ${pass ? "*".repeat(pass.length) : "(empty)"}`);
  console.log(`Connection String: ${connStr}`);
  console.log("");

  if (!user || !connStr) {
    console.error("ERROR: ORACLE_USER or ORACLE_CONNECTION_STRING is missing in .env");
    process.exit(1);
  }

  let connection;
  try {
    console.log("[1/3] Connecting to Oracle...");
    connection = await oracledb.getConnection({
      user: user,
      password: pass,
      connectString: connStr,
    });
    console.log("      => Connected successfully!\n");

    console.log("[2/3] Running test query: SELECT SYSDATE, USER, ORA_DATABASE_NAME FROM DUAL");
    const result = await connection.execute(
      `SELECT SYSDATE AS "CURRENT_DATE", USER AS "DB_USER", ORA_DATABASE_NAME AS "DB_NAME" FROM DUAL`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("      => Query result:");
    console.log("        ", JSON.stringify(result.rows[0], null, 2));
    console.log("");

    console.log("[3/3] Checking Oracle version...");
    const verResult = await connection.execute(
      `SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (verResult.rows.length > 0) {
      console.log("      =>", verResult.rows[0].BANNER);
    }

    console.log("\n=== ALL TESTS PASSED ===");
  } catch (err) {
    console.error("\nERROR:", err.message);
    if (err.message.includes("ORA-12541")) {
      console.error("HINT: Oracle listener is not running or host/port is wrong.");
    } else if (err.message.includes("ORA-12514")) {
      console.error("HINT: Service name in connection string is incorrect.");
    } else if (err.message.includes("ORA-01017")) {
      console.error("HINT: Username or password is incorrect.");
    } else if (err.message.includes("ORA-12170")) {
      console.error("HINT: Connection timeout - check if Oracle host is reachable.");
    } else if (err.message.includes("DPI-1047")) {
      console.error("HINT: Oracle Instant Client is not installed or not in PATH.");
      console.error("      Download: https://www.oracle.com/database/technologies/instant-client.html");
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.close();
      console.log("\nConnection closed.");
    }
  }
}

testConnection();
