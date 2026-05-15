require("dotenv").config();
const db = require("./src/db/oracle");
const OWNER = "ISCODOH";
const COOP_ID = "056001";
const REPORT_DATE = "2026-02-28";
const ACCT = "0070204768";

async function main() {
    await db.initialize();

    // 1) PRNC records for this account
    const prnc = await db.execute(`
        SELECT pf.PRNC_BAL, pf.INT_REMAIN, pf.INTPAY_AMT, pf.INTEREST_RATE,
               pf.PRNC_DATE, pf.PRNCDUE_DATE, pf.PRNCDUE_NMONTH
        FROM ${OWNER}.DPDEPTPRNCFIXED pf
        WHERE pf.COOP_ID = :coopId AND pf.DEPTACCOUNT_NO = :acct
        ORDER BY pf.PRNC_DATE
    `, { coopId: COOP_ID, acct: ACCT });

    console.log(`=== PRNC records for ${ACCT}: ${prnc.length} rows ===`);
    let sumBal = 0, sumIntpay = 0, sumIntRemain = 0;
    for (const r of prnc) {
        const prncDate = r.PRNC_DATE ? r.PRNC_DATE.toISOString().slice(0,10) : "null";
        const dueDate = r.PRNCDUE_DATE ? r.PRNCDUE_DATE.toISOString().slice(0,10) : "null";
        console.log(`  bal=${r.PRNC_BAL}, rate=${r.INTEREST_RATE}, int_remain=${r.INT_REMAIN}, intpay=${r.INTPAY_AMT}, prnc=${prncDate}, due=${dueDate}, nmonth=${r.PRNCDUE_NMONTH}`);
        sumBal += (r.PRNC_BAL || 0);
        sumIntpay += (r.INTPAY_AMT || 0);
        sumIntRemain += (r.INT_REMAIN || 0);
    }
    console.log(`  SUM: bal=${sumBal}, intpay=${sumIntpay}, int_remain=${sumIntRemain}`);

    // 1b) ALL slips for this account (no type filter, last 10)
    const slips = await db.execute(`
        SELECT DEPTSLIP_DATE, PRNCBAL, DEPTITEMTYPE_CODE, DPSTM_NO, DEPTSLIP_AMT,
               TO_CHAR(DEPTSLIP_DATE, 'YYYY-MM-DD HH24:MI:SS') AS SLIP_DATE_STR
        FROM ${OWNER}.DPDEPTSLIP
        WHERE COOP_ID = :coopId AND DEPTACCOUNT_NO = :acct
        ORDER BY DEPTSLIP_DATE DESC, DPSTM_NO DESC
        FETCH FIRST 10 ROWS ONLY
    `, { coopId: COOP_ID, acct: ACCT });
    console.log(`\n=== Latest 10 slips (ALL types) ===`);
    for (const s of slips) {
        console.log(`  date=${s.SLIP_DATE_STR}, bal=${s.PRNCBAL}, amt=${s.DEPTSLIP_AMT}, type=${s.DEPTITEMTYPE_CODE}, stm=${s.DPSTM_NO}`);
    }

    // 1c) Count PRNC records by cutoff
    const prncCount = await db.execute(`
        SELECT
            COUNT(*) AS TOTAL_PRNC,
            COUNT(CASE WHEN pf.PRNC_DATE <= TO_DATE(:cutoff, 'YYYY-MM-DD') THEN 1 END) AS PRNC_BEFORE_CUTOFF,
            COUNT(CASE WHEN pf.PRNC_DATE > TO_DATE(:cutoff2, 'YYYY-MM-DD') THEN 1 END) AS PRNC_AFTER_CUTOFF
        FROM ${OWNER}.DPDEPTPRNCFIXED pf
        WHERE pf.COOP_ID = :coopId AND pf.DEPTACCOUNT_NO = :acct
    `, { coopId: COOP_ID, acct: ACCT, cutoff: REPORT_DATE, cutoff2: REPORT_DATE });
    console.log(`\n=== PRNC count by cutoff ${REPORT_DATE} ===`);
    for (const r of prncCount) {
        console.log(`  total=${r.TOTAL_PRNC}, before=${r.PRNC_BEFORE_CUTOFF}, after=${r.PRNC_AFTER_CUTOFF}`);
    }

    // 2) DPDEPTMASTER info
    const master = await db.execute(`
        SELECT DEPTOPEN_DATE, DEPTCLOSE_DATE, DEPTCLOSE_STATUS, DEPTTYPE_CODE, MEMBCAT_CODE
        FROM ${OWNER}.DPDEPTMASTER
        WHERE COOP_ID = :coopId AND DEPTACCOUNT_NO = :acct
    `, { coopId: COOP_ID, acct: ACCT });
    console.log(`\n=== DPDEPTMASTER ===`);
    for (const r of master) {
        console.log(`  open=${r.DEPTOPEN_DATE?.toISOString().slice(0,10)}, close=${r.DEPTCLOSE_DATE?.toISOString().slice(0,10)}, status=${r.DEPTCLOSE_STATUS}, type=${r.DEPTTYPE_CODE}, membcat=${r.MEMBCAT_CODE}`);
    }

    // 3) Current rate from DPDEPTINTRATE
    const rate = await db.execute(`
        SELECT ir.INTEREST_RATE, ir.EFFECTIVE_DATE, ir.DEPT_STEP, ir.DEPTTYPE_CODE, ir.MEMBCAT_CODE
        FROM ${OWNER}.DPDEPTINTRATE ir
        WHERE ir.COOP_ID = :coopId AND ir.DEPTTYPE_CODE = '07'
          AND ir.EFFECTIVE_DATE = (
              SELECT MAX(ir2.EFFECTIVE_DATE)
              FROM ${OWNER}.DPDEPTINTRATE ir2
              WHERE ir2.COOP_ID = ir.COOP_ID AND ir2.DEPTTYPE_CODE = ir.DEPTTYPE_CODE
                AND ir2.MEMBCAT_CODE = ir.MEMBCAT_CODE
                AND ir2.EFFECTIVE_DATE <= TO_DATE(:rateDate, 'YYYY-MM-DD')
          )
          AND ir.DEPT_STEP = (
              SELECT MAX(ir3.DEPT_STEP)
              FROM ${OWNER}.DPDEPTINTRATE ir3
              WHERE ir3.COOP_ID = ir.COOP_ID AND ir3.DEPTTYPE_CODE = ir.DEPTTYPE_CODE
                AND ir3.MEMBCAT_CODE = ir.MEMBCAT_CODE AND ir3.EFFECTIVE_DATE = ir.EFFECTIVE_DATE
          )
        ORDER BY ir.MEMBCAT_CODE
    `, { coopId: COOP_ID, rateDate: REPORT_DATE });
    console.log(`\n=== DPDEPTINTRATE (type=07, as of ${REPORT_DATE}) ===`);
    for (const r of rate) {
        console.log(`  membcat=${r.MEMBCAT_CODE}, rate=${r.INTEREST_RATE}, eff=${r.EFFECTIVE_DATE?.toISOString().slice(0,10)}, step=${r.DEPT_STEP}`);
    }

    // 4) Simulate the report query for this account
    const reportDate = new Date(REPORT_DATE);
    const calcDays = (fromDate, toDate) => {
        const f = fromDate instanceof Date ? fromDate : new Date(fromDate);
        const t = toDate instanceof Date ? toDate : new Date(toDate);
        const fromUTC = Date.UTC(f.getFullYear(), f.getMonth(), f.getDate());
        const toUTC = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
        return Math.round((toUTC - fromUTC) / (1000 * 60 * 60 * 24));
    };

    // Find NEXT_DUE_DATE
    let nextDue = null;
    for (const r of prnc) {
        if (r.PRNCDUE_DATE) {
            const dueLocal = new Date(r.PRNCDUE_DATE);
            const dueUTC = Date.UTC(dueLocal.getFullYear(), dueLocal.getMonth(), dueLocal.getDate());
            const repUTC = Date.UTC(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate());
            if (dueUTC >= repUTC) {
                if (!nextDue || dueUTC < Date.UTC(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate())) {
                    nextDue = dueLocal;
                }
            }
        }
    }

    const days = nextDue ? calcDays(reportDate, nextDue) : 0;
    // Balance with PRNC_DATE cutoff
    let balCutoff = 0;
    for (const r of prnc) {
        if (r.PRNC_DATE) {
            const pLocal = new Date(r.PRNC_DATE);
            const pUTC = Date.UTC(pLocal.getFullYear(), pLocal.getMonth(), pLocal.getDate());
            const repUTC = Date.UTC(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate());
            if (pUTC <= repUTC) balCutoff += (r.PRNC_BAL || 0);
        }
    }
    console.log(`  SUM (after cutoff <= ${REPORT_DATE}): bal=${balCutoff}`);
    const bal = balCutoff;
    const intRate = rate.length > 0 ? rate[0].INTEREST_RATE : 0;

    console.log(`\n=== Calculation ===`);
    console.log(`  BALANCE: ${bal}`);
    console.log(`  NEXT_DUE (local): ${nextDue ? `${nextDue.getFullYear()}-${String(nextDue.getMonth()+1).padStart(2,'0')}-${String(nextDue.getDate()).padStart(2,'0')}` : 'null'}`);
    console.log(`  REPORT_DATE: ${REPORT_DATE}`);
    console.log(`  DAYS (calcDays): ${days}`);
    console.log(`  RATE: ${intRate}`);
    console.log(`  INT_TO_DUE (bal*days/365*rate): ${Math.round(bal * days / 365 * intRate * 100) / 100}`);
    console.log(`  INT_MONTHS: ${days > 0 ? Math.ceil(days / 30) : 0}`);

    // Try with 366 (leap year base)
    console.log(`  INT_TO_DUE (bal*days/366*rate): ${Math.round(bal * days / 366 * intRate * 100) / 100}`);

    // Try expected: work backwards from 78.07
    console.log(`\n=== Reverse-engineer expected 78.07 ===`);
    if (intRate && days) {
        const expectedBal = 78.07 * 365 / (days * intRate);
        console.log(`  If 365: bal = ${expectedBal}`);
        const expectedBal2 = 74.68 * 365 / (days * intRate);
        console.log(`  Current 74.68 implies bal = ${expectedBal2}`);
    }
    // Also try with sumBal (no cutoff)
    console.log(`\n=== With sumBal (no cutoff) = ${sumBal} ===`);
    console.log(`  INT_TO_DUE (sumBal*days/365*rate): ${Math.round(sumBal * days / 365 * intRate * 100) / 100}`);

    await db.close();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
