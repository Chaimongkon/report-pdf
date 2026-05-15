const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานฝาก/ถอน เงินฝาก (สำหรับผู้ตรวจสอบบัญชี)
 *
 * แสดงรายการเคลื่อนไหวเงินฝากในช่วงวันที่ระบุ จาก DPDEPTSLIP
 *
 * 10 ฟิลด์ตามข้อกำหนด: membership_no, deptaccount_no, name, slip_date,
 *   item_type_code, slip_amt, prnc_bal, depttype_code, depttype_desc, item_desc
 */

function buildWhere(filters) {
  let whereClause = "WHERE 1=1 AND s.CANCEL_DATE IS NULL";
  const binds = {};

  if (filters.startDate) {
    whereClause += " AND s.DEPTSLIP_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD')";
    binds.startDate = filters.startDate;
  }
  if (filters.endDate) {
    whereClause += " AND s.DEPTSLIP_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD')";
    binds.endDate = filters.endDate;
  }
  if (filters.memberNo) {
    whereClause += " AND dm.MEMBER_NO = :memberNo";
    binds.memberNo = filters.memberNo;
  }
  if (filters.deptAccountNo) {
    whereClause += " AND s.DEPTACCOUNT_NO = :deptAccountNo";
    binds.deptAccountNo = filters.deptAccountNo;
  }
  if (filters.deptTypeCode) {
    whereClause += " AND s.DEPTTYPE_CODE = :deptTypeCode";
    binds.deptTypeCode = filters.deptTypeCode;
  }
  if (filters.itemTypeCode) {
    whereClause += " AND s.DEPTITEMTYPE_CODE = :itemTypeCode";
    binds.itemTypeCode = filters.itemTypeCode;
  }

  return { whereClause, binds };
}

async function getTransactionList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 1000;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT
        dm.MEMBER_NO,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        pn.PRENAME_DESC,
        s.DEPTACCOUNT_NO,
        s.DEPTSLIP_NO,
        s.DEPTSLIP_DATE,
        s.DEPTITEMTYPE_CODE,
        it.DEPTITEMTYPE_DESC,
        s.DEPTSLIP_AMT,
        s.PRNCBAL,
        s.DEPTTYPE_CODE,
        dt.DEPTTYPE_DESC,
        s.INT_AMT,
        s.TAX_AMT,
        s.FEE_AMT,
        s.CASH_TYPE,
        s.REMARK
      FROM ${OWNER}.DPDEPTSLIP s
      LEFT JOIN ${OWNER}.DPDEPTMASTER dm    ON s.COOP_ID = dm.COOP_ID AND s.DEPTACCOUNT_NO = dm.DEPTACCOUNT_NO
      LEFT JOIN ${OWNER}.MBMEMBMASTER m     ON dm.COOP_ID = m.COOP_ID AND dm.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn    ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN (
        SELECT COOP_ID, DEPTTYPE_CODE, MIN(DEPTTYPE_DESC) AS DEPTTYPE_DESC
        FROM ${OWNER}.DPDEPTTYPE
        GROUP BY COOP_ID, DEPTTYPE_CODE
      ) dt ON s.COOP_ID = dt.COOP_ID AND s.DEPTTYPE_CODE = dt.DEPTTYPE_CODE
      LEFT JOIN (
        SELECT COOP_ID, DEPTITEMTYPE_CODE, MIN(DEPTITEMTYPE_DESC) AS DEPTITEMTYPE_DESC
        FROM ${OWNER}.DPUCFDEPTITEMTYPE
        GROUP BY COOP_ID, DEPTITEMTYPE_CODE
      ) it ON s.COOP_ID = it.COOP_ID AND s.DEPTITEMTYPE_CODE = it.DEPTITEMTYPE_CODE
      ${whereClause}
      ORDER BY s.DEPTSLIP_DATE, dm.MEMBER_NO, s.DEPTACCOUNT_NO, s.DEPTSLIP_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    const memberName = [r.PRENAME_DESC, r.MEMB_NAME, r.MEMB_SURNAME].filter(Boolean).join(" ").trim();
    const acctNo = r.DEPTACCOUNT_NO != null ? String(r.DEPTACCOUNT_NO).trim() : "";
    return {
      ...r,
      MEMBER_NO: memberNo,
      MEMBER_NAME: memberName,
      DEPTACCOUNT_NO: acctNo,
      DEPTSLIP_AMT: r.DEPTSLIP_AMT || 0,
      PRNCBAL: r.PRNCBAL || 0,
      INT_AMT: r.INT_AMT || 0,
      TAX_AMT: r.TAX_AMT || 0,
    };
  });
}

async function getAuditorDepositTransactionData(filters = {}) {
  const items = await getTransactionList(filters);

  const fmtDateTH = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear() + 543}`;
  };

  let memberInfo = "ทั้งหมด";
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
      memberInfo = `${m[0].PRENAME_DESC || ""}${m[0].MEMB_NAME} ${m[0].MEMB_SURNAME} (${filters.memberNo})`;
    }
  }

  let deptTypeDesc = "ทุกประเภท";
  if (filters.deptTypeCode) {
    const d = await db.execute(
      `SELECT DEPTTYPE_DESC FROM ${OWNER}.DPDEPTTYPE WHERE COOP_ID = '056001' AND DEPTTYPE_CODE = :code AND ROWNUM = 1`,
      { code: filters.deptTypeCode }
    );
    deptTypeDesc = d.length > 0 ? d[0].DEPTTYPE_DESC : filters.deptTypeCode;
  }

  const filterLabels = {
    dateRange: (filters.startDate || filters.endDate)
      ? `${fmtDateTH(filters.startDate)} - ${fmtDateTH(filters.endDate)}`
      : "ทั้งหมด",
    memberInfo,
    deptTypeDesc,
    deptAccountNo: filters.deptAccountNo || "ทั้งหมด",
  };

  const sumAmt = items.reduce((s, x) => s + (Number(x.DEPTSLIP_AMT) || 0), 0);
  const sumInt = items.reduce((s, x) => s + (Number(x.INT_AMT) || 0), 0);
  const distinctMembers = new Set(items.map((x) => x.MEMBER_NO)).size;
  const distinctAccounts = new Set(items.map((x) => x.DEPTACCOUNT_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานฝาก/ถอน เงินฝาก (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalItems: items.length,
      distinctMembers,
      distinctAccounts,
      sumAmt,
      sumInt,
    },
    items,
  };
}

async function getLookups() {
  const [deptTypes, itemTypes] = await Promise.all([
    db.execute(`SELECT DISTINCT DEPTTYPE_CODE, DEPTTYPE_DESC FROM ${OWNER}.DPDEPTTYPE WHERE COOP_ID = '056001' ORDER BY DEPTTYPE_CODE`),
    db.execute(`SELECT DEPTITEMTYPE_CODE, DEPTITEMTYPE_DESC FROM ${OWNER}.DPUCFDEPTITEMTYPE WHERE COOP_ID = '056001' ORDER BY DEPTITEMTYPE_CODE`),
  ]);
  return { deptTypes, itemTypes };
}

module.exports = { getAuditorDepositTransactionData, getLookups };
