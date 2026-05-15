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

        // Bind variables — DPDEPTINTREMAIN's OPERATE_DATE filter implicitly restricts to accounts
        // with a snapshot row at the report date, so DEPTCLOSE/DEPTOPEN filters are no longer needed.
        const binds = { coopId };
        binds.rateDate = filters.date || new Date().toISOString().slice(0, 10);

        if (useLimit) {
            binds.rowLimit = limit;
        }

        // Source-of-truth: DPDEPTINTREMAIN holds INT_AMT and PRNCBAL per account snapshot at OPERATE_DATE,
        // matching the values shown in the legacy reference report. We pull straight from this table
        // instead of re-deriving accumulated interest from DPDEPTPRNCFIXED proration.
        const operateDate = filters.date || new Date().toISOString().slice(0, 10);
        binds.operateDate = operateDate;

        const sql = `
            WITH int_remain_agg AS (
                SELECT
                    ir.COOP_ID,
                    ir.DEPTACCOUNT_NO,
                    SUM(ir.INT_AMT)  AS ACC_INT,
                    SUM(ir.PRNCBAL)  AS BALANCE_IR,
                    MAX(ir.CALINT_TO) AS CALINT_TO
                FROM ${OWNER}.DPDEPTINTREMAIN ir
                WHERE ir.COOP_ID = :coopId
                  AND ir.OPERATE_DATE = TO_DATE(:operateDate, 'YYYY-MM-DD')
                GROUP BY ir.COOP_ID, ir.DEPTACCOUNT_NO
            ),
            curr_rate AS (
                SELECT ir.DEPTTYPE_CODE, ir.MEMBCAT_CODE, ir.INTEREST_RATE
                FROM ${OWNER}.DPDEPTINTRATE ir
                WHERE ir.COOP_ID = :coopId
                  AND ir.EFFECTIVE_DATE = (
                      SELECT MAX(ir2.EFFECTIVE_DATE)
                      FROM ${OWNER}.DPDEPTINTRATE ir2
                      WHERE ir2.COOP_ID = ir.COOP_ID
                        AND ir2.DEPTTYPE_CODE = ir.DEPTTYPE_CODE
                        AND ir2.MEMBCAT_CODE = ir.MEMBCAT_CODE
                        AND ir2.EFFECTIVE_DATE <= TO_DATE(:rateDate, 'YYYY-MM-DD')
                  )
                  AND ir.DEPT_STEP = (
                      SELECT MAX(ir3.DEPT_STEP)
                      FROM ${OWNER}.DPDEPTINTRATE ir3
                      WHERE ir3.COOP_ID = ir.COOP_ID
                        AND ir3.DEPTTYPE_CODE = ir.DEPTTYPE_CODE
                        AND ir3.MEMBCAT_CODE = ir.MEMBCAT_CODE
                        AND ir3.EFFECTIVE_DATE = ir.EFFECTIVE_DATE
                  )
            )
            SELECT * FROM (
                SELECT
                    ROW_NUMBER() OVER (ORDER BY dm.DEPTACCOUNT_NO) AS ROW_NUM,
                    dm.DEPTACCOUNT_NO   AS ACCOUNT_NO,
                    dm.DEPTACCOUNT_NAME AS ACCOUNT_NAME,
                    NVL(ira.BALANCE_IR, 0) AS BALANCE,
                    NVL(ira.ACC_INT, 0)    AS ACC_INTEREST,
                    CASE WHEN dt.TIMEDUE_PREFER = 'M'
                              THEN ADD_MONTHS(dm.DEPTOPEN_DATE, dt.F_MONTHDUE_PERIOD)
                         ELSE NULL END AS DUE_DATE,
                    dm.DEPTOPEN_DATE    AS REC_DATE,
                    dm.DEPTTYPE_CODE,
                    dm.MEMBCAT_CODE,
                    dm.MEMBER_NO,
                    NVL(cr.INTEREST_RATE, 0) AS INTEREST_RATE,
                    dt.F_MONTHDUE_PERIOD AS PRNCDUE_NMONTH
                FROM ${OWNER}.DPDEPTMASTER dm
                JOIN ${OWNER}.DPDEPTTYPE dt
                    ON dt.COOP_ID = dm.COOP_ID
                   AND dt.DEPTTYPE_CODE = dm.DEPTTYPE_CODE
                   AND dt.MEMBCAT_CODE = dm.MEMBCAT_CODE
                JOIN int_remain_agg ira
                    ON ira.COOP_ID = dm.COOP_ID
                   AND ira.DEPTACCOUNT_NO = dm.DEPTACCOUNT_NO
                JOIN ${OWNER}.DPDEPTMASDUE md
                    ON md.COOP_ID = dm.COOP_ID
                   AND md.DEPTACCOUNT_NO = dm.DEPTACCOUNT_NO
                   AND md.SEQ_NO = 1
                LEFT JOIN curr_rate cr
                    ON cr.DEPTTYPE_CODE = dm.DEPTTYPE_CODE
                   AND cr.MEMBCAT_CODE = dm.MEMBCAT_CODE
                WHERE dm.COOP_ID = :coopId
                  AND dm.DEPTTYPE_CODE = '07'
                  AND dt.TIMEDUE_FLAG = 1
                  AND dt.TIMEDUE_PREFER = 'M'
                ORDER BY dm.DEPTACCOUNT_NO
            )${useLimit ? " WHERE ROW_NUM <= :rowLimit" : ""}
        `;

        console.log("[DepositService] Executing RPTM0009 query...");
        const rows = await db.execute(sql, binds);
        console.log(`[DepositService] Found ${rows.length} records`);

        // Day difference using "BE-as-Gregorian" calendar (matches Excel/legacy report behavior).
        // Treating พ.ศ. year numbers as if they were ค.ศ. years shifts which years are leap,
        // producing the same day counts as the original Excel-based reference report.
        const calcDays = (fromDate, toDate) => {
            const f = fromDate instanceof Date ? fromDate : new Date(fromDate);
            const t = toDate instanceof Date ? toDate : new Date(toDate);
            const fBE = new Date(f.getFullYear() + 543, f.getMonth(), f.getDate());
            const tBE = new Date(t.getFullYear() + 543, t.getMonth(), t.getDate());
            return Math.round((tBE.getTime() - fBE.getTime()) / (1000 * 60 * 60 * 24));
        };

        // Map to report format
        const records = rows.map((r) => ({
            ROW_NUM: r.ROW_NUM,
            REC_DATE: filters.date ? new Date(filters.date) : r.REC_DATE,
            ACCOUNT_NO: r.ACCOUNT_NO ? r.ACCOUNT_NO.trim() : "",
            ACCOUNT_NAME: r.ACCOUNT_NAME ? r.ACCOUNT_NAME.trim() : "",
            BALANCE: r.BALANCE || 0,
            ACC_INTEREST: r.ACC_INTEREST || 0,
            DUE_DATE: r.DUE_DATE,
            DURATION_DAYS: (() => {
                const recDate = filters.date ? new Date(filters.date) : r.REC_DATE;
                if (r.DUE_DATE && recDate) {
                    return calcDays(recDate, r.DUE_DATE);
                }
                return "";
            })(),
            INT_MONTHS: (() => {
                const recDate = filters.date ? new Date(filters.date) : r.REC_DATE;
                if (r.DUE_DATE && recDate) {
                    const days = calcDays(recDate, r.DUE_DATE);
                    if (days === 0) return 0;
                    return Math.ceil(Math.abs(days) / 30) * Math.sign(days);
                }
                return "";
            })(),
            INT_TO_DUE: (() => {
                const recDate = filters.date ? new Date(filters.date) : r.REC_DATE;
                const bal = r.BALANCE || 0;
                const rate = r.INTEREST_RATE || 0;
                if (r.DUE_DATE && recDate && bal && rate) {
                    const days = calcDays(recDate, r.DUE_DATE);
                    if (days !== 0) {
                        return bal * days / 365 * rate;
                    }
                }
                return "";
            })(),
            DEPTTYPE_CODE: r.DEPTTYPE_CODE ? r.DEPTTYPE_CODE.trim() : "",
            MEMBCAT_CODE: r.MEMBCAT_CODE ? r.MEMBCAT_CODE.trim() : "",
            MEMBER_NO: r.MEMBER_NO ? r.MEMBER_NO.trim() : "",
            INTEREST_RATE: r.INTEREST_RATE || 0,
            PRNCDUE_NMONTH: r.PRNCDUE_NMONTH || 0,
        }));

        // Calculate bucket columns based on INT_MONTHS
        for (const rec of records) {
            const total = (rec.BALANCE || 0) + (rec.ACC_INTEREST || 0) + (rec.INT_TO_DUE || 0);
            const m = rec.INT_MONTHS;
            rec.BUCKET_8D_1M = (m === 1) ? total : 0;
            rec.BUCKET_1_3M = (m >= 2 && m < 4) ? total : 0;
            rec.BUCKET_3_6M = (m >= 4 && m < 7) ? total : 0;
            rec.BUCKET_6_12M = (m >= 7 && m < 13) ? total : 0;
            rec.BUCKET_1_5Y = (m >= 13 && m < 26) ? total : 0;
        }

        // Calculate summary totals
        const totals = {
            INT_TO_DUE: 0,
            BUCKET_8D_1M: 0,
            BUCKET_1_3M: 0,
            BUCKET_3_6M: 0,
            BUCKET_6_12M: 0,
            BUCKET_1_5Y: 0,
        };
        for (const rec of records) {
            totals.INT_TO_DUE += (rec.INT_TO_DUE || 0);
            totals.BUCKET_8D_1M += (rec.BUCKET_8D_1M || 0);
            totals.BUCKET_1_3M += (rec.BUCKET_1_3M || 0);
            totals.BUCKET_3_6M += (rec.BUCKET_3_6M || 0);
            totals.BUCKET_6_12M += (rec.BUCKET_6_12M || 0);
            totals.BUCKET_1_5Y += (rec.BUCKET_1_5Y || 0);
        }
        // Round totals
        for (const key of Object.keys(totals)) {
            totals[key] = Math.round(totals[key] * 100) / 100;
        }

        // Round per-row values to 2 decimals for display (after totals computed)
        for (const rec of records) {
            if (typeof rec.INT_TO_DUE === 'number') rec.INT_TO_DUE = Math.round(rec.INT_TO_DUE * 100) / 100;
            rec.BUCKET_8D_1M = Math.round(rec.BUCKET_8D_1M * 100) / 100;
            rec.BUCKET_1_3M = Math.round(rec.BUCKET_1_3M * 100) / 100;
            rec.BUCKET_3_6M = Math.round(rec.BUCKET_3_6M * 100) / 100;
            rec.BUCKET_6_12M = Math.round(rec.BUCKET_6_12M * 100) / 100;
            rec.BUCKET_1_5Y = Math.round(rec.BUCKET_1_5Y * 100) / 100;
        }

        return { filterDesc, records, totals };
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
