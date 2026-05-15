// Verify the SQL fix produces correct rates and due dates
require("dotenv").config();
const db = require("./src/db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";
const REPORT_DATE = "2026-02-28";

async function main() {
    await db.initialize();

    // Simulate the fixed query for first 16 rows
    const queryDate = "2026-03-01";
    const sql = `
        WITH prnc_agg AS (
            SELECT pf.COOP_ID, pf.DEPTACCOUNT_NO,
                SUM(pf.PRNC_BAL) AS TOTAL_BAL,
                SUM(pf.INT_REMAIN) AS TOTAL_INT,
                MAX(pf.PRNCDUE_DATE) AS MAX_DUE_DATE,
                MIN(CASE WHEN pf.PRNCDUE_DATE >= TO_DATE(:dueDateCutoff, 'YYYY-MM-DD') THEN pf.PRNCDUE_DATE END) AS NEXT_DUE_DATE,
                MAX(pf.INTEREST_RATE) AS MAX_RATE,
                MAX(pf.PRNCDUE_NMONTH) AS MAX_NMONTH,
                SUM(pf.INTPAY_AMT) AS TOTAL_INTPAY
            FROM ${OWNER}.DPDEPTPRNCFIXED pf
            WHERE pf.COOP_ID = :coopId
            GROUP BY pf.COOP_ID, pf.DEPTACCOUNT_NO
        ),
        slip_bal AS (
            SELECT COOP_ID, DEPTACCOUNT_NO, PRNCBAL,
                ROW_NUMBER() OVER (PARTITION BY COOP_ID, DEPTACCOUNT_NO ORDER BY DEPTSLIP_DATE DESC, DPSTM_NO DESC) AS RN
            FROM ${OWNER}.DPDEPTSLIP
            WHERE COOP_ID = :coopId AND DEPTITEMTYPE_CODE NOT IN ('CTI', 'WTR')
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
                NVL(NULLIF(pa.TOTAL_BAL, 0), sb.PRNCBAL) AS BALANCE,
                CASE WHEN dm.DEPTCLOSE_STATUS = 1 THEN dm.DEPTCLOSE_DATE ELSE NVL(pa.NEXT_DUE_DATE, pa.MAX_DUE_DATE) END AS DUE_DATE,
                dm.DEPTOPEN_DATE    AS REC_DATE,
                dm.MEMBCAT_CODE,
                NVL(cr.INTEREST_RATE, pa.MAX_RATE) AS INTEREST_RATE,
                pa.MAX_RATE AS OLD_MAX_RATE,
                cr.INTEREST_RATE AS CURR_RATE,
                pa.MAX_DUE_DATE AS OLD_MAX_DUE,
                pa.NEXT_DUE_DATE AS NEW_NEXT_DUE
            FROM ${OWNER}.DPDEPTMASTER dm
            LEFT JOIN prnc_agg pa ON pa.COOP_ID = dm.COOP_ID AND pa.DEPTACCOUNT_NO = dm.DEPTACCOUNT_NO
            LEFT JOIN slip_bal sb ON sb.COOP_ID = dm.COOP_ID AND sb.DEPTACCOUNT_NO = dm.DEPTACCOUNT_NO AND sb.RN = 1
            LEFT JOIN curr_rate cr ON cr.DEPTTYPE_CODE = dm.DEPTTYPE_CODE AND cr.MEMBCAT_CODE = dm.MEMBCAT_CODE
            WHERE dm.COOP_ID = :coopId
              AND dm.DEPTTYPE_CODE = '07'
              AND dm.DEPTOPEN_DATE <= TO_DATE(:filterDate, 'YYYY-MM-DD')
              AND (dm.DEPTCLOSE_STATUS = 0 OR dm.DEPTCLOSE_DATE >= TO_DATE(:closeDateFilter, 'YYYY-MM-DD'))
            ORDER BY dm.DEPTACCOUNT_NO
        ) WHERE ROW_NUM <= 16
    `;

    const rows = await db.execute(sql, {
        coopId: COOP_ID,
        dueDateCutoff: REPORT_DATE,
        rateDate: REPORT_DATE,
        filterDate: queryDate,
        closeDateFilter: queryDate,
    });

    const recDate = new Date(REPORT_DATE);
    console.log("ROW | ACCOUNT_NO     | BALANCE      | OLD_RATE | NEW_RATE | OLD_DUE    | NEW_DUE    | DAYS | INT_TO_DUE");
    console.log("-".repeat(120));

    for (const r of rows) {
        const bal = r.BALANCE || 0;
        const rate = r.INTEREST_RATE || 0;
        const dueDate = r.DUE_DATE;
        const days = dueDate ? Math.round((new Date(dueDate).getTime() - recDate.getTime()) / (1000*60*60*24)) : 0;
        const intToDue = (bal && rate && days > 0) ? Math.round(bal * days / 365 * rate * 100) / 100 : 0;

        const oldDue = r.OLD_MAX_DUE ? r.OLD_MAX_DUE.toISOString().slice(0,10) : "null";
        const newDue = r.NEW_NEXT_DUE ? r.NEW_NEXT_DUE.toISOString().slice(0,10) : "null";
        const displayDue = dueDate ? dueDate.toISOString().slice(0,10) : "null";

        console.log(
            `${String(r.ROW_NUM).padStart(3)} | ${r.ACCOUNT_NO.trim().padEnd(14)} | ${String(bal).padStart(12)} | ${(r.OLD_MAX_RATE||0).toFixed(4).padStart(8)} | ${(r.CURR_RATE||0).toFixed(4).padStart(8)} | ${oldDue} | ${newDue.padEnd(10)} | ${String(days).padStart(4)} | ${String(intToDue).padStart(10)}`
        );
    }

    await db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
