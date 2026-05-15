const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * Build WHERE clause based on MBREQAPPL (ใบคำขอสมัครสมาชิก)
 */
function buildWhere(filters) {
  let whereClause = "WHERE a.APPL_STATUS = 1";
  const binds = {};

  // Filter by application date (วันที่ใบสมัคร)
  if (filters.startDate && filters.endDate) {
    whereClause += " AND a.APPLY_DATE BETWEEN TO_DATE(:startDate, 'YYYY-MM-DD') AND TO_DATE(:endDate, 'YYYY-MM-DD')";
    binds.startDate = filters.startDate;
    binds.endDate = filters.endDate;
  } else if (filters.lastNDays) {
    whereClause += " AND a.APPLY_DATE >= SYSDATE - :lastNDays";
    binds.lastNDays = filters.lastNDays;
  }

  // Filter by member type
  if (filters.membTypeCode) {
    whereClause += " AND a.MEMBTYPE_CODE = :membTypeCode";
    binds.membTypeCode = filters.membTypeCode;
  }

  // Filter by member group
  if (filters.membGroupFrom && filters.membGroupTo) {
    whereClause += " AND a.MEMBGROUP_CODE BETWEEN :membGroupFrom AND :membGroupTo";
    binds.membGroupFrom = filters.membGroupFrom;
    binds.membGroupTo = filters.membGroupTo;
  } else if (filters.membGroupCode) {
    whereClause += " AND a.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }

  // Filter by application type (ประเภทการสมัคร)
  if (filters.applTypeCode) {
    whereClause += " AND a.APPLTYPE_CODE = :applTypeCode";
    binds.applTypeCode = filters.applTypeCode;
  }

  return { whereClause, binds };
}

/**
 * Get new members with their deposit account information
 */
async function getNewMembersWithDeposits(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT 
        a.APPL_DOCNO,
        a.MEMBER_NO,
        a.APPLY_DATE,
        a.APPLTYPE_CODE,
        apt.APPLTYPE_DESC,
        pn.PRENAME_DESC,
        a.MEMB_NAME,
        a.MEMB_SURNAME,
        mc.MEMBCAT_DESC,
        mt.MEMBTYPE_DESC,
        mg.MEMBGROUP_DESC,
        a.BIRTH_DATE,
        a.CARD_PERSON,
        a.MEM_TELMOBILE,
        a.SALARY_AMOUNT,
        a.PERIODSHARE_VALUE,
        m.MEMBER_DATE,
        m.MEMBER_STATUS,
        m.RESIGN_STATUS,
        m.RETIRE_STATUS,
        m.DEAD_STATUS,
        -- Get deposit account info from DPDEPTMASTER
        (SELECT dm.DEPTACCOUNT_NO 
         FROM ${OWNER}.DPDEPTMASTER dm 
         WHERE dm.MEMBER_NO = a.MEMBER_NO 
         AND dm.DEPTCLOSE_STATUS = 0
         AND dm.DEPTTYPE_CODE = '01'
         AND ROWNUM = 1) as DEPOSIT_ACCOUNT_NO,
        (SELECT dtt.DEPTTYPE_DESC 
         FROM ${OWNER}.DPDEPTMASTER dm 
         LEFT JOIN ${OWNER}.DPDEPTTYPE dtt ON dm.COOP_ID = dtt.COOP_ID AND dm.DEPTTYPE_CODE = dtt.DEPTTYPE_CODE
         WHERE dm.MEMBER_NO = a.MEMBER_NO 
         AND dm.DEPTCLOSE_STATUS = 0
         AND dm.DEPTTYPE_CODE = '01'
         AND ROWNUM = 1) as DEPOSIT_ACCOUNT_NAME,
        (SELECT pa.TOTAL_BAL 
         FROM ${OWNER}.DPDEPTMASTER dm 
         LEFT JOIN (
           SELECT pf.COOP_ID, pf.DEPTACCOUNT_NO, SUM(pf.PRNC_BAL) AS TOTAL_BAL
           FROM ${OWNER}.DPDEPTPRNCFIXED pf
           GROUP BY pf.COOP_ID, pf.DEPTACCOUNT_NO
         ) pa ON dm.COOP_ID = pa.COOP_ID AND dm.DEPTACCOUNT_NO = pa.DEPTACCOUNT_NO
         WHERE dm.MEMBER_NO = a.MEMBER_NO 
         AND dm.DEPTCLOSE_STATUS = 0
         AND dm.DEPTTYPE_CODE = '01'
         AND ROWNUM = 1) as DEPOSIT_BALANCE,
        -- Calculate age
        FLOOR(MONTHS_BETWEEN(SYSDATE, a.BIRTH_DATE) / 12) as AGE,
        -- Calculate months as member
        FLOOR(MONTHS_BETWEEN(SYSDATE, m.MEMBER_DATE)) as MONTHS_AS_MEMBER
      FROM ${OWNER}.MBREQAPPL a
      LEFT JOIN ${OWNER}.MBMEMBMASTER m       ON a.COOP_ID = m.COOP_ID AND a.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFAPPLTYPE apt    ON a.COOP_ID = apt.COOP_ID AND a.APPLTYPE_CODE = apt.APPLTYPE_CODE
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON a.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFCATEGORY mc     ON a.COOP_ID = mc.COOP_ID AND a.MEMBCAT_CODE = mc.MEMBCAT_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBTYPE mt     ON a.COOP_ID = mt.COOP_ID AND a.MEMBTYPE_CODE = mt.MEMBTYPE_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg    ON a.COOP_ID = mg.COOP_ID AND a.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      ${whereClause}
      ORDER BY a.MEMBER_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  // Process and format the data
  return rows.map((r) => {
    let statusText = "ปกติ";
    let statusClass = "active";
    if (r.DEAD_STATUS === 1) {
      statusText = "เสียชีวิต";
      statusClass = "dead";
    } else if (r.RESIGN_STATUS === 1) {
      statusText = "ลาออก";
      statusClass = "resigned";
    } else if (r.RETIRE_STATUS === 1) {
      statusText = "เกษียณ";
      statusClass = "retired";
    }

    const memberNo = r.MEMBER_NO != null ? String(r.MEMBER_NO).padStart(8, "0") : "";
    const cardPerson = r.CARD_PERSON != null ? String(r.CARD_PERSON).padStart(13, "0") : "";
    const telMobile = r.MEM_TELMOBILE != null ? String(r.MEM_TELMOBILE).replace(/\D/g, "").padStart(10, "0") : "";
    const depositAccountNo = r.DEPOSIT_ACCOUNT_NO != null ? String(r.DEPOSIT_ACCOUNT_NO).padStart(10, "0") : "-";

    return {
      ...r,
      MEMBER_NO: memberNo,
      CARD_PERSON: cardPerson,
      MEM_TELMOBILE: telMobile,
      DEPOSIT_ACCOUNT_NO: depositAccountNo,
      STATUS_TEXT: statusText,
      STATUS_CLASS: statusClass,
      MEMBTYPE_DISPLAY: r.MEMBTYPE_DESC || "",
      APPLTYPE_DISPLAY: r.APPLTYPE_DESC || "",
      HAS_DEPOSIT_ACCOUNT: r.DEPOSIT_ACCOUNT_NO ? "มี" : "-",
      DEPOSIT_BALANCE: r.DEPOSIT_BALANCE || 0
    };
  });
}

/**
 * Get summary statistics for new members with deposits
 */
async function getNewMembersDepositSummary(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const sql = `
    SELECT 
      COUNT(*) AS TOTAL_NEW_MEMBERS,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM ${OWNER}.DPDEPTMASTER dm 
        WHERE dm.MEMBER_NO = a.MEMBER_NO 
        AND dm.DEPTCLOSE_STATUS = 0
        AND dm.DEPTTYPE_CODE = '01'
      ) THEN 1 END) AS MEMBERS_WITH_DEPOSITS,
      COUNT(CASE WHEN NOT EXISTS (
        SELECT 1 FROM ${OWNER}.DPDEPTMASTER dm 
        WHERE dm.MEMBER_NO = a.MEMBER_NO 
        AND dm.DEPTCLOSE_STATUS = 0
        AND dm.DEPTTYPE_CODE = '01'
      ) THEN 1 END) AS MEMBERS_WITHOUT_DEPOSITS,
      NVL(ROUND(AVG(a.SALARY_AMOUNT), 2), 0) AS AVG_SALARY,
      NVL(ROUND(AVG(
        CASE WHEN EXISTS (
          SELECT 1 FROM ${OWNER}.DPDEPTMASTER dm 
          WHERE dm.MEMBER_NO = a.MEMBER_NO 
          AND dm.DEPTCLOSE_STATUS = 0
          AND dm.DEPTTYPE_CODE = '01'
        ) THEN (
          SELECT COALESCE(pa.TOTAL_BAL, 0)
          FROM ${OWNER}.DPDEPTMASTER dm 
          LEFT JOIN (
            SELECT pf.COOP_ID, pf.DEPTACCOUNT_NO, SUM(pf.PRNC_BAL) AS TOTAL_BAL
            FROM ${OWNER}.DPDEPTPRNCFIXED pf
            GROUP BY pf.COOP_ID, pf.DEPTACCOUNT_NO
          ) pa ON dm.COOP_ID = pa.COOP_ID AND dm.DEPTACCOUNT_NO = pa.DEPTACCOUNT_NO
          WHERE dm.MEMBER_NO = a.MEMBER_NO 
          AND dm.DEPTCLOSE_STATUS = 0
          AND dm.DEPTTYPE_CODE = '01'
          AND ROWNUM = 1
        ) ELSE 0 END
      ), 2), 0) AS AVG_DEPOSIT_BALANCE,
      NVL(SUM(
        CASE WHEN EXISTS (
          SELECT 1 FROM ${OWNER}.DPDEPTMASTER dm 
          WHERE dm.MEMBER_NO = a.MEMBER_NO 
          AND dm.DEPTCLOSE_STATUS = 0
          AND dm.DEPTTYPE_CODE = '01'
        ) THEN (
          SELECT COALESCE(pa.TOTAL_BAL, 0)
          FROM ${OWNER}.DPDEPTMASTER dm 
          LEFT JOIN (
            SELECT pf.COOP_ID, pf.DEPTACCOUNT_NO, SUM(pf.PRNC_BAL) AS TOTAL_BAL
            FROM ${OWNER}.DPDEPTPRNCFIXED pf
            GROUP BY pf.COOP_ID, pf.DEPTACCOUNT_NO
          ) pa ON dm.COOP_ID = pa.COOP_ID AND dm.DEPTACCOUNT_NO = pa.DEPTACCOUNT_NO
          WHERE dm.MEMBER_NO = a.MEMBER_NO 
          AND dm.DEPTCLOSE_STATUS = 0
          AND dm.DEPTTYPE_CODE = '01'
          AND ROWNUM = 1
        ) ELSE 0 END
      ), 0) AS TOTAL_DEPOSIT_BALANCE
    FROM ${OWNER}.MBREQAPPL a
    ${whereClause}
  `;

  const rows = await db.execute(sql, binds);
  return rows[0] || {};
}

/**
 * Get mock data for new members with deposit accounts (for testing)
 */
function getMockNewMemberDepositData() {
  const mockMembers = [
    {
      MEMBER_NO: "0035378",
      PRENAME_DESC: "นางสาว",
      MEMB_NAME: "ภัทรพร",
      MEMB_SURNAME: "ม้วงพฤกษ์",
      MEMBTYPE_DESC: "ข้าราชการ",
      MEMBGROUP_DESC: "สำนักบริหารโครงการทางหลวงระหว่างประเทศ",
      MEMBER_DATE: "2024-03-15",
      AGE: 32,
      MONTHS_AS_MEMBER: 0,
      SALARY_AMOUNT: 23230.00,
      MEM_TELMOBILE: "0812345678",
      DEPOSIT_ACCOUNT_NO: "1234567890",
      DEPOSIT_BALANCE: 5000.00,
      STATUS_TEXT: "ปกติ",
      HAS_DEPOSIT_ACCOUNT: "มี"
    },
    {
      MEMBER_NO: "0035379",
      PRENAME_DESC: "นาย",
      MEMB_NAME: "สมชาย",
      MEMB_SURNAME: "ใจดี",
      MEMBTYPE_DESC: "ลูกจ้าง",
      MEMBGROUP_DESC: "สำนักงานใหญ่",
      MEMBER_DATE: "2024-03-20",
      AGE: 28,
      MONTHS_AS_MEMBER: 0,
      SALARY_AMOUNT: 18000.00,
      MEM_TELMOBILE: "0823456789",
      DEPOSIT_ACCOUNT_NO: "-",
      DEPOSIT_BALANCE: 0,
      STATUS_TEXT: "ปกติ",
      HAS_DEPOSIT_ACCOUNT: "-"
    },
    {
      MEMBER_NO: "0035380",
      PRENAME_DESC: "นาง",
      MEMB_NAME: "มาลี",
      MEMB_SURNAME: "รุ่งเรือง",
      MEMBTYPE_DESC: "ข้าราชการ",
      MEMBGROUP_DESC: "สำนักบริหารโครงการทางหลวงระหว่างประเทศ",
      MEMBER_DATE: "2024-03-25",
      AGE: 35,
      MONTHS_AS_MEMBER: 0,
      SALARY_AMOUNT: 28000.00,
      MEM_TELMOBILE: "0834567890",
      DEPOSIT_ACCOUNT_NO: "0987654321",
      DEPOSIT_BALANCE: 12000.00,
      STATUS_TEXT: "ปกติ",
      HAS_DEPOSIT_ACCOUNT: "มี"
    }
  ];

  const summary = {
    TOTAL_NEW_MEMBERS: 3,
    MEMBERS_WITH_DEPOSITS: 2,
    MEMBERS_WITHOUT_DEPOSITS: 1,
    AVG_SALARY: 23076.67,
    AVG_DEPOSIT_BALANCE: 8500.00,
    TOTAL_DEPOSIT_BALANCE: 17000.00
  };

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานสมาชิกใหม่ที่มีบัญชีเงินฝาก",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterDesc: "สมาชิกใหม่ทั้งหมด (ข้อมูลจำลอง)",
    summary,
    members: mockMembers,
  };
}

