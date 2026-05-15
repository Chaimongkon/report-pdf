const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * รายงานทะเบียนสมาชิก (สำหรับผู้ตรวจสอบบัญชี)
 * ครอบคลุม 19 ฟิลด์ตามข้อกำหนด:
 *   membership_no, prename_code, member_name, member_surname, sex,
 *   member_type, address_no, district_code, province_code, postcode,
 *   telephone, Birthday_date, approve_date, approve_id, apply_date,
 *   member_status_code, share_amount, share_stock, Salary_amount
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
  if (filters.membGroupCode) {
    whereClause += " AND m.MEMBGROUP_CODE = :membGroupCode";
    binds.membGroupCode = filters.membGroupCode;
  }
  if (filters.statusFilter && Array.isArray(filters.statusFilter) && filters.statusFilter.length > 0 && filters.statusFilter.length < 3) {
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
  if (filters.asOfDate) {
    whereClause += " AND m.MEMBER_DATE <= TO_DATE(:asOfDate, 'YYYY-MM-DD')";
    binds.asOfDate = filters.asOfDate;
  }
  // Exclude MEMBTYPE_DESC = 'สังกัดหน่วยงาน'
  whereClause += " AND m.MEMBTYPE_CODE NOT IN (SELECT mt2.MEMBTYPE_CODE FROM " + OWNER + ".MBUCFMEMBTYPE mt2 WHERE mt2.COOP_ID = '056001' AND TRIM(mt2.MEMBTYPE_DESC) = :excludeMembType)";
  binds.excludeMembType = "สังกัดหน่วยงาน";
  return { whereClause, binds };
}

async function getMemberList(filters = {}) {
  const { whereClause, binds } = buildWhere(filters);

  const limit = (filters.limit !== undefined && filters.limit !== null) ? filters.limit : 500;
  const useLimit = limit > 0;
  if (useLimit) binds.rowLimit = limit;

  const sql = `
    SELECT * FROM (
      SELECT
        m.MEMBER_NO,
        m.SEX,
        m.ADDRESS_NO,
        m.POSTCODE,
        pn.PRENAME_DESC,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
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
        ap.APPROVE_DATE,
        ap.APPROVE_ID,
        sh.SHARE_AMOUNT,
        sh.SHARE_STOCK
      FROM ${OWNER}.MBMEMBMASTER m
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBTYPE mt     ON m.COOP_ID = mt.COOP_ID AND m.MEMBTYPE_CODE = mt.MEMBTYPE_CODE
      LEFT JOIN ${OWNER}.MBUCFMEMBGROUP mg    ON m.COOP_ID = mg.COOP_ID AND m.MEMBGROUP_CODE = mg.MEMBGROUP_CODE
      LEFT JOIN ${OWNER}.MBUCFPROVINCE pv     ON m.PROVINCE_CODE = pv.PROVINCE_CODE
      LEFT JOIN ${OWNER}.MBUCFDISTRICT dt     ON m.DISTRICT_CODE = dt.DISTRICT_CODE
      LEFT JOIN ${OWNER}.MBUCFTAMBOL tb       ON m.TAMBOL_CODE = tb.TAMBOL_CODE
      LEFT JOIN (
        SELECT COOP_ID, MEMBER_NO,
               MIN(APPROVE_DATE) AS APPROVE_DATE,
               MIN(APPROVE_ID) KEEP (DENSE_RANK FIRST ORDER BY APPROVE_DATE NULLS LAST) AS APPROVE_ID
        FROM ${OWNER}.MBREQAPPL
        WHERE APPL_STATUS = 1
        GROUP BY COOP_ID, MEMBER_NO
      ) ap ON m.COOP_ID = ap.COOP_ID AND m.MEMBER_NO = ap.MEMBER_NO
      LEFT JOIN (
        SELECT sm.COOP_ID, sm.MEMBER_NO,
               SUM(sm.PERIODSHARE_AMT * NVL(st.UNITSHARE_VALUE, 1)) AS SHARE_AMOUNT,
               SUM(sm.SHARESTK_VALUE) AS SHARE_STOCK
        FROM ${OWNER}.SHSHAREMASTER sm
        LEFT JOIN ${OWNER}.SHSHARETYPE st
               ON sm.COOP_ID = st.COOP_ID AND sm.SHARETYPE_CODE = st.SHARETYPE_CODE
        GROUP BY sm.COOP_ID, sm.MEMBER_NO
      ) sh ON m.COOP_ID = sh.COOP_ID AND m.MEMBER_NO = sh.MEMBER_NO
      ${whereClause}
      ORDER BY m.MEMBER_NO
    )${useLimit ? " WHERE ROWNUM <= :rowLimit" : ""}
  `;

  const rows = await db.execute(sql, binds);

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
    let sexDesc = "";
    if (r.SEX != null) {
      const s = String(r.SEX).trim().toUpperCase();
      sexDesc = s === "M" ? "ชาย" : s === "F" ? "หญิง" : s;
    }
    return {
      ...r,
      MEMBER_NO: memberNo,
      CARD_PERSON: cardPerson,
      MEM_TELMOBILE: telMobile,
      STATUS_TEXT: statusText,
      STATUS_CLASS: statusClass,
      SEX_DESC: sexDesc,
      SHARE_AMOUNT: r.SHARE_AMOUNT || 0,
      SHARE_STOCK: r.SHARE_STOCK || 0,
    };
  });
}

async function getAuditorMemberRegistryData(filters = {}) {
  const members = await getMemberList(filters);

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

  const now = new Date();
  let reportDateObj = now;
  if (filters.asOfDate) reportDateObj = new Date(filters.asOfDate);
  const reportDate = `${String(reportDateObj.getDate()).padStart(2, "0")}/${String(reportDateObj.getMonth() + 1).padStart(2, "0")}/${reportDateObj.getFullYear() + 543}`;

  return {
    reportTitle: "รายงานทะเบียนสมาชิก (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    members,
  };
}

module.exports = { getAuditorMemberRegistryData };
