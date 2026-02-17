const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * Fetch member summary statistics
 */
/**
 * Build WHERE clause from filters
 */
function buildWhere(filters) {
  let whereClause = "WHERE 1=1";
  const binds = {};

  if (filters.membCatCode) {
    const cats = filters.membCatCode.split(",").map((c) => c.trim());
    if (cats.length === 1) {
      whereClause += " AND m.MEMBCAT_CODE = :membCatCode";
      binds.membCatCode = cats[0];
    } else {
      const placeholders = cats.map((_, i) => `:cat${i}`).join(",");
      whereClause += ` AND m.MEMBCAT_CODE IN (${placeholders})`;
      cats.forEach((c, i) => { binds[`cat${i}`] = c; });
    }
  }
  if (filters.membTypeCode) {
    whereClause += " AND m.MEMBTYPE_CODE = :membTypeCode";
    binds.membTypeCode = filters.membTypeCode;
  }
  if (filters.membGroupFrom && filters.membGroupTo) {
    whereClause += " AND m.MEMBGROUP_CODE BETWEEN :membGroupFrom AND :membGroupTo";
    binds.membGroupFrom = filters.membGroupFrom;
    binds.membGroupTo = filters.membGroupTo;
  } else if (filters.membGroupFrom) {
    whereClause += " AND m.MEMBGROUP_CODE >= :membGroupFrom";
    binds.membGroupFrom = filters.membGroupFrom;
  } else if (filters.membGroupTo) {
    whereClause += " AND m.MEMBGROUP_CODE <= :membGroupTo";
    binds.membGroupTo = filters.membGroupTo;
  } else if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }
  if (filters.memberFrom && filters.memberTo) {
    whereClause += " AND m.MEMBER_NO BETWEEN :memberFrom AND :memberTo";
    binds.memberFrom = filters.memberFrom;
    binds.memberTo = filters.memberTo;
  } else if (filters.memberFrom) {
    whereClause += " AND m.MEMBER_NO >= :memberFrom";
    binds.memberFrom = filters.memberFrom;
  } else if (filters.memberTo) {
    whereClause += " AND m.MEMBER_NO <= :memberTo";
    binds.memberTo = filters.memberTo;
  }
  if (filters.statusFilter && Array.isArray(filters.statusFilter) && filters.statusFilter.length > 0 && filters.statusFilter.length < 3) {
    // active = RESIGN_STATUS=0 AND DEAD_STATUS=0
    // resigned = RESIGN_STATUS=1 AND DEAD_STATUS=0
    // dead = DEAD_STATUS=1
    const conditions = [];
    if (filters.statusFilter.includes("active")) {
      conditions.push("(m.RESIGN_STATUS = 0 AND m.DEAD_STATUS = 0)");
    }
    if (filters.statusFilter.includes("resigned")) {
      conditions.push("(m.RESIGN_STATUS = 1 AND m.DEAD_STATUS = 0)");
    }
    if (filters.statusFilter.includes("dead")) {
      conditions.push("(m.DEAD_STATUS = 1)");
    }
    if (conditions.length > 0) {
      whereClause += " AND (" + conditions.join(" OR ") + ")";
    }
  }
  if (filters.provinceCode) {
    whereClause += " AND m.PROVINCE_CODE = :provinceCode";
    binds.provinceCode = filters.provinceCode;
  }
  // Exclude MEMBTYPE_DESC = 'สังกัดหน่วยงาน'
  whereClause += " AND m.MEMBTYPE_CODE NOT IN (SELECT mt2.MEMBTYPE_CODE FROM " + OWNER + ".MBUCFMEMBTYPE mt2 WHERE mt2.COOP_ID = '056001' AND TRIM(mt2.MEMBTYPE_DESC) = :excludeMembType)";
  binds.excludeMembType = "สังกัดหน่วยงาน";
  return { whereClause, binds };
}

async function getMemberSummary(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const sql = `
    SELECT 
      COUNT(*) AS TOTAL_MEMBERS,
      SUM(CASE WHEN m.RESIGN_STATUS = 0 AND m.DEAD_STATUS = 0 AND m.MEMBER_STATUS >= 0 THEN 1 ELSE 0 END) AS ACTIVE_MEMBERS,
      SUM(CASE WHEN m.RESIGN_STATUS = 1 THEN 1 ELSE 0 END) AS RESIGNED_MEMBERS,
      SUM(CASE WHEN m.RETIRE_STATUS = 1 THEN 1 ELSE 0 END) AS RETIRED_MEMBERS,
      SUM(CASE WHEN m.DEAD_STATUS = 1 THEN 1 ELSE 0 END) AS DEAD_MEMBERS,
      NVL(ROUND(AVG(m.SALARY_AMOUNT), 2), 0) AS AVG_SALARY
    FROM ${OWNER}.MBMEMBMASTER m
    ${whereClause}
  `;

  const rows = await db.execute(sql, binds);
  return rows[0] || {};
}

/**
 * Fetch member list with all JOINs
 */
