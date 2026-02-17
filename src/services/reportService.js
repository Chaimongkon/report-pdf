const path = require("path");
const fs = require("fs");
const db = require("../db/oracle");

/**
 * Fetch sales report data from Oracle
 * @param {object} params - { startDate, endDate, department }
 * @returns {Promise<object>} report data for template
 */
async function getSalesReportData(params = {}) {
  const { startDate, endDate, department } = params;

  // Main summary query
  const summarySQL = `
    SELECT 
      TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI') AS REPORT_DATE,
      COUNT(*) AS TOTAL_ORDERS,
      NVL(SUM(TOTAL_AMOUNT), 0) AS TOTAL_REVENUE,
      NVL(AVG(TOTAL_AMOUNT), 0) AS AVG_ORDER_VALUE
    FROM ORDERS
    WHERE ORDER_DATE BETWEEN TO_DATE(:startDate, 'YYYY-MM-DD') 
                         AND TO_DATE(:endDate, 'YYYY-MM-DD')
  `;

  // Detail query
  const detailSQL = `
    SELECT 
      O.ORDER_ID,
      C.CUSTOMER_NAME,
      O.ORDER_DATE,
      O.TOTAL_AMOUNT,
      O.STATUS
    FROM ORDERS O
    JOIN CUSTOMERS C ON O.CUSTOMER_ID = C.CUSTOMER_ID
    WHERE O.ORDER_DATE BETWEEN TO_DATE(:startDate, 'YYYY-MM-DD') 
                           AND TO_DATE(:endDate, 'YYYY-MM-DD')
    ORDER BY O.ORDER_DATE DESC
  `;

  const binds = {
    startDate: startDate || "2024-01-01",
    endDate: endDate || "2024-12-31",
  };

  try {
    const [summary, details] = await Promise.all([
      db.execute(summarySQL, binds),
      db.execute(detailSQL, binds),
    ]);

    return {
      reportTitle: "Sales Report",
      generatedAt: summary[0]?.REPORT_DATE || new Date().toLocaleString("th-TH"),
      period: { startDate: binds.startDate, endDate: binds.endDate },
      department: department || "All",
      summary: summary[0] || {},
      details: details || [],
    };
  } catch (err) {
    console.error("[ReportService] Error fetching sales data:", err.message);
    throw err;
  }
}

/**
 * Fetch data using a custom SQL query
 * @param {string} sql - SQL query
 * @param {object} binds - Bind parameters
 * @returns {Promise<Array>} rows
 */
async function getCustomReportData(sql, binds = {}) {
  return db.execute(sql, binds);
}

/**
 * Get mock data for testing without Oracle connection
 */
function getMockSalesData() {
  return {
    reportTitle: "Sales Report (Demo)",
    generatedAt: new Date().toLocaleString("th-TH"),
    period: { startDate: "2024-01-01", endDate: "2024-12-31" },
    department: "All",
    summary: {
      TOTAL_ORDERS: 156,
      TOTAL_REVENUE: 1250000,
      AVG_ORDER_VALUE: 8012.82,
    },
    details: [
      { ORDER_ID: 1001, CUSTOMER_NAME: "บริษัท ABC จำกัด", ORDER_DATE: "2024-03-15", TOTAL_AMOUNT: 45000, STATUS: "Completed" },
      { ORDER_ID: 1002, CUSTOMER_NAME: "บริษัท XYZ จำกัด", ORDER_DATE: "2024-03-14", TOTAL_AMOUNT: 32500, STATUS: "Completed" },
      { ORDER_ID: 1003, CUSTOMER_NAME: "ห้างหุ้นส่วน DEF", ORDER_DATE: "2024-03-13", TOTAL_AMOUNT: 18750, STATUS: "Pending" },
      { ORDER_ID: 1004, CUSTOMER_NAME: "บริษัท GHI จำกัด (มหาชน)", ORDER_DATE: "2024-03-12", TOTAL_AMOUNT: 67200, STATUS: "Completed" },
      { ORDER_ID: 1005, CUSTOMER_NAME: "ร้าน JKL", ORDER_DATE: "2024-03-11", TOTAL_AMOUNT: 12300, STATUS: "Cancelled" },
      { ORDER_ID: 1006, CUSTOMER_NAME: "บริษัท MNO จำกัด", ORDER_DATE: "2024-03-10", TOTAL_AMOUNT: 95400, STATUS: "Completed" },
      { ORDER_ID: 1007, CUSTOMER_NAME: "บริษัท PQR จำกัด", ORDER_DATE: "2024-03-09", TOTAL_AMOUNT: 28600, STATUS: "Pending" },
      { ORDER_ID: 1008, CUSTOMER_NAME: "ห้างหุ้นส่วน STU", ORDER_DATE: "2024-03-08", TOTAL_AMOUNT: 51800, STATUS: "Completed" },
    ],
  };
}

module.exports = { getSalesReportData, getCustomReportData, getMockSalesData };
