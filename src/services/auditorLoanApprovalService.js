const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานรายละเอียดการอนุมัติและจ่ายเงินกู้ (สำหรับผู้ตรวจสอบบัญชี)
 * 25 ฟิลด์ตามข้อกำหนด: ข้อมูลผู้กู้ + คำขอกู้ + อนุมัติ + ชำระหนี้เดิม + หุ้น + ประกัน + รับจริง
 *
 * ดึงจาก LNREQLOAN เป็นหลัก (ใบคำขอกู้ที่ผ่านการอนุมัติแล้ว) ในช่วง APPROVE_DATE
 * JOIN LNCONTMASTER, LNUCFLOANOBJECTIVE, LNUCFPAYMENTTYPE, CMUCFBANK, MBMEMBMASTER ฯลฯ
 */

function buildWhere(filters) {
  let whereClause = "WHERE r.APPROVE_DATE IS NOT NULL";
  const binds = {};

  if (filters.startDate && filters.endDate) {
    whereClause += " AND r.APPROVE_DATE BETWEEN TO_DATE(:startDate, 'YYYY-MM-DD') AND TO_DATE(:endDate, 'YYYY-MM-DD')";
    binds.startDate = filters.startDate;
    binds.endDate = filters.endDate;
  } else if (filters.startDate) {
    whereClause += " AND r.APPROVE_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD')";
    binds.startDate = filters.startDate;
  } else if (filters.endDate) {
    whereClause += " AND r.APPROVE_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD')";
    binds.endDate = filters.endDate;
  }

  if (filters.loanTypeCode) {
    whereClause += " AND r.LOANTYPE_CODE = :loanTypeCode";
    binds.loanTypeCode = filters.loanTypeCode;
  }

  if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }

  // เฉพาะใบคำขอที่อนุมัติแล้ว (status = 1) และไม่ถูกยกเลิก
  whereClause += " AND r.LOANREQUEST_STATUS = 1 AND r.CANCEL_DATE IS NULL";

  return { whereClause, binds };
}

async function getLoanApprovalList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT
        r.LOANREQUEST_DOCNO,
        r.LOANREQUEST_DATE,
        r.APPROVE_DATE,
        r.APPROVE_ID,
        r.MEMBER_NO,
        r.LOANTYPE_CODE,
        lt.LOANTYPE_DESC,
        r.LOANREQUEST_AMT,
        r.LOANAPPROVE_AMT,
        r.LOANCONTRACT_NO,
        r.PERIOD_PAYAMT       AS NUM_INSTALLMENTS,
        r.PERIOD_PAYMENT      AS PERIOD_PAYMENT_AMT,
        r.LOANPAYMENT_TYPE,
        pt.LOANPAYMENT_DESC,
        r.SHARE_BALANCE       AS SHARE_STOCK_AT_LOAN,
        r.SHARE_PAR           AS SHARE_BUY_AMT,
        (SELECT NVL(SUM(NVL(co.CLROTHER_AMT,0)),0) FROM ${OWNER}.LNREQLOANCLROTHER co
           WHERE co.COOP_ID = r.COOP_ID AND co.LOANREQUEST_DOCNO = r.LOANREQUEST_DOCNO
             AND co.CLROTHERTYPE_CODE = 'INS') AS INSURANCE_AMT,
        r.RECVESTIMATE_AMT    AS REAL_RECEIVE_AMT,
        r.SALARY_AMT,
        r.LOANOBJECTIVE_CODE,
        obj.LOANOBJECTIVE_DESC,
        r.EXPENSE_ACCID       AS BANK_ACC_NO,
        r.EXPENSE_BANK        AS BANK_CODE,
        bk.BANK_DESC,
        r.ENTRY_ID,
        po.PAYOUTSLIP_NO      AS RECEIVE_NO,
        po.PAYOUTNET_AMT      AS PAYOUT_NET_AMT,
        po.SLIP_DATE          AS PAYOUT_DATE,
        c.STARTCONT_DATE,
        c.STARTKEEP_PERIOD,
        pn.PRENAME_DESC,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        mg.MEMBGROUP_DESC,
        (SELECT NVL(SUM(NVL(clr.CLEAR_PRNAMT,0)),0) FROM ${OWNER}.LNREQLOANCLR clr
           WHERE clr.COOP_ID = r.COOP_ID AND clr.LOANREQUEST_DOCNO = r.LOANREQUEST_DOCNO) AS CLEAR_PRN_AMT,
        (SELECT NVL(SUM(NVL(clr.CLEAR_INTAMT,0)),0) FROM ${OWNER}.LNREQLOANCLR clr
           WHERE clr.COOP_ID = r.COOP_ID AND clr.LOANREQUEST_DOCNO = r.LOANREQUEST_DOCNO) AS CLEAR_INT_AMT
      FROM ${OWNER}.LNREQLOAN r
      LEFT JOIN ${OWNER}.MBMEMBMASTER m         ON r.COOP_ID = m.COOP_ID AND r.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn        ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg      ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      LEFT JOIN ${OWNER}.LNLOANTYPE lt          ON r.COOP_ID = lt.COOP_ID AND r.LOANTYPE_CODE = lt.LOANTYPE_CODE
      LEFT JOIN ${OWNER}.LNUCFPAYMENTTYPE pt    ON r.COOP_ID = pt.COOP_ID AND r.LOANPAYMENT_TYPE = pt.LOANPAYMENT_TYPE
      LEFT JOIN ${OWNER}.LNUCFLOANOBJECTIVE obj ON r.COOP_ID = obj.COOP_ID AND r.LOANOBJECTIVE_CODE = obj.LOANOBJECTIVE_CODE
      LEFT JOIN ${OWNER}.LNCONTMASTER c         ON r.COOP_ID = c.COOP_ID AND r.LOANCONTRACT_NO = c.LOANCONTRACT_NO
      LEFT JOIN ${OWNER}.CMUCFBANK bk           ON r.EXPENSE_BANK = bk.BANK_CODE
      LEFT JOIN (
        SELECT COOP_ID, LOANREQUEST_DOCNO,
               MAX(PAYOUTSLIP_NO) KEEP (DENSE_RANK FIRST ORDER BY SLIP_DATE DESC, PAYOUTSLIP_NO DESC) AS PAYOUTSLIP_NO,
               MAX(SLIP_DATE)     KEEP (DENSE_RANK FIRST ORDER BY SLIP_DATE DESC, PAYOUTSLIP_NO DESC) AS SLIP_DATE,
               MAX(PAYOUTNET_AMT) KEEP (DENSE_RANK FIRST ORDER BY SLIP_DATE DESC, PAYOUTSLIP_NO DESC) AS PAYOUTNET_AMT
        FROM ${OWNER}.SLSLIPPAYOUT
        WHERE CANCEL_DATE IS NULL
        GROUP BY COOP_ID, LOANREQUEST_DOCNO
      ) po ON r.COOP_ID = po.COOP_ID AND r.LOANREQUEST_DOCNO = po.LOANREQUEST_DOCNO
      ${whereClause}
      ORDER BY r.APPROVE_DATE DESC, r.LOANREQUEST_DOCNO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    const memberName = [r.PRENAME_DESC, r.MEMB_NAME, r.MEMB_SURNAME].filter(Boolean).join(" ").trim();
    // แปลง STARTKEEP_PERIOD (เช่น "256905") เป็น "พ.ค. 2569"
    let startKeepText = "";
    if (r.STARTKEEP_PERIOD) {
      const s = String(r.STARTKEEP_PERIOD).trim();
      if (s.length >= 6) {
        const year = s.substring(0, 4);
        const month = s.substring(4, 6);
        const monthNames = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        const mi = parseInt(month, 10);
        startKeepText = monthNames[mi] ? `${monthNames[mi]} ${year}` : s;
      } else {
        startKeepText = s;
      }
    }
    // ใช้รับจริงจาก SLSLIPPAYOUT.PAYOUTNET_AMT ถ้ามี ไม่งั้น fallback ไป RECVESTIMATE_AMT
    const realReceive = (r.PAYOUT_NET_AMT != null && Number(r.PAYOUT_NET_AMT) !== 0)
      ? Number(r.PAYOUT_NET_AMT)
      : (r.REAL_RECEIVE_AMT || 0);
    return {
      ...r,
      MEMBER_NO: memberNo,
      MEMBER_NAME: memberName,
      START_KEEP_TEXT: startKeepText,
      CLEAR_PRN_AMT: r.CLEAR_PRN_AMT || 0,
      CLEAR_INT_AMT: r.CLEAR_INT_AMT || 0,
      SHARE_STOCK_AT_LOAN: r.SHARE_STOCK_AT_LOAN || 0,
      SHARE_BUY_AMT: r.SHARE_BUY_AMT || 0,
      INSURANCE_AMT: r.INSURANCE_AMT || 0,
      REAL_RECEIVE_AMT: realReceive,
    };
  });
}