async function getMemberList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT 
        m.MEMBER_NO,
        pn.PRENAME_DESC,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        mc.MEMBCAT_DESC,
        mt.MEMBTYPE_DESC,
        mg.MEMBGROUP_DESC,
        m.MEMBER_DATE,
        m.BIRTH_DATE,
        m.CARD_PERSON,
        m.MEM_TELMOBILE,
        m.SALARY_AMOUNT,
        m.MEMBER_STATUS,
        m.RESIGN_STATUS,
        m.RETIRE_STATUS,
        m.DEAD_STATUS,
        pv.PROVINCE_DESC,
        dt.DISTRICT_DESC,
        tb.TAMBOL_DESC,
        ps.POSITION_DESC
      FROM ${OWNER}.MBMEMBMASTER m
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFCATEGORY mc     ON m.COOP_ID = mc.COOP_ID AND m.MEMBCAT_CODE = mc.MEMBCAT_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBTYPE mt     ON m.COOP_ID = mt.COOP_ID AND m.MEMBTYPE_CODE = mt.MEMBTYPE_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg    ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      LEFT JOIN ${OWNER}.MBUCFPROVINCE pv     ON m.PROVINCE_CODE = pv.PROVINCE_CODE
      LEFT JOIN ${OWNER}.MBUCFDISTRICT dt     ON m.DISTRICT_CODE = dt.DISTRICT_CODE
      LEFT JOIN ${OWNER}.MBUCFTAMBOL tb       ON m.TAMBOL_CODE = tb.TAMBOL_CODE
      LEFT JOIN ${OWNER}.MBUCFPOSITION ps     ON m.COOP_ID = ps.COOP_ID AND m.POSITION_CODE = ps.POSITION_CODE
      ${whereClause}
      ORDER BY m.MEMBER_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

  // Add computed status text
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
    return { ...r, STATUS_TEXT: statusText, STATUS_CLASS: statusClass, MEMBTYPE_DISPLAY: r.MEMBTYPE_DESC || "" };
  });
}

/**
 * Get full member report data (summary + list)
 */
async function getMemberReportData(filters = {}) {
  const [summary, members] = await Promise.all([
    getMemberSummary(filters),
    getMemberList(filters),
  ]);

  // Lookup filter descriptions from DB
  const catMap = { "10": "สามัญ ก", "50": "สามัญ ข", "20,30,60": "สมทบ" };
  const statusMap = { active: "ปกติ", resigned: "ลาออก", dead: "เสียชีวิต" };

  let membTypeDesc = "ทั้งหมด";
  if (filters.membTypeCode) {
    const typeRows = await db.execute(
      `SELECT MEMBTYPE_DESC FROM ${OWNER}.MBUCFMEMBTYPE WHERE COOP_ID = '056001' AND MEMBTYPE_CODE = :code`,
      { code: filters.membTypeCode }
    );
    membTypeDesc = typeRows.length > 0 ? typeRows[0].MEMBTYPE_DESC.trim() : filters.membTypeCode;
  }

  let membGroupDesc = "ทั้งหมด";
  if (filters.membGroupCode) {
    const grpRows = await db.execute(
      `SELECT MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' AND MEMBGROUP_CODE = :code`,
      { code: filters.membGroupCode }
    );
    membGroupDesc = grpRows.length > 0 ? grpRows[0].MEMBGROUP_DESC.trim() : filters.membGroupCode;
  }

  const filterLabels = {
    membTypeDesc,
    membCatDesc: filters.membCatCode ? (catMap[filters.membCatCode] || filters.membCatCode) : "ทั้งหมด",
    membGroupDesc,
    statusDesc: (filters.statusFilter && Array.isArray(filters.statusFilter) && filters.statusFilter.length > 0 && filters.statusFilter.length < 3)
      ? filters.statusFilter.map(s => statusMap[s] || s).join(", ")
      : "ทั้งหมด",
  };

  let filterDesc = "";
  if (filters.membTypeCode) filterDesc += `ประเภท: ${membTypeDesc} `;
  if (filters.membCatCode) filterDesc += `กลุ่ม: ${filterLabels.membCatDesc} `;
  if (filters.membGroupCode) filterDesc += `สังกัด: ${membGroupDesc} `;
  if (filterLabels.statusDesc !== "ทั้งหมด") filterDesc += `สถานะ: ${filterLabels.statusDesc} `;

  // Format report date as dd/mm/yyyy (Buddhist era)
  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "งานรายทะเบียนสมาชิก",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterDesc: filterDesc.trim() || "ทั้งหมด",
    filterLabels,
    summary,
    members,
  };
}

/**
 * Get lookup data for filters
 */
async function getMemberLookups() {
  const [membTypes, membGroups, membCategories, provinces] = await Promise.all([
    db.execute(`SELECT MEMBTYPE_CODE, MEMBTYPE_DESC FROM ${OWNER}.MBUCFMEMBTYPE WHERE COOP_ID = '056001' ORDER BY MEMBTYPE_CODE`),
    db.execute(`SELECT MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' ORDER BY MEMBGROUP_CODE`),
    db.execute(`SELECT MEMBCAT_CODE, MEMBCAT_DESC FROM ${OWNER}.MBUCFCATEGORY WHERE COOP_ID = '056001' ORDER BY MEMBCAT_CODE`),
    db.execute(`SELECT PROVINCE_CODE, PROVINCE_DESC FROM ${OWNER}.MBUCFPROVINCE ORDER BY PROVINCE_CODE`),
  ]);
  return { membTypes, membGroups, membCategories, provinces };
}

module.exports = { getMemberReportData, getMemberLookups };
