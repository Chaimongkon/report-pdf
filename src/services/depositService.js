// src/services/depositService.js
// Oracle + Mock fallback service for Deposit reports

const db = require("../db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";

/**
 * Get dropdown lookups for Deposit form
 */
async function getDepositLookups() {
    try {
        // Try Oracle first
        const branches = [
            { BRANCH_CODE: COOP_ID, BRANCH_DESC: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด" },
        ];

        // Fetch deposit types from Oracle
        const deptTypes = await db.execute(
            `SELECT DEPTTYPE_CODE, DEPTTYPE_DESC
             FROM ${OWNER}.DPDEPTTYPE
             WHERE COOP_ID = :coopId AND DEPTUSE_FLAG = 1
             ORDER BY DEPTTYPE_CODE`,
            { coopId: COOP_ID }
        );

        return { branches, deptTypes };
    } catch (err) {
        console.warn("[DepositService] Oracle not available for lookups, using defaults:", err.message);
        return {
            branches: [
                { BRANCH_CODE: COOP_ID, BRANCH_DESC: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด" },
            ],
            deptTypes: [],
        };
    }
}

/**
 * Get RPTM0009 data from Oracle
 * Queries DPDEPTMASTER + DPDEPTPRNCFIXED for deposit accounts with balances and interest
 * @param {Object} filters - { branchCode, date, limit }
 */
async function getRptm0009Data(filters) {
    const branchDesc = "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด";
    const reportDate = filters.date
        ? new Date(filters.date).toLocaleDateString("th-TH")
        : new Date().toLocaleDateString("th-TH");
    const filterDesc = `สาขา: ${branchDesc} | ณ วันที่: ${reportDate}`;

    try {
        // Build the Oracle query
        const coopId = filters.branchCode || COOP_ID;
        const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 0;
        const useLimit = limit > 0;

        // Parse the date filter — accounts opened on or before this date
        let dateFilter = "";
        const binds = { coopId };

        if (filters.date) {
            dateFilter = " AND dm.DEPTOPEN_DATE <= TO_DATE(:filterDate, 'YYYY-MM-DD')";
            binds.filterDate = filters.date; // e.g. "2026-01-31"
        }

        if (useLimit) {
            binds.rowLimit = limit;
        }

        const sql = `
            SELECT * FROM (
                SELECT
                    ROW_NUMBER() OVER (ORDER BY dm.DEPTACCOUNT_NO, pf.PRNC_NO) AS ROW_NUM,
                    dm.DEPTACCOUNT_NO   AS ACCOUNT_NO,
                    dm.DEPTACCOUNT_NAME AS ACCOUNT_NAME,
                    NVL(pf.PRNC_BAL, dm.PRNCBAL)   AS BALANCE,
                    NVL(pf.INT_REMAIN, dm.ACCUINT_AMT) AS ACC_INTEREST,
                    pf.PRNCDUE_DATE     AS DUE_DATE,
                    dm.DEPTOPEN_DATE    AS REC_DATE,
                    dm.DEPTTYPE_CODE,
                    dm.MEMBCAT_CODE,
                    dm.MEMBER_NO,
                    pf.PRNC_NO,
                    pf.PRNC_AMT,
                    pf.INTEREST_RATE,
                    pf.PRNCDUE_NMONTH
                FROM ${OWNER}.DPDEPTMASTER dm
                LEFT JOIN ${OWNER}.DPDEPTPRNCFIXED pf
                    ON dm.COOP_ID = pf.COOP_ID
                    AND dm.DEPTACCOUNT_NO = pf.DEPTACCOUNT_NO
                WHERE dm.COOP_ID = :coopId
                  AND dm.DEPTCLOSE_STATUS = 0
                  ${dateFilter}
                ORDER BY dm.DEPTACCOUNT_NO, pf.PRNC_NO
            )${useLimit ? " WHERE ROW_NUM <= :rowLimit" : ""}
        `;

        console.log("[DepositService] Executing RPTM0009 query...");
        const rows = await db.execute(sql, binds);
        console.log(`[DepositService] Found ${rows.length} records`);

        // Map to report format
        const records = rows.map((r) => ({
            ROW_NUM: r.ROW_NUM,
            REC_DATE: r.REC_DATE,
            ACCOUNT_NO: r.ACCOUNT_NO ? r.ACCOUNT_NO.trim() : "",
            ACCOUNT_NAME: r.ACCOUNT_NAME ? r.ACCOUNT_NAME.trim() : "",
            BALANCE: r.BALANCE || 0,
            ACC_INTEREST: r.ACC_INTEREST || 0,
            DUE_DATE: r.DUE_DATE,
            DEPTTYPE_CODE: r.DEPTTYPE_CODE ? r.DEPTTYPE_CODE.trim() : "",
            MEMBCAT_CODE: r.MEMBCAT_CODE ? r.MEMBCAT_CODE.trim() : "",
            MEMBER_NO: r.MEMBER_NO ? r.MEMBER_NO.trim() : "",
            PRNC_NO: r.PRNC_NO,
            PRNC_AMT: r.PRNC_AMT || 0,
            INTEREST_RATE: r.INTEREST_RATE || 0,
            PRNCDUE_NMONTH: r.PRNCDUE_NMONTH || 0,
        }));

        return { filterDesc, records };
    } catch (err) {
        console.error("[DepositService] Oracle query failed, falling back to mock:", err.message);
        return getRptm0009DataMock(filters, filterDesc);
    }
}

/**
 * Mock fallback for RPTM0009 when Oracle is not available
 */
function getRptm0009DataMock(filters, filterDesc) {
    const limit = filters.limit || 500;
    const firstNames = ["ธีระศักดิ์", "นุชธรา", "จิรัชญา", "วิวัฒน์ชัย", "ศุภโกวิท", "ประเสริฐ", "กัลยาณ์", "ธิดารัตน์"];
    const lastNames = ["จันนามวงศ์", "ชูรัตน์", "เหลืองทองวณิช", "ชัยวังราช", "รัตนภิรมย์", "ทิณวงศ์โพธิ์"];

    const records = [];
    for (let i = 0; i < limit; i++) {
        const fName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lName = lastNames[Math.floor(Math.random() * lastNames.length)];
        const accMiddle = Math.floor(10000 + Math.random() * 90000);
        const accEnd = Math.floor(Math.random() * 10);
        const balance = 1000 + Math.random() * 999000;
        const accInt = balance * (0.01 + Math.random() * 0.04);
        const dueDate = new Date(2025 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)).toISOString();
        const recDate = filters.date ? new Date(filters.date).toISOString() : new Date().toISOString();

        records.push({
            ROW_NUM: i + 1,
            REC_DATE: recDate,
            ACCOUNT_NO: `007-0-${accMiddle}-${accEnd}`,
            ACCOUNT_NAME: `นาย/นาง/นางสาว ${fName} ${lName}`,
            BALANCE: parseFloat(balance.toFixed(2)),
            ACC_INTEREST: parseFloat(accInt.toFixed(2)),
            DUE_DATE: dueDate,
        });
    }

    return { filterDesc, records };
}

module.exports = {
    getDepositLookups,
    getRptm0009Data,
};
