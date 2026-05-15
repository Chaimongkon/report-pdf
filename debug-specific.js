// Debug script: compare raw Oracle data with calculated values for RPTM0009
// Run: node debug-specific.js

require("dotenv").config();
const db = require("./src/db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";
const REPORT_DATE = "2026-02-28"; // ← the date user selected (Gregorian)

async function main() {
    await db.initialize();

    // 1) Query raw DPDEPTPRNCFIXED detail for first 16 accounts of type 07
    const detailSQL = `
        SELECT pf.DEPTACCOUNT_NO, pf.PRNC_BAL, pf.INT_REMAIN, pf.INTEREST_RATE,
               pf.PRNCDUE_DATE, pf.PRNCDUE_NMONTH, pf.PRNC_DATE, pf.INTPAY_AMT,
               dm.DEPTCLOSE_DATE, dm.DEPTCLOSE_STATUS, dm.DEPTOPEN_DATE
        FROM ${OWNER}.DPDEPTPRNCFIXED pf
        JOIN ${OWNER}.DPDEPTMASTER dm
          ON dm.COOP_ID = pf.COOP_ID AND dm.DEPTACCOUNT_NO = pf.DEPTACCOUNT_NO
        WHERE pf.COOP_ID = :coopId
          AND dm.DEPTTYPE_CODE = '07'
          AND dm.DEPTOPEN_DATE <= TO_DATE(:qDate, 'YYYY-MM-DD')
          AND (dm.DEPTCLOSE_STATUS = 0 OR dm.DEPTCLOSE_DATE >= TO_DATE(:qDate2, 'YYYY-MM-DD'))
        ORDER BY pf.DEPTACCOUNT_NO, pf.PRNC_DATE
    `;

    const queryDate = "2026-03-01"; // 1st of next month (for WHERE filter)
    const rows = await db.execute(detailSQL, {
        coopId: COOP_ID,
        qDate: queryDate,
        qDate2: queryDate,
    });

    // Group by account
    const byAccount = {};
    for (const r of rows) {
        const acct = r.DEPTACCOUNT_NO.trim();
        if (!byAccount[acct]) byAccount[acct] = [];
        byAccount[acct].push(r);
    }

    const accounts = Object.keys(byAccount).sort().slice(0, 16);
    
    console.log("=".repeat(120));
    console.log(`RPTM0009 Debug — Report Date: ${REPORT_DATE} | Query Date: ${queryDate}`);
    console.log("=".repeat(120));

    for (const acct of accounts) {
        const prncRecords = byAccount[acct];
        console.log(`\n--- Account: ${acct} (${prncRecords.length} principal records) ---`);
        
        let totalBal = 0;
        let totalIntRemain = 0;
        let maxRate = 0;
        let maxDueDate = null;
        let weightedRateSum = 0;

        for (const p of prncRecords) {
            const bal = p.PRNC_BAL || 0;
            const rate = p.INTEREST_RATE || 0;
            totalBal += bal;
            totalIntRemain += (p.INT_REMAIN || 0);
            if (rate > maxRate) maxRate = rate;
            weightedRateSum += bal * rate;
            if (!maxDueDate || (p.PRNCDUE_DATE && p.PRNCDUE_DATE > maxDueDate)) {
                maxDueDate = p.PRNCDUE_DATE;
            }

            console.log(`  PRNC: bal=${bal}, rate=${rate}, int_remain=${p.INT_REMAIN}, intpay_amt=${p.INTPAY_AMT}, prnc_date=${p.PRNC_DATE?.toISOString?.() || p.PRNC_DATE}, due=${p.PRNCDUE_DATE?.toISOString?.() || p.PRNCDUE_DATE}, nmonth=${p.PRNCDUE_NMONTH}`);
        }

        const weightedAvgRate = totalBal > 0 ? weightedRateSum / totalBal : 0;
        const dueDate = prncRecords[0].DEPTCLOSE_STATUS === 1 ? prncRecords[0].DEPTCLOSE_DATE : maxDueDate;
        
        // Calculate days using report date
        const recDate = new Date(REPORT_DATE);
        let days = 0;
        if (dueDate) {
            days = Math.round((new Date(dueDate).getTime() - recDate.getTime()) / (1000 * 60 * 60 * 24));
        }
        
        const intToDue_maxRate = Math.round(totalBal * days / 365 * maxRate * 100) / 100;
        const intToDue_avgRate = Math.round(totalBal * days / 365 * weightedAvgRate * 100) / 100;

        console.log(`  SUMMARY:`);
        console.log(`    totalBal      = ${totalBal}`);
        console.log(`    totalIntRemain= ${totalIntRemain}`);
        console.log(`    MAX rate      = ${maxRate}`);
        console.log(`    Weighted avg  = ${weightedAvgRate}`);
        console.log(`    dueDate       = ${dueDate?.toISOString?.() || dueDate}`);
        console.log(`    days          = ${days}`);
        console.log(`    INT_TO_DUE (MAX rate)      = ${intToDue_maxRate}`);
        console.log(`    INT_TO_DUE (weighted avg)  = ${intToDue_avgRate}`);
    }

    // 2) Also check if there's a deposit type rate table
    console.log("\n" + "=".repeat(120));
    console.log("Checking DPDEPTTYPE for type 07 rate info...");
    try {
        const typeRows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTTYPE WHERE COOP_ID = :coopId AND DEPTTYPE_CODE = '07'`,
            { coopId: COOP_ID }
        );
        if (typeRows.length > 0) {
            console.log("DPDEPTTYPE columns:", Object.keys(typeRows[0]).join(", "));
            for (const [k, v] of Object.entries(typeRows[0])) {
                console.log(`  ${k} = ${v}`);
            }
        }
    } catch (e) {
        console.log("Error querying DPDEPTTYPE:", e.message);
    }

    // 3) Check for interest rate config table
    console.log("\n" + "=".repeat(120));
    console.log("Looking for interest rate tables...");
    try {
        const tables = await db.execute(
            `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :owner AND TABLE_NAME LIKE '%INT%RATE%' ORDER BY TABLE_NAME`,
            { owner: OWNER }
        );
        console.log("Tables matching '%INT%RATE%':", tables.map(t => t.TABLE_NAME));
        
        const tables2 = await db.execute(
            `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :owner AND TABLE_NAME LIKE 'DP%' ORDER BY TABLE_NAME`,
            { owner: OWNER }
        );
        console.log("All DP* tables:", tables2.map(t => t.TABLE_NAME));
    } catch (e) {
        console.log("Error listing tables:", e.message);
    }

    await db.close();
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
