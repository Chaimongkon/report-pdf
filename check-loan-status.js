/**
 * Diagnostic Script: ตรวจสอบ 13 รายการคำขอกู้ที่สถานะยังเป็น "รออนุมัติ"
 * ทั้งที่เกิดสัญญาเงินกู้ไปแล้ว
 *
 * Tables:
 *   LNREQLOAN      — คำขอกู้ (LOANREQUEST_DOCNO, LOANREQUEST_STATUS, LOANCONTRACT_NO)
 *   LNREQLOANCLR   — รายละเอียดคำขอกู้ที่ clear แล้ว (เชื่อมสัญญาเก่าที่ปิด)
 *   LNCONTMASTER   — สัญญาเงินกู้ (LOANCONTRACT_NO, CONTRACT_STATUS)
 *
 * LOANREQUEST_STATUS: -9=ยกเลิก, -1=?, 1=อนุมัติแล้ว, 8=รออนุมัติ(ค้าง), 12=?
 *
 * Usage: node check-loan-status.js
 */
require("dotenv").config();
const oracledb = require("oracledb");

const OWNER = "ISCODOH";
const COOP_ID = "056001";

// 13 รายการจากภาพ (ใบคำขอกู้ = LOANREQUEST_DOCNO)
const LOAN_REQUESTS = [
  { no: 1,  reqNo: "2569-01394",  loanType: "005", memberNo: "00023901", name: "นายสิริภพ ศิรินแก้ว" },
  { no: 2,  reqNo: "2569-00568",  loanType: "026", memberNo: "00016879", name: "นางจรินทร์ วุฒิวิทยาการ" },
  { no: 3,  reqNo: "2569-01743",  loanType: "026", memberNo: "00011422", name: "นายชาดา กรชวน" },
  { no: 4,  reqNo: "2569-00483",  loanType: "030", memberNo: "00021859", name: "นายวิริช สัมปชัย" },
  { no: 5,  reqNo: "2569-01479",  loanType: "033", memberNo: "00905788", name: "นายคำดี คำมูล" },
  { no: 6,  reqNo: "2569-01419",  loanType: "043", memberNo: "00918521", name: "นางสาวบุญจวรรณ แก้ว" },
  { no: 7,  reqNo: "2569-01212",  loanType: "043", memberNo: "00902321", name: "นางสาววลัยลักษณ์ พรห" },
  { no: 8,  reqNo: "2569-01171",  loanType: "043", memberNo: "00919890", name: "นางสาวเสาวนีย์ พรมอำ" },
  { no: 9,  reqNo: "2569-01391",  loanType: "043", memberNo: "00912371", name: "นางศิริรัตน์ ศิสุกใส" },
  { no: 10, reqNo: "2569-00444",  loanType: "043", memberNo: "00900856", name: "นางวรรณดี หนูเล็ก" },
  { no: 11, reqNo: "2569-00545",  loanType: "043", memberNo: "00920048", name: "นายศรายุทธ์ งามดี" },
  { no: 12, reqNo: "2569-01474",  loanType: "043", memberNo: "00920646", name: "นายเทพพิชิต ร่วมใจ" },
  { no: 13, reqNo: "M256900563", loanType: "071", memberNo: "00502638", name: "นายสุริยา พรมตาไก่" },
];

const STATUS_MAP = {
  "-9": "ยกเลิก",
  "-1": "ไม่ผ่าน",
  "0": "รอบันทึก",
  "1": "อนุมัติแล้ว",
  "8": "รออนุมัติ",
  "12": "อื่นๆ",
};

function fmtDate(d) {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear() + 543;
  return `${dd}/${mm}/${yy}`;
}

function fmtNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  let connection;
  try {
    console.log("=".repeat(90));
    console.log("  ตรวจสอบคำขอกู้ 13 รายการ ที่สถานะ 'รออนุมัติ' แต่มีสัญญาเงินกู้แล้ว");
    console.log("=".repeat(90));

    connection = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
    });
    console.log("[Oracle] Connected\n");

    const reqNos = LOAN_REQUESTS.map(r => r.reqNo);
    const reqPlaceholders = reqNos.map((_, i) => `:r${i}`).join(",");
    const binds = { coopId: COOP_ID };
    reqNos.forEach((r, i) => { binds[`r${i}`] = r; });

    // ═══════════════════════════════════════════════════════════════════
    // Step 1: ดึงข้อมูลคำขอกู้ทั้ง 13 รายการจาก LNREQLOAN
    // ═══════════════════════════════════════════════════════════════════
    console.log("─".repeat(90));
    console.log("Step 1: ข้อมูลคำขอกู้ 13 รายการ (LNREQLOAN)");
    console.log("─".repeat(90));

    const reqRows = await query(connection,
      `SELECT
         r.LOANREQUEST_DOCNO,
         r.MEMBER_NO,
         r.LOANTYPE_CODE,
         r.LOANREQUEST_DATE,
         r.LOANREQUEST_AMT,
         r.LOANAPPROVE_AMT,
         r.LOANREQUEST_STATUS,
         r.APPROVE_DATE,
         r.APPROVE_ID,
         r.LOANCONTRACT_NO,
         r.CONTNO_NUM,
         r.ENTRY_ID,
         r.ENTRY_DATE,
         r.CANCEL_ID,
         r.CANCEL_DATE,
         r.PAYMENT_STATUS
       FROM ${OWNER}.LNREQLOAN r
       WHERE r.COOP_ID = :coopId
       AND r.LOANREQUEST_DOCNO IN (${reqPlaceholders})
       ORDER BY r.LOANREQUEST_DOCNO`,
      binds
    );

    console.log(`พบ ${reqRows.length} / ${LOAN_REQUESTS.length} รายการ\n`);

    for (const r of reqRows) {
      const docNo = (r.LOANREQUEST_DOCNO || "").trim();
      const statusText = STATUS_MAP[String(r.LOANREQUEST_STATUS)] ?? `ไม่ทราบ(${r.LOANREQUEST_STATUS})`;
      const contractNo = (r.LOANCONTRACT_NO || "").trim();

      console.log(`  ${docNo.padEnd(12)} | สมาชิก ${(r.MEMBER_NO||"").trim()} | ประเภท ${(r.LOANTYPE_CODE||"").trim()} | วันที่ ${fmtDate(r.LOANREQUEST_DATE)} | จำนวน ${fmtNum(r.LOANREQUEST_AMT).padStart(12)}`);
      console.log(`${"".padEnd(15)}STATUS=${r.LOANREQUEST_STATUS} (${statusText}) | สัญญา: ${contractNo || "(ว่าง)"} | อนุมัติ: ${fmtDate(r.APPROVE_DATE)} โดย ${r.APPROVE_ID || "-"} | ผู้บันทึก: ${r.ENTRY_ID || "-"}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 2: ดึงข้อมูล LNREQLOANCLR (สัญญาเก่าที่ต้อง clear)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n" + "─".repeat(90));
    console.log("Step 2: สัญญาเก่าที่เชื่อมกับคำขอกู้ (LNREQLOANCLR)");
    console.log("─".repeat(90));

    const clrRows = await query(connection,
      `SELECT c.LOANREQUEST_DOCNO, c.LOANCONTRACT_NO, c.LOANTYPE_CODE,
              c.LOANAPPROVE_AMT, c.PRINCIPAL_BALANCE, c.CLEAR_STATUS, c.CLEAR_PRNAMT
       FROM ${OWNER}.LNREQLOANCLR c
       WHERE c.COOP_ID = :coopId
       AND c.LOANREQUEST_DOCNO IN (${reqPlaceholders})
       ORDER BY c.LOANREQUEST_DOCNO`,
      binds
    );

    console.log(`พบ ${clrRows.length} รายการใน LNREQLOANCLR\n`);
    for (const c of clrRows) {
      const docNo = (c.LOANREQUEST_DOCNO || "").trim();
      const contNo = (c.LOANCONTRACT_NO || "").trim();
      const lt = (c.LOANTYPE_CODE || "").trim();
      const clearStatus = c.CLEAR_STATUS === 1 ? "ปิดแล้ว" : c.CLEAR_STATUS === 0 ? "ยังไม่ปิด" : `สถานะ=${c.CLEAR_STATUS}`;
      console.log(`  คำขอ ${docNo.padEnd(12)} → สัญญาเก่า ${contNo.padEnd(16)} ประเภท ${lt} | อนุมัติ ${fmtNum(c.LOANAPPROVE_AMT).padStart(12)} | คงเหลือ ${fmtNum(c.PRINCIPAL_BALANCE).padStart(12)} | CLR: ${clearStatus} (ปิด ${fmtNum(c.CLEAR_PRNAMT)})`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 3: ค้นหาสัญญาใน LNCONTMASTER ที่อ้างอิง LOANREQUEST_DOCNO ตรงกัน
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n" + "─".repeat(90));
    console.log("Step 3: สัญญาใหม่ใน LNCONTMASTER ที่อ้างอิงคำขอกู้เหล่านี้");
    console.log("─".repeat(90));

    const contRows = await query(connection,
      `SELECT cm.LOANCONTRACT_NO, cm.MEMBER_NO, cm.LOANTYPE_CODE,
              cm.LOANREQUEST_DOCNO, cm.LOANAPPROVE_DATE, cm.LOANAPPROVE_AMT,
              cm.PRINCIPAL_BALANCE, cm.CONTRACT_STATUS, cm.APPROVE_ID,
              cm.STARTCONT_DATE, cm.CLOSECONT_DATE
       FROM ${OWNER}.LNCONTMASTER cm
       WHERE cm.COOP_ID = :coopId
       AND cm.LOANREQUEST_DOCNO IN (${reqPlaceholders})
       ORDER BY cm.LOANREQUEST_DOCNO`,
      binds
    );

    console.log(`พบ ${contRows.length} สัญญาใน LNCONTMASTER ที่อ้างอิงคำขอกู้ 13 รายการ\n`);
    for (const cm of contRows) {
      const docNo = (cm.LOANREQUEST_DOCNO || "").trim();
      const contNo = (cm.LOANCONTRACT_NO || "").trim();
      const lt = (cm.LOANTYPE_CODE || "").trim();
      const status = cm.CONTRACT_STATUS === 0 ? "เปิดอยู่" : cm.CONTRACT_STATUS === 1 ? "ปิดแล้ว" : `สถานะ=${cm.CONTRACT_STATUS}`;
      console.log(`  คำขอ ${docNo.padEnd(12)} → สัญญาใหม่ ${contNo.padEnd(16)} ประเภท ${lt} | อนุมัติ ${fmtDate(cm.LOANAPPROVE_DATE)} ${fmtNum(cm.LOANAPPROVE_AMT).padStart(12)} | คงเหลือ ${fmtNum(cm.PRINCIPAL_BALANCE).padStart(12)} | ${status} | โดย ${cm.APPROVE_ID || "-"}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 4: สรุป Cross-check
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n" + "─".repeat(90));
    console.log("Step 4: สรุป Cross-check ทั้ง 13 รายการ");
    console.log("─".repeat(90));

    // Build lookup maps
    const reqMap = {};
    for (const r of reqRows) reqMap[(r.LOANREQUEST_DOCNO||"").trim()] = r;
    const contMap = {};
    for (const c of contRows) {
      const docNo = (c.LOANREQUEST_DOCNO || "").trim();
      if (!contMap[docNo]) contMap[docNo] = [];
      contMap[docNo].push(c);
    }
    const clrMap = {};
    for (const c of clrRows) {
      const docNo = (c.LOANREQUEST_DOCNO || "").trim();
      if (!clrMap[docNo]) clrMap[docNo] = [];
      clrMap[docNo].push(c);
    }

    const issues = [];
    console.log();
    for (const req of LOAN_REQUESTS) {
      const r = reqMap[req.reqNo];
      const contracts = contMap[req.reqNo] || [];
      const clears = clrMap[req.reqNo] || [];
      const hasNewContract = contracts.length > 0;
      const hasClr = clears.length > 0;
      const statusVal = r ? r.LOANREQUEST_STATUS : "?";
      const statusText = STATUS_MAP[String(statusVal)] ?? `ไม่ทราบ(${statusVal})`;

      const icon = hasNewContract ? "✓" : "✗";
      console.log(`${icon} [${String(req.no).padStart(2)}] ${req.reqNo.padEnd(12)} สมาชิก ${req.memberNo} | STATUS=${statusVal} (${statusText})`);

      if (hasNewContract) {
        for (const c of contracts) {
          console.log(`       → สัญญาใหม่: ${(c.LOANCONTRACT_NO||"").trim()} อนุมัติ ${fmtNum(c.LOANAPPROVE_AMT)} คงเหลือ ${fmtNum(c.PRINCIPAL_BALANCE)}`);
        }
      }
      if (hasClr) {
        for (const c of clears) {
          const cs = c.CLEAR_STATUS === 1 ? "ปิดแล้ว" : "ยังเปิด";
          console.log(`       → สัญญาเก่า(CLR): ${(c.LOANCONTRACT_NO||"").trim()} คงเหลือ ${fmtNum(c.PRINCIPAL_BALANCE)} [${cs}]`);
        }
      }
      if (!hasNewContract && !hasClr) {
        console.log(`       → ไม่พบสัญญาใดๆ ที่อ้างอิงคำขอนี้`);
      }

      // Record issue
      if (hasNewContract && statusVal !== 1) {
        issues.push({ req, status: statusVal, contracts });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 5: วิเคราะห์สาเหตุ + แนวทางแก้ไข
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n\n" + "=".repeat(90));
    console.log("  วิเคราะห์สาเหตุ + แนวทางแก้ไข");
    console.log("=".repeat(90));

    const allStatus8 = reqRows.filter(r => r.LOANREQUEST_STATUS === 8);
    const withNewContract = LOAN_REQUESTS.filter(r => (contMap[r.reqNo] || []).length > 0);
    const withoutNewContract = LOAN_REQUESTS.filter(r => (contMap[r.reqNo] || []).length === 0);

    console.log(`\n  ทั้ง 13 รายการมี LOANREQUEST_STATUS = 8 (รออนุมัติ)`);
    console.log(`  - มีสัญญาใหม่ใน LNCONTMASTER แล้ว: ${withNewContract.length} รายการ`);
    console.log(`  - ไม่มีสัญญาใหม่: ${withoutNewContract.length} รายการ`);

    if (withNewContract.length > 0) {
      console.log(`\n  >>> ปัญหาหลัก: มี ${withNewContract.length} รายการที่สร้างสัญญาเงินกู้ใหม่ไปแล้ว`);
      console.log("      แต่ LOANREQUEST_STATUS ใน LNREQLOAN ยังค้างเป็น 8 (รออนุมัติ)");
      console.log("      และ LOANCONTRACT_NO ใน LNREQLOAN ยังว่างเปล่า");
      console.log("\n  สาเหตุที่เป็นไปได้:");
      console.log("    1. ขั้นตอนการสร้างสัญญา (LNCONTMASTER) ไม่ได้ update กลับไปที่ LNREQLOAN");
      console.log("    2. Transaction ถูก commit บางส่วน — สัญญาสร้างได้ แต่ status คำขอไม่ถูก update");
      console.log("    3. มีการสร้างสัญญาผ่านช่องทางอื่น (เช่น import หรือ batch) ที่ไม่ได้ update LNREQLOAN");
      console.log("    4. Bug ในระบบ GCOOP ที่ทำให้ขั้นตอน update LNREQLOAN ถูกข้าม");

      // Generate fix SQL
      const docNosToFix = withNewContract.map(r => `'${r.reqNo}'`).join(", ");
      console.log("\n  แนวทางแก้ไข (ต้อง DBA ตรวจสอบก่อนรัน):\n");
      console.log("  -- 1) Update LOANREQUEST_STATUS เป็น 1 (อนุมัติ)");
      console.log("  -- 2) เติม LOANCONTRACT_NO จาก LNCONTMASTER");
      console.log();

      for (const req of withNewContract) {
        const conts = contMap[req.reqNo];
        if (conts && conts.length > 0) {
          const c = conts[0];
          const contNo = (c.LOANCONTRACT_NO || "").trim();
          console.log(`  UPDATE ${OWNER}.LNREQLOAN`);
          console.log(`  SET LOANREQUEST_STATUS = 1,`);
          console.log(`      LOANCONTRACT_NO = '${contNo}',`);
          console.log(`      CONTNO_NUM = '${contNo}',`);
          console.log(`      APPROVE_DATE = TO_DATE('${fmtDate(c.LOANAPPROVE_DATE)}','DD/MM/YYYY'),`);
          console.log(`      APPROVE_ID = '${c.APPROVE_ID || ""}',`);
          console.log(`      LOANAPPROVE_AMT = ${c.LOANAPPROVE_AMT || 0}`);
          console.log(`  WHERE COOP_ID = '${COOP_ID}' AND LOANREQUEST_DOCNO = '${req.reqNo}';`);
          console.log();
        }
      }
    }

    if (withoutNewContract.length > 0) {
      console.log(`\n  >>> ${withoutNewContract.length} รายการที่ยังไม่มีสัญญาใหม่ใน LNCONTMASTER (ค้นจาก LOANREQUEST_DOCNO):`);
      for (const req of withoutNewContract) {
        const clears = clrMap[req.reqNo] || [];
        console.log(`    - ${req.reqNo} (${req.name}) — สัญญาเก่า CLR: ${clears.length} รายการ`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Step 6: ค้นหาสัญญาล่าสุดของ 12 สมาชิกที่ไม่พบสัญญาใหม่ (ค้นจาก MEMBER_NO + LOANTYPE_CODE)
    // ═══════════════════════════════════════════════════════════════════
    if (withoutNewContract.length > 0) {
      console.log("\n" + "─".repeat(90));
      console.log("Step 6: ค้นหาสัญญาล่าสุดใน LNCONTMASTER จาก MEMBER_NO + ประเภทเงินกู้");
      console.log("─".repeat(90));

      for (const req of withoutNewContract) {
        const r = reqMap[req.reqNo];
        const reqAmt = r ? r.LOANREQUEST_AMT : 0;
        const reqDate = r ? r.LOANREQUEST_DATE : null;

        // ค้นหาสัญญาล่าสุดของสมาชิกคนนี้ ตรงประเภท ที่สร้างตั้งแต่ปี 2568 เป็นต้นไป
        const recentContracts = await query(connection,
          `SELECT LOANCONTRACT_NO, LOANTYPE_CODE, LOANREQUEST_DOCNO,
                  LOANAPPROVE_DATE, LOANAPPROVE_AMT, PRINCIPAL_BALANCE,
                  CONTRACT_STATUS, APPROVE_ID
           FROM ${OWNER}.LNCONTMASTER
           WHERE COOP_ID = :coopId AND MEMBER_NO = :memberNo
           AND LOANTYPE_CODE = :loanType
           AND LOANAPPROVE_DATE >= TO_DATE('2025-01-01','YYYY-MM-DD')
           ORDER BY LOANAPPROVE_DATE DESC`,
          { coopId: COOP_ID, memberNo: req.memberNo, loanType: req.loanType }
        );

        const icon = recentContracts.length > 0 ? "✓" : "✗";
        console.log(`\n${icon} ${req.reqNo.padEnd(12)} สมาชิก ${req.memberNo} ประเภท ${req.loanType} (ขอ ${fmtNum(reqAmt)})`);

        if (recentContracts.length > 0) {
          for (const c of recentContracts) {
            const contNo = (c.LOANCONTRACT_NO || "").trim();
            const linkedReq = (c.LOANREQUEST_DOCNO || "").trim();
            const status = c.CONTRACT_STATUS === 0 ? "เปิดอยู่" : "ปิด";
            console.log(`       สัญญา: ${contNo.padEnd(16)} คำขอ: ${linkedReq.padEnd(12)} อนุมัติ ${fmtDate(c.LOANAPPROVE_DATE)} ${fmtNum(c.LOANAPPROVE_AMT).padStart(12)} คงเหลือ ${fmtNum(c.PRINCIPAL_BALANCE).padStart(12)} [${status}] โดย ${c.APPROVE_ID || "-"}`);
          }
        } else {
          console.log(`       ไม่พบสัญญาประเภท ${req.loanType} ที่สร้างตั้งแต่ปี 2568`);
        }
      }
    }

    console.log("\n" + "=".repeat(90));
    console.log("  ตรวจสอบเสร็จสิ้น");
    console.log("=".repeat(90));

  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    if (connection) {
      await connection.close();
      console.log("[Oracle] Connection closed");
    }
  }
}

async function query(conn, sql, binds = {}) {
  const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return result.rows;
}

main();
