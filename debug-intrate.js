// Debug: query DPDEPTINTRATE structure and data for type 07
require("dotenv").config();
const db = require("./src/db/oracle");

const OWNER = "ISCODOH";
const COOP_ID = "056001";

async function main() {
    await db.initialize();

    // 1) Get DPDEPTINTRATE columns
    console.log("=== DPDEPTINTRATE columns ===");
    try {
        const cols = await db.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS 
             WHERE OWNER = :owner AND TABLE_NAME = 'DPDEPTINTRATE' 
             ORDER BY COLUMN_ID`,
            { owner: OWNER }
        );
        for (const c of cols) console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    } catch(e) { console.log("Error:", e.message); }

    // 2) Get DPDEPTINTRATE data for type 07
    console.log("\n=== DPDEPTINTRATE rows for type 07 ===");
    try {
        const rows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTINTRATE 
             WHERE COOP_ID = :coopId AND DEPTTYPE_CODE = '07'
             ORDER BY 1,2,3,4`,
            { coopId: COOP_ID }
        );
        if (rows.length > 0) {
            console.log("Columns:", Object.keys(rows[0]).join(", "));
            for (const r of rows) {
                const vals = Object.entries(r).map(([k,v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0,10) : v}`).join(" | ");
                console.log("  ", vals);
            }
        } else {
            console.log("  No rows");
        }
    } catch(e) { console.log("Error:", e.message); }

    // 3) DPDEPTMASTER columns that might have due date
    console.log("\n=== DPDEPTMASTER columns ===");
    try {
        const cols = await db.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS 
             WHERE OWNER = :owner AND TABLE_NAME = 'DPDEPTMASTER' 
             ORDER BY COLUMN_ID`,
            { owner: OWNER }
        );
        for (const c of cols) console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    } catch(e) { console.log("Error:", e.message); }

    // 4) DPDEPTMASTER sample for first 3 type-07 accounts - all fields
    console.log("\n=== DPDEPTMASTER first 3 type-07 accounts ===");
    try {
        const rows = await db.execute(
            `SELECT * FROM ${OWNER}.DPDEPTMASTER 
             WHERE COOP_ID = :coopId AND DEPTTYPE_CODE = '07'
             ORDER BY DEPTACCOUNT_NO
             FETCH FIRST 3 ROWS ONLY`,
            { coopId: COOP_ID }
        );
        for (const r of rows) {
            console.log(`\n  Account: ${r.DEPTACCOUNT_NO}`);
            for (const [k, v] of Object.entries(r)) {
                if (v !== null && v !== undefined) {
                    console.log(`    ${k} = ${v instanceof Date ? v.toISOString().slice(0,10) : v}`);
                }
            }
        }
    } catch(e) { console.log("Error:", e.message); }

    // 5) DPDEPTPRNCFIXED - only records with PRNC_BAL > 0 or recent dates for first 5 accounts
    console.log("\n=== Active PRNC records (bal>0 OR recent rate) for first 5 accounts ===");
    try {
        const rows = await db.execute(
            `SELECT pf.DEPTACCOUNT_NO, pf.PRNC_BAL, pf.INTEREST_RATE, pf.PRNCDUE_DATE, pf.PRNC_DATE, pf.PRNCDUE_NMONTH,
                    pf.INT_REMAIN, pf.INTPAY_AMT
             FROM ${OWNER}.DPDEPTPRNCFIXED pf
             JOIN ${OWNER}.DPDEPTMASTER dm ON dm.COOP_ID = pf.COOP_ID AND dm.DEPTACCOUNT_NO = pf.DEPTACCOUNT_NO
             WHERE pf.COOP_ID = :coopId AND dm.DEPTTYPE_CODE = '07'
               AND pf.PRNCDUE_DATE > TO_DATE('2026-02-28', 'YYYY-MM-DD')
             ORDER BY pf.DEPTACCOUNT_NO, pf.PRNC_DATE
             FETCH FIRST 30 ROWS ONLY`,
            { coopId: COOP_ID }
        );
        let cur = "";
        for (const r of rows) {
            const a = r.DEPTACCOUNT_NO.trim();
            if (a !== cur) { console.log(`\n  ${a}:`); cur = a; }
            console.log(`    bal=${r.PRNC_BAL}, rate=${r.INTEREST_RATE}, due=${r.PRNCDUE_DATE?.toISOString().slice(0,10)}, prnc=${r.PRNC_DATE?.toISOString().slice(0,10)}, nmonth=${r.PRNCDUE_NMONTH}, intpay=${r.INTPAY_AMT}`);
        }
    } catch(e) { console.log("Error:", e.message); }

    // 6) Check DPDEPTPRNCFIXEDDET table
    console.log("\n=== DPDEPTPRNCFIXEDDET columns ===");
    try {
        const cols = await db.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS 
             WHERE OWNER = :owner AND TABLE_NAME = 'DPDEPTPRNCFIXEDDET' 
             ORDER BY COLUMN_ID`,
            { owner: OWNER }
        );
        for (const c of cols) console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    } catch(e) { console.log("Error:", e.message); }

    await db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