async function getAuditorLoanApprovalData(filters = {}) {
  const loans = await getLoanApprovalList(filters);

  let loanTypeDesc = "ทั้งหมด";
  if (filters.loanTypeCode) {
    const t = await db.execute(
      `SELECT LOANTYPE_DESC FROM ${OWNER}.LNLOANTYPE WHERE COOP_ID = '056001' AND LOANTYPE_CODE = :code`,
      { code: filters.loanTypeCode }
    );
    loanTypeDesc = t.length > 0 ? t[0].LOANTYPE_DESC : filters.loanTypeCode;
  }

  let membGroupDesc = "ทั้งหมด";
  if (filters.membGroupCode) {
    const g = await db.execute(
      `SELECT MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' AND MEMBGROUP_CODE = :code`,
      { code: filters.membGroupCode }
    );
    membGroupDesc = g.length > 0 ? g[0].MEMBGROUP_DESC.trim() : filters.membGroupCode;
  }

  const fmtDateTH = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${dt.getFullYear() + 543}`;
  };

  const filterLabels = {
    loanTypeDesc,
    membGroupDesc,
    dateRange: (filters.startDate || filters.endDate)
      ? `${fmtDateTH(filters.startDate)} - ${fmtDateTH(filters.endDate)}`
      : "ทั้งหมด",
  };

  // Summary
  const totalApprove = loans.reduce((s, x) => s + (Number(x.LOANAPPROVE_AMT) || 0), 0);
  const totalReceive = loans.reduce((s, x) => s + (Number(x.REAL_RECEIVE_AMT) || 0), 0);

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานรายละเอียดการอนุมัติและจ่ายเงินกู้ (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalLoans: loans.length,
      totalApprove,
      totalReceive,
    },
    loans,
  };
}

async function getLoanLookups() {
  const [loanTypes, membGroups] = await Promise.all([
    db.execute(`SELECT LOANTYPE_CODE, LOANTYPE_DESC FROM ${OWNER}.LNLOANTYPE WHERE COOP_ID = '056001' ORDER BY LOANTYPE_CODE`),
    db.execute(`SELECT MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' ORDER BY MEMBGROUP_CODE`),
  ]);
  return { loanTypes, membGroups };
}

module.exports = { getAuditorLoanApprovalData, getLoanLookups };
