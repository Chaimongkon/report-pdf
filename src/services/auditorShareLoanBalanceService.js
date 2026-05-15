const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานหุ้น-หนี้คงเหลือรายตัว ณ วันที่ X (สำหรับผู้ตรวจสอบบัญชี)
 *
 * หนึ่งบรรทัด = หนึ่งสัญญาเงินกู้ที่ยังมียอดคงค้าง (CONTRACT_STATUS = 1, PRINCIPAL_BALANCE > 0)
 * พร้อมข้อมูลหุ้นของสมาชิกผู้กู้
 *
 * 14 ฟิลด์ตามข้อกำหนด: ปีบัญชี/เดือนบัญชี/เลขทะเบียน/หน่วยงาน/รหัสหุ้น_หนี้/
 *   เลขสัญญา/ยอดคงเหลือ/งวดล่าสุด/งวดทั้งสิ้น/ค่าหุ้นต่องวด/หุ้นคงเหลือ/เงินงวด/
 *   ดอกเบี้ยค้าง/จำนวนวัน
 */

function buildWhere(filters) {
  let whereClause = `WHERE c.CONTRACT_STATUS = 1 AND NVL(c.PRINCIPAL_BALANCE, 0) > 0`;
  const binds = {};

  if (filters.asOfDate) {
    whereClause += ` AND c.STARTCONT_DATE <= TO_DATE(:asOfDate, 'YYYY-MM-DD')
                     AND (c.CLOSECONT_DATE IS NULL OR c.CLOSECONT_DATE > TO_DATE(:asOfDate, 'YYYY-MM-DD'))`;
    binds.asOfDate = filters.asOfDate;
  }

  if (filters.loanTypeCode) {
    whereClause += " AND c.LOANTYPE_CODE = :loanTypeCode";
    binds.loanTypeCode = filters.loanTypeCode;
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

async function getShareLoanList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;
  binds.asOfDateDays = filters.asOfDate || new Date().toISOString().substring(0, 10);

  // For each contract, attach the primary share holding (SHARETYPE_CODE = '01' หุ้นสามัญ)
  // and compute days from LASTCALINT_DATE (or STARTCONT_DATE) to as-of date for interest accrual
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
        c.LAST_PERIODPAY      AS LAST_PERIOD,
        c.PERIOD_PAYAMT       AS MAX_PERIOD,
        c.PERIOD_PAYMENT      AS PERIOD_PAYMENT_AMT,
        c.INTEREST_ARREAR,
        c.STARTCONT_DATE,
        c.LASTCALINT_DATE,
        c.LASTRECEIVE_DATE,
        sh.PERIODSHARE_BAHT   AS PERIODSHARE_AMT,
        sh.SHARESTK_BAHT      AS SHARESTK_AMT,
        sh.SHARETYPE_CODE,
        GREATEST(0, FLOOR(TO_DATE(:asOfDateDays, 'YYYY-MM-DD') - NVL(c.LASTRECEIVE_DATE, c.STARTCONT_DATE))) AS REPORT_DAY
      FROM ${OWNER}.LNCONTMASTER c
      LEFT JOIN ${OWNER}.MBMEMBMASTER m       ON c.COOP_ID = m.COOP_ID AND c.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg    ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      LEFT JOIN ${OWNER}.LNLOANTYPE lt        ON c.COOP_ID = lt.COOP_ID AND c.LOANTYPE_CODE = lt.LOANTYPE_CODE
      LEFT JOIN (
        SELECT sm.COOP_ID, sm.MEMBER_NO,
               MAX(sm.SHARETYPE_CODE) KEEP (DENSE_RANK FIRST ORDER BY sm.SHARETYPE_CODE) AS SHARETYPE_CODE,
               SUM(NVL(sm.PERIODSHARE_AMT,0) * NVL(st.UNITSHARE_VALUE, 1)) AS PERIODSHARE_BAHT,
               SUM(NVL(sm.SHARESTK_VALUE, 0)) AS SHARESTK_BAHT
        FROM ${OWNER}.SHSHAREMASTER sm
        LEFT JOIN ${OWNER}.SHSHARETYPE st
               ON sm.COOP_ID = st.COOP_ID AND sm.SHARETYPE_CODE = st.SHARETYPE_CODE
        GROUP BY sm.COOP_ID, sm.MEMBER_NO
      ) sh ON c.COOP_ID = sh.COOP_ID AND c.MEMBER_NO = sh.MEMBER_NO
      ${whereClause}
      ORDER BY c.MEMBER_NO, c.LOANCONTRACT_NO
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
      PERIODSHARE_AMT: r.PERIODSHARE_AMT || 0,
      SHARESTK_AMT: r.SHARESTK_AMT || 0,
      INTEREST_ARREAR: r.INTEREST_ARREAR || 0,
      REPORT_DAY: r.REPORT_DAY != null ? Number(r.REPORT_DAY) : 0,
    };
  });
}

async function getAuditorShareLoanBalanceData(filters = {}) {
  const items = await getShareLoanList(filters);

  // Parse asOfDate into year/month for header
  const asOfDate = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
  const accountYear = asOfDate.getFullYear() + 543;
  const accountMonth = String(asOfDate.getMonth() + 1).padStart(2, "0");

  // Attach account_year/month to every row
  items.forEach((it) => {
    it.ACCOUNT_YEAR = accountYear;
    it.ACCOUNT_MONTH = accountMonth;
  });

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
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear() + 543}`;
  };

  const filterLabels = {
    loanTypeDesc,
    membGroupDesc,
    asOfDate: fmtDateTH(filters.asOfDate),
    accountYear: String(accountYear),
    accountMonth,
  };

  // Summary
  const totalBalance = items.reduce((s, x) => s + (Number(x.PRINCIPAL_BALANCE) || 0), 0);
  const totalShareStock = items.reduce((s, x) => s + (Number(x.SHARESTK_AMT) || 0), 0);
  const totalIntArrear = items.reduce((s, x) => s + (Number(x.INTEREST_ARREAR) || 0), 0);
  const distinctMembers = new Set(items.map((x) => x.MEMBER_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: `รายงานหุ้น-หนี้คงเหลือรายตัว ณ ${filterLabels.asOfDate || reportDate}`,
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalContracts: items.length,
      distinctMembers,
      totalBalance,
      totalShareStock,
      totalIntArrear,
    },
    items,
  };
}

async function getLookups() {
  const [loanTypes, membGroups] = await Promise.all([
    db.execute(`SELECT LOANTYPE_CODE, LOANTYPE_DESC FROM ${OWNER}.LNLOANTYPE WHERE COOP_ID = '056001' ORDER BY LOANTYPE_CODE`),
    db.execute(`SELECT MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' ORDER BY MEMBGROUP_CODE`),
  ]);
  return { loanTypes, membGroups };
}

module.exports = { getAuditorShareLoanBalanceData, getLookups };
