const oracledb = require('oracledb');

const config = {
  user: process.env.ORACLE_USER || 'your_user',
  password: process.env.ORACLE_PASSWORD || 'your_password',
  connectString: process.env.ORACLE_CONNECTION_STRING || 'your_host:1521/your_service'
};

const OWNER = 'ISCODOH';

async function debugCount() {
  let connection;
  try {
    connection = await oracledb.getConnection(config);
    
    const sql = `
      SELECT COUNT(*) as total_count
      FROM ${OWNER}.MBMEMBMASTER m
      WHERE m.MEMBER_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
      AND m.MEMBER_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
    `;
    
    const result = await connection.execute(sql);
    console.log('Direct SQL count:', result.rows[0].TOTAL_COUNT);
    
    // Test with limit
    const sqlWithLimit = `
      SELECT COUNT(*) as limited_count
      FROM (
        SELECT m.MEMBER_NO
        FROM ${OWNER}.MBMEMBMASTER m
        WHERE m.MEMBER_DATE >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
        AND m.MEMBER_DATE <= TO_DATE('2026-03-24', 'YYYY-MM-DD')
        AND ROWNUM <= 500
      )
    `;
    
    const resultLimit = await connection.execute(sqlWithLimit);
    console.log('With limit 500:', resultLimit.rows[0].LIMITED_COUNT);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

debugCount();
