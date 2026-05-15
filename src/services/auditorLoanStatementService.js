const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * Statement หนี้รายตัวของสมาชิก (สำหรับผู้ตรวจสอบบัญชี)
 *
 * แสดงรายการเคลื่อนไหวในสัญญาเงินกู้ของสมาชิก จาก LNCONTSTATEMENT
 * ในช่วงวันที่ระบุ (เช่น 1 ม.ค. 2569 - ปัจจุบัน)
 *
 * 15 ฟิลด์ตามข้อกำหนด
 */

function buildWhere(filters) {
  let whereClause = "WHERE 1=1";
  const binds = {};

  if (filters.startDate) {
    whereClause += " AND s.SLIP_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD')";
    binds.startDate = filters.startDate;
  }
  if (filters.endDate) {
    whereClause += " AND s.SLIP_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD')";
    binds.endDate = filters.endDate;
  }
  if (filters.memberNo) {
    whereClause += " AND c.MEMBER_NO = :memberNo";
    binds.memberNo = filters.memberNo;
  }
  if (filters.loanContractNo) {
    whereClause += " AND s.LOANCONTRACT_NO = :loanContractNo";
    binds.loanContractNo = filters.loanContractNo;
  }
  if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }

  return { whereClause, binds };
}

async function getStatementList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 1000;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT
        c.MEMBER_NO,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        pn.PRENAME_DESC,
        s.LOANCONTRACT_NO,
        s.SEQ_NO,
        s.SLIP_DATE,
        s.OPERATE_DATE,
        s.CALINT_FROM,
        s.CALINT_TO,
        s.PERIOD,
        s.LOANITEMTYPE_CODE,
        s.PRINCIPAL_PAYMENT,
        s.INTEREST_PAYMENT,
        s.PRINCIPAL_BALANCE,
        s.INTEREST_PERIOD,
        s.INTEREST_ARREAR,
        s.REF_SLIPNO,
        s.REF_DOCNO,
        it.LOANITEMTYPE_DESC
      FROM ${OWNER}.LNCONTSTATEMENT s
      JOIN ${OWNER}.LNCONTMASTER c    ON s.COOP_ID = c.COOP_ID AND s.LOANCONTRACT_NO = c.LOANCONTRACT_NO
      LEFT JOIN ${OWNER}.MBMEMBMASTER m       ON c.COOP_ID = m.COOP_ID AND c.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.LNUCFLOANITEMTYPE it ON s.LOANITEMTYPE_CODE = it.LOANITEMTYPE_CODE
      ${whereClause}
      ORDER BY c.MEMBER_NO, s.LOANCONTRACT_NO, s.SLIP_DATE, s.SEQ_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    return {
      ...r,
      MEMBER_NO: memberNo,
      PRINCIPAL_PAYMENT: r.PRINCIPAL_PAYMENT || 0,
      INTEREST_PAYMENT: r.INTEREST_PAYMENT || 0,
      PRINCIPAL_BALANCE: r.PRINCIPAL_BALANCE || 0,
      INTEREST_PERIOD: r.INTEREST_PERIOD || 0,
      INTEREST_ARREAR: r.INTEREST_ARREAR || 0,
    };
  });
}

async function getAuditorLoanStatementData(filters = {}) {
  const items = await getStatementList(filters);

  let memberInfo = "";
  if (filters.memberNo) {
    const m = await db.execute(
      `SELECT m.MEMBER_NO, m.MEMB_NAME, m.MEMB_SURNAME, pn.PRENAME_DESC, mg.MEMBGROUP_DESC
       FROM ${OWNER}.MBMEMBMASTER m
       LEFT JOIN ${OWNER}.MBUCFPRENAME pn ON m.PRENAME_CODE = pn.PRENAME_CODE
       LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
       WHERE m.MEMBER_NO = :no`,
      { no: filters.memberNo }
    );
    if (m.length > 0) {
      memberInfo = `${m[0].PRENAME_DESC || ""}${m[0].MEMB_NAME} ${m[0].MEMB_SURNAME} (${filters.memberNo}) — ${m[0].MEMBGROUP_DESC || ""}`;
    }
  }

  const fmtDateTH = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear() + 543}`;
  };

  const filterLabels = {
    dateRange: (filters.startDate || filters.endDate)
      ? `${fmtDateTH(filters.startDate)} - ${fmtDateTH(filters.endDate)}`
      : "ทั้งหมด",
    memberInfo: memberInfo || "ทั้งหมด",
    loanContractNo: filters.loanContractNo || "ทุกสัญญา",
  };

  // Summary
  const sumPrn = items.reduce((s, x) => s + (Number(x.PRINCIPAL_PAYMENT) || 0), 0);
  const sumInt = items.reduce((s, x) => s + (Number(x.INTEREST_PAYMENT) || 0), 0);
  const distinctContracts = new Set(items.map((x) => x.LOANCONTRACT_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "Statement หนี้รายตัวของสมาชิก (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalItems: items.length,
      distinctContracts,
      sumPrn,
      sumInt,
    },
    items,
  };
}

async function getLookups() {
  const membGroups = await db.execute(
    `SELECT MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' ORDER BY MEMBGROUP_CODE`
  );
  return { membGroups };
}

module.exports = { getAuditorLoanStatementData, getLookups };
