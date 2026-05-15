const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานส่งเก็บหุ้น-หนี้ เงินรับฝาก รายเดือน (สำหรับผู้ตรวจสอบบัญชี)
 *
 * 1 บรรทัด = 1 ใบเสร็จ (KPMASTRECEIVE) ของสมาชิก 1 คน ใน 1 เดือนเก็บ
 * แตก KPMASTRECEIVEDET ออกเป็นหุ้น/เงินฝาก/เงินกู้ฉุกเฉิน(L01)/สามัญ(L02)/พิเศษ(L03,L04)
 *
 * 27 ฟิลด์ตามข้อกำหนด
 */

function buildWhere(filters) {
  // RECV_PERIOD เก็บเป็น YYYYMM (พุทธศักราช) เช่น '256901' = ม.ค. 2569
  let whereClause = "WHERE 1=1";
  const binds = {};

  if (filters.startDate && filters.endDate) {
    // แปลงเป็น recv_period YYYYMM พ.ศ.
    const s = new Date(filters.startDate);
    const e = new Date(filters.endDate);
    const sPer = `${s.getFullYear() + 543}${String(s.getMonth() + 1).padStart(2, "0")}`;
    const ePer = `${e.getFullYear() + 543}${String(e.getMonth() + 1).padStart(2, "0")}`;
    whereClause += ` AND k.RECV_PERIOD BETWEEN :startPer AND :endPer`;
    binds.startPer = sPer;
    binds.endPer = ePer;
  }

  if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }

  if (filters.memberNo) {
    whereClause += " AND k.MEMBER_NO = :memberNo";
    binds.memberNo = filters.memberNo;
  }

  // ตัดรายการที่ถูกยกเลิก (ดูจาก ADJREASON_CODE หรือ KEEPING_STATUS=-1)
  whereClause += " AND NVL(k.KEEPING_STATUS, 1) >= 0";

  return { whereClause, binds };
}