/**
 * Get full report data for new members with deposit accounts
 */
async function getNewMemberDepositReportData(filters = {}) {
  // If useMock is true, return mock data
  if (filters.useMock) {
    return getMockNewMemberDepositData();
  }

  const [summary, members] = await Promise.all([
    getNewMembersDepositSummary(filters),
    getNewMembersWithDeposits(filters),
  ]);

  // Build filter description
  let filterDesc = "";
  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    filterDesc += `วันที่ใบสมัคร: ${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}/${start.getFullYear() + 543} - ${String(end.getDate()).padStart(2, "0")}/${String(end.getMonth() + 1).padStart(2, "0")}/${end.getFullYear() + 543} `;
  } else if (filters.lastNDays) {
    filterDesc += `ใบสมัครในช่วง ${filters.lastNDays} วันที่ผ่านมา `;
  }

  // Build filter labels for header display
  const filterLabels = {
    membTypeDesc: "ทั้งหมด",
    membCatDesc: "ทั้งหมด",
    membGroupDesc: "ทั้งหมด",
    statusDesc: "ทั้งหมด",
  };

  if (filters.membTypeCode) {
    const typeRows = await db.execute(
      `SELECT MEMBTYPE_DESC FROM ${OWNER}.MBUCFMEMBTYPE WHERE COOP_ID = '056001' AND MEMBTYPE_CODE = :code`,
      { code: filters.membTypeCode }
    );
    const typeDesc = typeRows.length > 0 ? typeRows[0].MEMBTYPE_DESC.trim() : filters.membTypeCode;
    filterDesc += `ประเภท: ${typeDesc} `;
    filterLabels.membTypeDesc = typeDesc;
  }

  if (filters.membGroupCode) {
    const grpRows = await db.execute(
      `SELECT MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' AND MEMBGROUP_CODE = :code`,
      { code: filters.membGroupCode }
    );
    const grpDesc = grpRows.length > 0 ? grpRows[0].MEMBGROUP_DESC.trim() : filters.membGroupCode;
    filterDesc += `สังกัด: ${grpDesc} `;
    filterLabels.membGroupDesc = grpDesc;
  }

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานสมาชิกใหม่ที่มีบัญชีเงินฝาก",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterDesc: filterDesc.trim() || "สมาชิกใหม่ทั้งหมด",
    filterLabels,
    summary,
    members,
  };
}

module.exports = { getNewMemberDepositReportData };
