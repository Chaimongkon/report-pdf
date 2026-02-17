const oracledb = require("oracledb");

let pool = null;

/**
 * Initialize Oracle connection pool
 */
async function initialize() {
  try {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
      poolMin: 2,
      poolMax: 10,
      poolIncrement: 1,
    });
    console.log("[Oracle] Connection pool created successfully");
    return pool;
  } catch (err) {
    console.error("[Oracle] Failed to create pool:", err.message);
    throw err;
  }
}

/**
 * Execute a query and return rows
 * @param {string} sql - SQL statement
 * @param {object|array} binds - Bind parameters
 * @param {object} options - oracledb execute options
 * @returns {Promise<Array>} rows
 */
async function execute(sql, binds = {}, options = {}) {
  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...options,
    });
    return result.rows;
  } catch (err) {
    console.error("[Oracle] Query error:", err.message);
    throw err;
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

/**
 * Close the connection pool
 */
async function close() {
  try {
    if (pool) {
      await pool.close(2);
      console.log("[Oracle] Connection pool closed");
    }
  } catch (err) {
    console.error("[Oracle] Error closing pool:", err.message);
  }
}

module.exports = { initialize, execute, close };
