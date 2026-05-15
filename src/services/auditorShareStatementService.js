const db = require("../db/oracle");

const OWNER = "ISCODOH";

/**
 * Statement หุ้นรายตัวของสมาชิก (สำหรับผู้ตรวจสอบบัญชี)
 *
 * แสดงรายการเคลื่อนไหวหุ้นจาก SHSHARESTATEMENT ในช่วงวันที่ระบุ
 *
 * 10 ฟิลด์ตามข้อกำหนด: membership_no, name, seq_no, sharetype_code, slip_date,
 *   shritemtype_code, period, share_amount, sharestk_amt, code (ref doc/slip)
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
    whereClause += " AND s.MEMBER_NO = :memberNo";
    binds.memberNo = filters.memberNo;
  }
  if (filters.shareTypeCode) {
    whereClause += " AND s.SHARETYPE_CODE = :shareTypeCode";
    binds.shareTypeCode = filters.shareTypeCode;
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
        s.MEMBER_NO,
        m.MEMB_NAME,
        m.MEMB_SURNAME,
        pn.PRENAME_DESC,
        s.SEQ_NO,
        s.SHARETYPE_CODE,
        st.SHARETYPE_DESC,
        s.SLIP_DATE,
        s.OPERATE_DATE,
        s.SHARE_DATE,
        s.SHRITEMTYPE_CODE,
        s.PERIOD,
        s.SHARE_AMOUNT,
        s.SHARESTK_AMT,
        s.SHARESTK_VALUE,
        s.REF_DOCNO,
        s.REF_SLIPNO,
        s.MONEYTYPE_CODE
      FROM ${OWNER}.SHSHARESTATEMENT s
      LEFT JOIN ${OWNER}.MBMEMBMASTER m       ON s.COOP_ID = m.COOP_ID AND s.MEMBER_NO = m.MEMBER_NO
      LEFT JOIN ${OWNER}.MBUCFPRENAME pn      ON m.PRENAME_CODE = pn.PRENAME_CODE
      LEFT JOIN ${OWNER}.SHSHARETYPE st       ON s.COOP_ID = st.COOP_ID AND s.SHARETYPE_CODE = st.SHARETYPE_CODE
      ${whereClause}
      ORDER BY s.MEMBER_NO, s.SHARETYPE_CODE, s.SLIP_DATE, s.SEQ_NO
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
      SHARE_AMOUNT: r.SHARE_AMOUNT || 0,
      SHARESTK_AMT: r.SHARESTK_AMT || 0,
      SHARESTK_VALUE: r.SHARESTK_VALUE || 0,
    };
  });
}

async function getAuditorShareStatementData(filters = {}) {
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
    shareTypeCode: filters.shareTypeCode || "ทุกประเภท",
  };

  const sumShareAmt = items.reduce((s, x) => s + (Number(x.SHARE_AMOUNT) || 0), 0);
  const distinctMembers = new Set(items.map((x) => x.MEMBER_NO)).size;

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear() + 543}`;

  return {
    reportTitle: "Statement หุ้นรายตัวของสมาชิก (สำหรับผู้ตรวจสอบบัญชี)",
    coopName: "สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด",
    coopAddress: "ณ ถนนศรีอยุธยา แขวง ทุ่งพญาไท เขต ราชเทวี กรุงเทพมหานคร 10400",
    reportDate,
    generatedAt: now.toLocaleString("th-TH"),
    filterLabels,
    summary: {
      totalItems: items.length,
      distinctMembers,
      sumShareAmt,
    },
    items,
  };
}

async function getLookups() {
  const [shareTypes, membGroups] = await Promise.all([
    db.execute(`SELECT SHARETYPE_CODE, SHARETYPE_DESC FROM ${OWNER}.SHSHARETYPE WHERE COOP_ID = '056001' ORDER BY SHARETYPE_CODE`),
    db.execute(`SELECT MEMBGROUP_CODE, MEMBGROUP_DESC FROM ${OWNER}.MBUCFMEMBGROUP WHERE COOP_ID = '056001' ORDER BY MEMBGROUP_CODE`),
  ]);
  return { shareTypes, membGroups };
}

module.exports = { getAuditorShareStatementData, getLookups };