async function getCollectionList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  // For each (member, receipt), use correlated subqueries to pivot KPMASTRECEIVEDET
  // by KEEPITEMTYPE group.
  // - SHR: S01,S02,S03,S05,S06 (หุ้น)
  // - DEP: D00,D01,D02 (เงินฝาก)
  // - L01: เงินกู้ฉุกเฉิน
  // - L02: เงินกู้สามัญ
  // - L03/L04: เงินกู้พิเศษ
  // For loan groups: take the contract with smallest SEQ_NO (= first appears on receipt)
  const sql = `
    SELECT * FROM (
      SELECT
        k.MEMBER_NO,
        k.KPSLIP_NO,
        k.RECV_PERIOD,
        k.RECEIPT_NO,
        k.RECEIPT_DATE,
        k.RECEIVE_AMT,
        pn.PRENAME_DESC,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        m.MEMBGROUP_CODE,
        mg.MEMBGROUP_DESC,
        -- หุ้น (SHR)
        (SELECT MAX(d.PERIOD) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE LIKE 'S%') AS SHARE_PERIOD,
        (SELECT NVL(SUM(NVL(d.ITEM_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE LIKE 'S%') AS SHARE_VALUE,
        -- เงินฝาก (DEP)
        (SELECT NVL(SUM(NVL(d.ITEM_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE LIKE 'D%') AS DEPSAV_AMT,
        -- เงินกู้ฉุกเฉิน (L01) — เลือกสัญญา SEQ_NO น้อยสุด
        (SELECT MIN(d.SHRLONTYPE_CODE) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_LOANTYPE,
        (SELECT MIN(d.LOANCONTRACT_NO) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_CONTRACT,
        (SELECT MAX(d.PERIOD) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_PERIOD,
        (SELECT NVL(SUM(NVL(d.PRINCIPAL_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_PRINCIPAL,
        (SELECT NVL(SUM(NVL(d.INTEREST_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_INTEREST,
        (SELECT NVL(SUM(NVL(d.ITEM_BALANCE,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L01') AS EMER_BALANCE,
        -- เงินกู้สามัญ (L02)
        (SELECT MIN(d.SHRLONTYPE_CODE) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_LOANTYPE,
        (SELECT MIN(d.LOANCONTRACT_NO) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_CONTRACT,
        (SELECT MAX(d.PERIOD) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_PERIOD,
        (SELECT NVL(SUM(NVL(d.PRINCIPAL_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_PRINCIPAL,
        (SELECT NVL(SUM(NVL(d.INTEREST_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_INTEREST,
        (SELECT NVL(SUM(NVL(d.ITEM_BALANCE,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE = 'L02') AS NORM_BALANCE,
        -- เงินกู้พิเศษ (L03, L04)
        (SELECT MIN(d.SHRLONTYPE_CODE) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_LOANTYPE,
        (SELECT MIN(d.LOANCONTRACT_NO) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_CONTRACT,
        (SELECT MAX(d.PERIOD) KEEP (DENSE_RANK FIRST ORDER BY d.SEQ_NO)
           FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_PERIOD,
        (SELECT NVL(SUM(NVL(d.PRINCIPAL_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_PRINCIPAL,
        (SELECT NVL(SUM(NVL(d.INTEREST_PAYMENT,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_INTEREST,
        (SELECT NVL(SUM(NVL(d.ITEM_BALANCE,0)),0) FROM ${OWNER}.KPMASTRECEIVEDET d
          WHERE d.COOP_ID = k.COOP_ID AND d.KPSLIP_NO = k.KPSLIP_NO
            AND d.KEEPITEMTYPE_CODE IN ('L03','L04')) AS SPEC_BALANCE
      FROM ${OWNER}.KPMASTRECEIVE k
      LEFT JOIN ${OWNER}.MBMEMBMASTER m    ON k.COOP_ID = m.COOP_ID AND k.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn   ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      ${whereClause}
      ORDER BY k.RECV_PERIOD, k.MEMBER_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    // Format RECV_PERIOD "256901" → "01/2569"
    let recvPeriodFmt = r.RECV_PERIOD || "";
    if (recvPeriodFmt && recvPeriodFmt.length >= 6) {
      recvPeriodFmt = `${recvPeriodFmt.substring(4, 6)}/${recvPeriodFmt.substring(0, 4)}`;
    }
    return {
      ...r,
      MEMBER_NO: memberNo,
      RECV_PERIOD_FMT: recvPeriodFmt,
      SHARE_VALUE: Number(r.SHARE_VALUE) || 0,
      DEPSAV_AMT: Number(r.DEPSAV_AMT) || 0,
      EMER_PRINCIPAL: Number(r.EMER_PRINCIPAL) || 0,
      EMER_INTEREST: Number(r.EMER_INTEREST) || 0,
      EMER_BALANCE: Number(r.EMER_BALANCE) || 0,
      NORM_PRINCIPAL: Number(r.NORM_PRINCIPAL) || 0,
      NORM_INTEREST: Number(r.NORM_INTEREST) || 0,
      NORM_BALANCE: Number(r.NORM_BALANCE) || 0,
      SPEC_PRINCIPAL: Number(r.SPEC_PRINCIPAL) || 0,
      SPEC_INTEREST: Number(r.SPEC_INTEREST) || 0,
      SPEC_BALANCE: Number(r.SPEC_BALANCE) || 0,
    };
  });
}

async function getAuditorMonthlyCollectionData(filters = {}) {
  const items = await getCollectionList(filters);

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
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear() + 543}`;
  };

  const filterLabels = {
    membGroupDesc,
    dateRange: (filters.startDate || filters.endDate)
      ? `${fmtDateTH(filters.startDate)} - ${fmtDateTH(filters.endDate)}`
      : "ทั้งหมด",
  };

  const sumShare = items.reduce((s, x) => s + x.SHARE_VALUE, 0);
  const sumDep = items.reduce((s, x) => s + x.DEPSAV_AMT, 0);
  const sumEmerPrn = items.reduce((s, x) => s + x.EMER_PRINCIPAL, 0);
  const sumNormPrn = items.reduce((s, x) => s + x.NORM_PRINCIPAL, 0);
  const sumSpecPrn = items.reduce((s, x) => s + x.SPEC_PRINCIPAL, 0);

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานส่งเก็บหุ้น-หนี้ เงินรับฝาก รายเดือน (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalReceipts: items.length,
      sumShare,
      sumDep,
      sumEmerPrn,
      sumNormPrn,
      sumSpecPrn,
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

module.exports = { getAuditorMonthlyCollectionData, getLookups };
