// Debug: check DPDEPTPRNCFIXEDDET and DPDEPTINTRATE for correct rate
require("dotenv").config();
const db = require("./src/db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";

async function main() {
    await db.initialize();

    // 1) DPDEPTINTRATE for type 07
    console.log("=== DPDEPTINTRATE columns ===");
    try {
        const cols = await db.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS 
             WHERE OWNER = :owner AND TABLE_NAME = 'DPDEPTINTRATE' ORDER BY COLUMN_ID`,
            { owner: OWNER }
        );
        for (const c of cols) console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    } catch(e) { console.log("Error:", e.message); }

    console.log("\n=== DPDEPTINTRATE data for type 07 ===");
    try {
        const rows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTINTRATE 
             WHERE COOP_ID = :coopId AND DEPTTYPE_CODE = '07'`,
            { coopId: COOP_ID }
        );
        for (const r of rows) {
            const vals = Object.entries(r).map(([k,v]) => {
                if (v instanceof Date) return `${k}=${v.toISOString().slice(0,10)}`;
                return `${k}=${v}`;
            }).join(", ");
            console.log("  ", vals);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 2) DPDEPTPRNCFIXEDDET for account 0070204669 (report row 2)
    console.log("\n=== DPDEPTPRNCFIXEDDET for 0070204669 ===");
    try {
        const rows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTPRNCFIXEDDET
             WHERE COOP_ID = :coopId AND DEPTACCOUNT_NO = :acct
             ORDER BY PRNC_NO, SEQ_NO`,
            { coopId: COOP_ID, acct: "0070204669" }
        );
        for (const r of rows) {
            const vals = Object.entries(r).map(([k,v]) => {
                if (v instanceof Date) return `${k}=${v.toISOString().slice(0,10)}`;
                return `${k}=${v}`;
            }).join(", ");
            console.log("  ", vals);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 3) DPDEPTPRNCFIXEDDET for account 0070204687 (has both 0.032 and 0.0295)
    console.log("\n=== DPDEPTPRNCFIXEDDET for 0070204687 ===");
    try {
        const rows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTPRNCFIXEDDET
             WHERE COOP_ID = :coopId AND DEPTACCOUNT_NO = :acct
             ORDER BY PRNC_NO, SEQ_NO`,
            { coopId: COOP_ID, acct: "0070204687" }
        );
        for (const r of rows) {
            const vals = Object.entries(r).map(([k,v]) => {
                if (v instanceof Date) return `${k}=${v.toISOString().slice(0,10)}`;
                return `${k}=${v}`;
            }).join(", ");
            console.log("  ", vals);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 4) For account 0070204669 - get the PRNC record that was active as of report date
    //    i.e., the first principal record where PRNCDUE_DATE >= report date
    console.log("\n=== First active PRNC for 0070204669 (due >= 2026-02-28) ===");
    try {
        const rows = await db.execute(
            `SELECT pf.PRNC_NO, pf.PRNC_BAL, pf.INTEREST_RATE, pf.PRNCDUE_DATE, pf.PRNC_DATE, 
                    pf.PRNCDUE_NMONTH, pf.INT_REMAIN, pf.INTPAY_AMT
             FROM ${OWNER}.DPDEPTPRNCFIXED pf
             WHERE pf.COOP_ID = :coopId AND pf.DEPTACCOUNT_NO = :acct
               AND pf.PRNCDUE_DATE >= TO_DATE('2026-02-28', 'YYYY-MM-DD')
             ORDER BY pf.PRNCDUE_DATE, pf.PRNC_DATE
             FETCH FIRST 5 ROWS ONLY`,
            { coopId: COOP_ID, acct: "0070204669" }
        );
        for (const r of rows) {
            console.log(`  prnc_no=${r.PRNC_NO}, bal=${r.PRNC_BAL}, rate=${r.INTEREST_RATE}, due=${r.PRNCDUE_DATE?.toISOString().slice(0,10)}, prnc=${r.PRNC_DATE?.toISOString().slice(0,10)}, intpay=${r.INTPAY_AMT}`);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 5) What rate applies as of 2026-02-28 from DPDEPTPRNCFIXEDDET?
    console.log("\n=== DPDEPTPRNCFIXEDDET rate as of 2026-02-28 for 0070204669 ===");
    try {
        const rows = await db.execute(
            `SELECT d.PRNC_NO, d.SEQ_NO, d.START_DATE, d.END_DATE, d.INTEREST_RATE, d.PRNC_DATE
             FROM ${OWNER}.DPDEPTPRNCFIXEDDET d
             WHERE d.COOP_ID = :coopId AND d.DEPTACCOUNT_NO = :acct
               AND d.START_DATE <= TO_DATE('2026-02-28', 'YYYY-MM-DD')
               AND d.END_DATE >= TO_DATE('2026-02-28', 'YYYY-MM-DD')
             ORDER BY d.PRNC_NO, d.SEQ_NO`,
            { coopId: COOP_ID, acct: "0070204669" }
        );
        for (const r of rows) {
            console.log(`  prnc_no=${r.PRNC_NO}, seq=${r.SEQ_NO}, start=${r.START_DATE?.toISOString().slice(0,10)}, end=${r.END_DATE?.toISOString().slice(0,10)}, rate=${r.INTEREST_RATE}`);
        }
        if (rows.length === 0) console.log("  No matching rows");
    } catch(e) { console.log("Error:", e.message); }

    // 6) Same for 0070204687
    console.log("\n=== DPDEPTPRNCFIXEDDET rate as of 2026-02-28 for 0070204687 ===");
    try {
        const rows = await db.execute(
            `SELECT d.PRNC_NO, d.SEQ_NO, d.START_DATE, d.END_DATE, d.INTEREST_RATE, d.PRNC_DATE
             FROM ${OWNER}.DPDEPTPRNCFIXEDDET d
             WHERE d.COOP_ID = :coopId AND d.DEPTACCOUNT_NO = :acct
               AND d.START_DATE <= TO_DATE('2026-02-28', 'YYYY-MM-DD')
               AND d.END_DATE >= TO_DATE('2026-02-28', 'YYYY-MM-DD')
             ORDER BY d.PRNC_NO, d.SEQ_NO`,
            { coopId: COOP_ID, acct: "0070204687" }
        );
        for (const r of rows) {
            console.log(`  prnc_no=${r.PRNC_NO}, seq=${r.SEQ_NO}, start=${r.START_DATE?.toISOString().slice(0,10)}, end=${r.END_DATE?.toISOString().slice(0,10)}, rate=${r.INTEREST_RATE}`);
        }
        if (rows.length === 0) console.log("  No matching rows");
    } catch(e) { console.log("Error:", e.message); }

    await db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
