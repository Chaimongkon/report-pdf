const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานดอกเบี้ยค้างชำระ และจำนวนงวดที่ค้างชำระ ณ วันที่ X
 *
 * Filter: เฉพาะสัญญาที่ค้างชำระ
 *   - INTEREST_ARREAR > 0 (มีดอกเบี้ยค้างชำระจริงในระบบ) หรือ
 *   - ไม่มีการชำระเกิน 1 เดือน (LASTRECEIVE_DATE < asOfDate - 1 month)
 *
 * 8 ฟิลด์ตามข้อกำหนด: membership_no, memb_name, membgroup_code, membgroup_desc,
 *   loancontract_no, principal_balance, count_rpm, interest_arrear
 */

function buildWhere(filters) {
  let whereClause = `WHERE c.CONTRACT_STATUS = 1 AND NVL(c.PRINCIPAL_BALANCE, 0) > 0`;
  const binds = {};

  if (filters.asOfDate) {
    whereClause += ` AND c.STARTCONT_DATE <= TO_DATE(:asOfDate, 'YYYY-MM-DD')
                     AND (c.CLOSECONT_DATE IS NULL OR c.CLOSECONT_DATE > TO_DATE(:asOfDate, 'YYYY-MM-DD'))`;
    binds.asOfDate = filters.asOfDate;
  }

  // Filter mode:
  //  'int_only'   = เฉพาะมีดอกเบี้ยค้าง (INTEREST_ARREAR > 0)
  //  'all_overdue' = ดอกเบี้ยค้าง OR ค้างเกิน 1 เดือน (default)
  const filterMode = filters.filterMode || "all_overdue";
  if (filterMode === "int_only") {
    whereClause += " AND NVL(c.INTEREST_ARREAR, 0) > 0";
  } else {
    if (filters.asOfDate) {
      whereClause += `
        AND (
          NVL(c.INTEREST_ARREAR, 0) > 0
          OR (c.LASTRECEIVE_DATE IS NULL AND c.STARTCONT_DATE < ADD_MONTHS(TO_DATE(:asOfDate, 'YYYY-MM-DD'), -1))
          OR (c.LASTRECEIVE_DATE < ADD_MONTHS(TO_DATE(:asOfDate, 'YYYY-MM-DD'), -1))
        )`;
    } else {
      whereClause += " AND NVL(c.INTEREST_ARREAR, 0) > 0";
    }
  }

  if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }

  if (filters.memberNo) {
    whereClause += " AND c.MEMBER_NO = :memberNo";
    binds.memberNo = filters.memberNo;
  }

  return { whereClause, binds };
}

async function getArrearsList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);
  binds.asOfDateCalc = filters.asOfDate || new Date().toISOString().substring(0, 10);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  // count_rpm: คำนวณจาก MONTHS_BETWEEN(asOfDate, lastReceive) แล้วปัดลง
  //           สำหรับสัญญาที่ไม่เคยชำระ ใช้ STARTCONT_DATE แทน
  const sql = `
    SELECT * FROM (
      SELECT
        c.MEMBER_NO,
        m.MEMBGROUP_CODE,
        mg.MEMBGROUP_DESC,
        pn.PRENAME_DESC,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        c.LOANCONTRACT_NO,
        c.LOANTYPE_CODE,
        lt.LOANTYPE_DESC,
        c.PRINCIPAL_BALANCE,
        c.INTEREST_ARREAR,
        c.LASTRECEIVE_DATE,
        c.STARTCONT_DATE,
        GREATEST(0, FLOOR(MONTHS_BETWEEN(
          TO_DATE(:asOfDateCalc, 'YYYY-MM-DD'),
          NVL(c.LASTRECEIVE_DATE, c.STARTCONT_DATE)
        ))) AS COUNT_RPM
      FROM ${OWNER}.LNCONTMASTER c
      LEFT JOIN ${OWNER}.MBMEMBMASTER m       ON c.COOP_ID = m.COOP_ID AND c.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg    ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      LEFT JOIN ${OWNER}.LNLOANTYPE lt        ON c.COOP_ID = lt.COOP_ID AND c.LOANTYPE_CODE = lt.LOANTYPE_CODE
      ${whereClause}
      ORDER BY c.INTEREST_ARREAR DESC, c.PRINCIPAL_BALANCE DESC
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  return rows.map((r) => {
    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    const memberName = [r.PRENAME_DESC, r.MEMB_NAME, r.MEMB_SURNAME].filter(Boolean).join(" ").trim();
    return {
      ...r,
      MEMBER_NO: memberNo,
      MEMBER_NAME: memberName,
      INTEREST_ARREAR: r.INTEREST_ARREAR || 0,
      PRINCIPAL_BALANCE: r.PRINCIPAL_BALANCE || 0,
      COUNT_RPM: r.COUNT_RPM != null ? Number(r.COUNT_RPM) : 0,
    };
  });
}

async function getAuditorInterestArrearsData(filters = {}) {
  const items = await getArrearsList(filters);

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

  const filterModeLabel = (filters.filterMode === "int_only")
    ? "เฉพาะมีดอกเบี้ยค้าง"
    : "ดอกเบี้ยค้าง หรือ ค้างเกิน 1 เดือน";

  const filterLabels = {
    membGroupDesc,
    asOfDate: fmtDateTH(filters.asOfDate),
    filterModeLabel,
  };

  const totalBalance = items.reduce((s, x) => s + (Number(x.PRINCIPAL_BALANCE) || 0), 0);
  const totalIntArrear = items.reduce((s, x) => s + (Number(x.INTEREST_ARREAR) || 0), 0);
  const distinctMembers = new Set(items.map((x) => x.MEMBER_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: `รายงานดอกเบี้ยค้างชำระ และจำนวนงวดที่ค้างชำระ ณ ${filterLabels.asOfDate || reportDate}`,
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalContracts: items.length,
      distinctMembers,
      totalBalance,
      totalIntArrear,
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

module.exports = { getAuditorInterestArrearsData, getLookups };
