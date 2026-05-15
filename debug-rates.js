// Debug: check interest rate tables and compare per-account rates
require("dotenv").config();
const db = require("./src/db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";
const REPORT_DATE = "2026-02-28";

async function main() {
    await db.initialize();

    // 1) Check DPDEPTINTRATE for type 07
    console.log("=== DPDEPTINTRATE for type 07 ===");
    try {
        const rates = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTINTRATE 
             WHERE COOP_ID = :coopId AND DEPTTYPE_CODE = '07'
             ORDER BY INTEFF_DATE DESC`,
            { coopId: COOP_ID }
        );
        if (rates.length > 0) {
            console.log("Columns:", Object.keys(rates[0]).join(", "));
            for (const r of rates.slice(0, 10)) {
                const vals = Object.entries(r).map(([k,v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0,10) : v}`).join(" | ");
                console.log("  ", vals);
            }
        } else {
            console.log("  No rows found");
        }
    } catch(e) { console.log("Error:", e.message); }

    // 2) Check DPDEPTACCINTRATE for first few accounts of type 07
    console.log("\n=== DPDEPTACCINTRATE for type 07 accounts ===");
    try {
        const accRates = await db.execute(
            `SELECT air.* FROM ${OWNER}.DPDEPTACCINTRATE air
             JOIN ${OWNER}.DPDEPTMASTER dm ON dm.COOP_ID = air.COOP_ID AND dm.DEPTACCOUNT_NO = air.DEPTACCOUNT_NO
             WHERE air.COOP_ID = :coopId AND dm.DEPTTYPE_CODE = '07'
             AND ROWNUM <= 20
             ORDER BY air.DEPTACCOUNT_NO`,
            { coopId: COOP_ID }
        );
        if (accRates.length > 0) {
            console.log("Columns:", Object.keys(accRates[0]).join(", "));
            for (const r of accRates) {
                const vals = Object.entries(r).map(([k,v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0,10) : v}`).join(" | ");
                console.log("  ", vals);
            }
        } else {
            console.log("  No rows found");
        }
    } catch(e) { console.log("Error:", e.message); }

    // 3) Raw DPDEPTPRNCFIXED for first 5 accounts — show all rate fields
    console.log("\n=== DPDEPTPRNCFIXED detail for first 5 accounts ===");
    try {
        const detail = await db.execute(
            `SELECT pf.DEPTACCOUNT_NO, pf.PRNC_BAL, pf.INTEREST_RATE, pf.INT_REMAIN,
                    pf.INTPAY_AMT, pf.PRNCDUE_DATE, pf.PRNC_DATE, pf.PRNCDUE_NMONTH
             FROM ${OWNER}.DPDEPTPRNCFIXED pf
             JOIN ${OWNER}.DPDEPTMASTER dm ON dm.COOP_ID = pf.COOP_ID AND dm.DEPTACCOUNT_NO = pf.DEPTACCOUNT_NO
             WHERE pf.COOP_ID = :coopId AND dm.DEPTTYPE_CODE = '07'
               AND dm.DEPTOPEN_DATE <= TO_DATE('2026-03-01', 'YYYY-MM-DD')
               AND (dm.DEPTCLOSE_STATUS = 0 OR dm.DEPTCLOSE_DATE >= TO_DATE('2026-03-01', 'YYYY-MM-DD'))
             ORDER BY pf.DEPTACCOUNT_NO, pf.PRNC_DATE
             FETCH FIRST 30 ROWS ONLY`,
            { coopId: COOP_ID }
        );
        
        let currentAcct = "";
        for (const r of detail) {
            const acct = r.DEPTACCOUNT_NO.trim();
            if (acct !== currentAcct) {
                console.log(`\n  Account: ${acct}`);
                currentAcct = acct;
            }
            const due = r.PRNCDUE_DATE ? r.PRNCDUE_DATE.toISOString().slice(0,10) : "null";
            const prnc = r.PRNC_DATE ? r.PRNC_DATE.toISOString().slice(0,10) : "null";
            console.log(`    bal=${r.PRNC_BAL}, rate=${r.INTEREST_RATE}, int_remain=${r.INT_REMAIN}, intpay=${r.INTPAY_AMT}, prnc_date=${prnc}, due=${due}, nmonth=${r.PRNCDUE_NMONTH}`);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 4) Compare: for account 0070204679 (row 3), calculate INT_TO_DUE with different rates
    console.log("\n=== Rate comparison for sample accounts ===");
    try {
        const samples = await db.execute(
            `SELECT dm.DEPTACCOUNT_NO,
                    SUM(pf.PRNC_BAL) AS TOTAL_BAL,
                    MAX(pf.INTEREST_RATE) AS MAX_RATE,
                    MIN(pf.INTEREST_RATE) AS MIN_RATE,
                    CASE WHEN SUM(pf.PRNC_BAL) > 0 
                         THEN SUM(pf.PRNC_BAL * pf.INTEREST_RATE) / SUM(pf.PRNC_BAL) 
                         ELSE 0 END AS WEIGHTED_AVG_RATE,
                    COUNT(*) AS PRNC_COUNT,
                    MAX(pf.PRNCDUE_DATE) AS MAX_DUE
             FROM ${OWNER}.DPDEPTPRNCFIXED pf
             JOIN ${OWNER}.DPDEPTMASTER dm ON dm.COOP_ID = pf.COOP_ID AND dm.DEPTACCOUNT_NO = pf.DEPTACCOUNT_NO
             WHERE pf.COOP_ID = :coopId AND dm.DEPTTYPE_CODE = '07'
               AND dm.DEPTOPEN_DATE <= TO_DATE('2026-03-01', 'YYYY-MM-DD')
               AND (dm.DEPTCLOSE_STATUS = 0 OR dm.DEPTCLOSE_DATE >= TO_DATE('2026-03-01', 'YYYY-MM-DD'))
             GROUP BY dm.DEPTACCOUNT_NO
             ORDER BY dm.DEPTACCOUNT_NO
             FETCH FIRST 16 ROWS ONLY`,
            { coopId: COOP_ID }
        );
        
        const recDate = new Date(REPORT_DATE);
        console.log("Account          | Balance    | MAX_RATE | MIN_RATE | W_AVG_RATE | #PRNC | Days | INT(MAX) | INT(AVG) | INT(MIN)");
        console.log("-".repeat(120));
        for (const r of samples) {
            const due = r.MAX_DUE ? new Date(r.MAX_DUE) : null;
            const days = due ? Math.round((due.getTime() - recDate.getTime()) / (1000*60*60*24)) : 0;
            const intMax = Math.round(r.TOTAL_BAL * days / 365 * r.MAX_RATE * 100) / 100;
            const intAvg = Math.round(r.TOTAL_BAL * days / 365 * r.WEIGHTED_AVG_RATE * 100) / 100;
            const intMin = Math.round(r.TOTAL_BAL * days / 365 * r.MIN_RATE * 100) / 100;
            console.log(`${r.DEPTACCOUNT_NO.trim().padEnd(16)} | ${String(r.TOTAL_BAL).padStart(10)} | ${r.MAX_RATE.toFixed(6)} | ${r.MIN_RATE.toFixed(6)} | ${r.WEIGHTED_AVG_RATE.toFixed(6)} | ${String(r.PRNC_COUNT).padStart(5)} | ${String(days).padStart(4)} | ${String(intMax).padStart(8)} | ${String(intAvg).padStart(8)} | ${String(intMin).padStart(8)}`);
        }
    } catch(e) { console.log("Error:", e.message); }

    await db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
