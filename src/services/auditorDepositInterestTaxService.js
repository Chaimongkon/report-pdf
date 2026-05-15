const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานสรุปดอกเบี้ยและภาษี หัก ณ ที่จ่าย (สำหรับผู้ตรวจสอบบัญชี)
 *
 * แสดงรายการจ่ายดอกเบี้ย+ภาษีหัก ณ ที่จ่าย จาก DPDEPTSLIP
 * กรองเฉพาะรายการที่มี INT_AMT > 0 หรือ TAX_AMT > 0
 *
 * 9 ฟิลด์ตามข้อกำหนด + ภาษีเพิ่มเติม (ตามหัวรายงาน "ดอกเบี้ยและภาษี")
 */

function buildWhere(filters) {
  let whereClause = "WHERE s.CANCEL_DATE IS NULL AND (NVL(s.INT_AMT,0) > 0 OR NVL(s.TAX_AMT,0) > 0)";
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

  return { whereClause, binds };
}

async function getInterestList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 1000;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  // ยอดคงเหลือเดิม = ยอดคงเหลือใหม่ (PRNCBAL) − (INT_AMT − TAX_AMT)
  //   เพราะการจ่ายดอกเบี้ยเพิ่มยอด INT_AMT แล้วหักภาษี TAX_AMT ออก
  const sql = `
    SELECT * FROM (
      SELECT
        dm.MEMBER_NO,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        pn.PRENAME_DESC,
        s.DEPTACCOUNT_NO,
        s.BANKACCOUNT_NAME,
        s.DEPTSLIP_NO,
        s.DEPTSLIP_DATE,
        s.DEPTITEMTYPE_CODE,
        it.DEPTITEMTYPE_DESC,
        NVL(s.INT_AMT, 0)   AS INT_AMT,
        NVL(s.TAX_AMT, 0)   AS TAX_AMT,
        NVL(s.PRNCBAL, 0)   AS BALANCE_NEW,
        (NVL(s.PRNCBAL, 0) - NVL(s.INT_AMT, 0) + NVL(s.TAX_AMT, 0)) AS BALANCE_OLD,
        s.DEPTTYPE_CODE,
        dt.DEPTTYPE_DESC
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
      ORDER BY s.DEPTSLIP_DATE, dm.MEMBER_NO, s.DEPTACCOUNT_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    const memberName = [r.PRENAME_DESC, r.MEMB_NAME, r.MEMB_SURNAME].filter(Boolean).join(" ").trim();
    // Account name preference: bank account name if set, else member name
    const accountName = (r.BANKACCOUNT_NAME && r.BANKACCOUNT_NAME.trim()) ? r.BANKACCOUNT_NAME.trim() : memberName;
    const acctNo = r.DEPTACCOUNT_NO != null ? String(r.DEPTACCOUNT_NO).trim() : "";
    return {
      ...r,
      MEMBER_NO: memberNo,
      MEMBER_NAME: memberName,
      ACCOUNT_NAME: accountName,
      DEPTACCOUNT_NO: acctNo,
      INT_AMT: Number(r.INT_AMT) || 0,
      TAX_AMT: Number(r.TAX_AMT) || 0,
      BALANCE_NEW: Number(r.BALANCE_NEW) || 0,
      BALANCE_OLD: Number(r.BALANCE_OLD) || 0,
    };
  });
}

async function getAuditorDepositInterestTaxData(filters = {}) {
  const items = await getInterestList(filters);

  const fmtDateTH = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear() + 543}`;
  };

  let memberInfo = "ทั้งหมด";
  if (filters.memberNo) {
    const m = await db.execute(
      `SELECT m.MEMBER_NO, m.MEMB_NAME, m.MEMB_SURNAME, pn.PRENAME_DESC
       FROM ${OWNER}.MBMEMBMASTER m
       LEFT JOIN ${OWNER}.MBUCFPRENAME pn ON m.PRENAME_CODE = pn.PRENAME_CODE
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
      `SELECT MIN(DEPTTYPE_DESC) AS DEPTTYPE_DESC FROM ${OWNER}.DPDEPTTYPE
       WHERE COOP_ID = '056001' AND DEPTTYPE_CODE = :code`,
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

  const sumInt = items.reduce((s, x) => s + x.INT_AMT, 0);
  const sumTax = items.reduce((s, x) => s + x.TAX_AMT, 0);
  const distinctAccounts = new Set(items.map((x) => x.DEPTACCOUNT_NO)).size;
  const distinctMembers = new Set(items.map((x) => x.MEMBER_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  const asOfLabel = filters.endDate ? fmtDateTH(filters.endDate) : reportDate;

  return {
    reportTitle: `รายงานสรุปดอกเบี้ยและภาษี หัก ณ ที่จ่าย ณ ${asOfLabel}`,
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalItems: items.length,
      distinctMembers,
      distinctAccounts,
      sumInt,
      sumTax,
      sumNet: sumInt - sumTax,
    },
    items,
  };
}

async function getLookups() {
  const deptTypes = await db.execute(
    `SELECT DEPTTYPE_CODE, MIN(DEPTTYPE_DESC) AS DEPTTYPE_DESC
     FROM ${OWNER}.DPDEPTTYPE WHERE COOP_ID = '056001'
     GROUP BY DEPTTYPE_CODE ORDER BY DEPTTYPE_CODE`
  );
  return { deptTypes };
}

module.exports = { getAuditorDepositInterestTaxData, getLookups };
