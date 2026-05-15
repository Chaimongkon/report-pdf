const express = require("express");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { EventEmitter } = require("events");
const { getMockSalesData, getSalesReportData } = require("../services/reportService");
const { getMemberReportData, getMemberLookups } = require("../services/memberService");
const { getNewMemberDepositReportData } = require("../services/newMemberDepositService");
const { getAuditorMemberRegistryData } = require("../services/auditorMemberRegistryService");
const { getAuditorLoanApprovalData, getLoanLookups } = require("../services/auditorLoanApprovalService");
const { getAuditorShareLoanBalanceData, getLookups: getShareLoanBalanceLookups } = require("../services/auditorShareLoanBalanceService");
const { getAuditorInterestArrearsData, getLookups: getArrearsLookups } = require("../services/auditorInterestArrearsService");
const { getAuditorMonthlyCollectionData, getLookups: getMonthlyCollLookups } = require("../services/auditorMonthlyCollectionService");
const { getAuditorLoanStatementData, getLookups: getLoanStmtLookups } = require("../services/auditorLoanStatementService");
const { getAuditorShareStatementData, getLookups: getShareStmtLookups } = require("../services/auditorShareStatementService");
const { getAuditorDepositTransactionData, getLookups: getDepositTxLookups } = require("../services/auditorDepositTransactionService");
const { getAuditorDepositInterestTaxData, getLookups: getDepositIntTaxLookups } = require("../services/auditorDepositInterestTaxService");
const { savePdf, batchGenerate, saveBatchResults } = require("../utils/pdfUtils");

const router = express.Router();
const progressEmitter = new EventEmitter();

// Helper to emit progress
function emitProgress(clientId, payload) {
  if (clientId) {
    if (typeof payload === 'string') {
      progressEmitter.emit(`progress-${clientId}`, { message: payload });
    } else {
      progressEmitter.emit(`progress-${clientId}`, payload);
    }
  }
}

// Handlebars helpers as a plain JS string for jsreport
const HELPERS_JS = `
function formatNumber(value) {
  if (value == null || isNaN(value)) return "0.00";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function lowercase(str) {
  return str ? String(str).toLowerCase() : "";
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr);
  var day = String(d.getDate()).padStart(2, "0");
  var month = String(d.getMonth() + 1).padStart(2, "0");
  var year = d.getFullYear() + 543;
  return day + "/" + month + "/" + year;
}

function ifEquals(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
}

function rowIndex(index, offset) {
  if (typeof offset !== 'number') offset = 0;
  return index + 1 + offset;
}

function formatNumber0(value) {
  if (value == null || isNaN(value)) return "0";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDateTH(dateVal) {
  if (!dateVal) return "";
  var d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  var day = String(d.getDate()).padStart(2, "0");
  var month = String(d.getMonth() + 1).padStart(2, "0");
  var year = d.getFullYear() + 543;
  return day + "/" + month + "/" + year;
}

function truncate(str, len) {
  if (!str) return "";
  str = String(str);
  return str.length > len ? str.substring(0, len) + "..." : str;
}

function statusBadge(text, cls) {
  return new Handlebars.SafeString(
    '<span class="status-' + cls + '">' + text + '</span>'
  );
}

function formatAccount(accNo) {
  if (!accNo || accNo === "-") return "-";
  return accNo;
}

function dashIfEmpty(value) {
  return (value == null || value === "" || value === 0) ? "-" : value;
}

function eq(a, b) {
  return a === b;
}
`;

const CHROME_OPTIONS = {
  marginTop: "0mm",
  marginBottom: "0mm",
  marginLeft: "0mm",
  marginRight: "0mm",
  format: "A4",
  printBackground: true,
  displayHeaderFooter: false,
};

const CHROME_LANDSCAPE = {
  ...CHROME_OPTIONS,
  landscape: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;text-align:center;font-size:7px;color:#bbb;border-top:1px solid #ccc;padding-top:2px;">
    สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด | ระบบรายงาน PDF | หน้า <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>`,
  marginBottom: "12mm",
};

/**
 * Render a single PDF from data using jsreport
 */
async function renderPdf(pdfRenderer, templateContent, data, chromeOpts) {
  return pdfRenderer.renderPdf(templateContent, data, HELPERS_JS, chromeOpts || CHROME_OPTIONS);
}

/**
 * Get report data (mock or Oracle)
 */
async function getReportData(params, useMock) {
  if (useMock) {
    const data = getMockSalesData();
    data.department = params.department || data.department;
    data.period = {
      startDate: params.startDate || "2024-01-01",
      endDate: params.endDate || "2024-12-31",
    };
    return data;
  }
  return getSalesReportData(params);
}

/**
 * POST /api/report/sales
 * Generate a single sales report PDF
 * Body: { startDate, endDate, department, useMock }
 */
router.post("/sales", async (req, res) => {
  try {
    const { startDate, endDate, department, useMock } = req.body;

    const data = await getReportData({ startDate, endDate, department }, useMock);

    const templatePath = path.join(__dirname, "../../templates/sales-report/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const pdfBuffer = await renderPdf(pdfRenderer, templateContent, data);

    // Option: save to disk
    if (req.query.save === "true") {
      const filename = `sales_report_${Date.now()}.pdf`;
      const savedPath = savePdf(pdfBuffer, filename);
      return res.json({ success: true, file: savedPath, size: pdfBuffer.length });
    }

    // Return PDF as response
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sales_report_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Error generating sales report:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/batch
 * Generate batch reports and save as individual files
 * Body: { reports: [{ startDate, endDate, department }], useMock }
 */
router.post("/batch", async (req, res) => {
  try {
    const { reports, useMock } = req.body;

    if (!reports || !Array.isArray(reports) || reports.length === 0) {
      return res.status(400).json({ error: "reports array is required" });
    }

    const templatePath = path.join(__dirname, "../../templates/sales-report/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const renderFn = async (params) => {
      const data = await getReportData(params, useMock);
      return renderPdf(pdfRenderer, templateContent, data);
    };

    const results = await batchGenerate(renderFn, reports);
    const savedPaths = saveBatchResults(results);

    res.json({
      success: true,
      total: reports.length,
      generated: savedPaths.length,
      files: savedPaths,
    });
  } catch (err) {
    console.error("[Route] Batch error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/merge
 * Generate multiple reports and merge into a single PDF
 * Body: { reports: [{ startDate, endDate, department }], useMock }
 */
router.post("/merge", async (req, res) => {
  try {
    const { reports, useMock } = req.body;

    if (!reports || !Array.isArray(reports) || reports.length === 0) {
      return res.status(400).json({ error: "reports array is required" });
    }

    const templatePath = path.join(__dirname, "../../templates/sales-report/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    // Generate all individual PDFs
    const pdfBuffers = [];
    for (const params of reports) {
      const data = await getReportData(params, useMock);
      const buf = await renderPdf(pdfRenderer, templateContent, data);
      pdfBuffers.push(buf);
    }

    // Merge all PDFs into one using pdf-lib
    const mergedPdf = await PDFDocument.create();
    for (const buf of pdfBuffers) {
      const doc = await PDFDocument.load(buf);
      const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }
    const finalBuffer = Buffer.from(await mergedPdf.save());
    const filename = `merged_report_${Date.now()}.pdf`;

    if (req.query.save === "true") {
      const savedPath = savePdf(finalBuffer, filename);
      return res.json({ success: true, file: savedPath, size: finalBuffer.length });
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": finalBuffer.length,
    });
    res.send(finalBuffer);
  } catch (err) {
    console.error("[Route] Merge error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/health
 * Health check
 */
router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/report/progress
 * Server-Sent Events endpoint to stream generation progress
 */
router.get("/progress", (req, res) => {
  const clientId = req.query.clientId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (clientId) {
    progressEmitter.on(`progress-${clientId}`, listener);
  }

  req.on('close', () => {
    if (clientId) {
      progressEmitter.removeListener(`progress-${clientId}`, listener);
    }
  });
});

/**
 * POST /api/report/member
 * Generate member report PDF from Oracle
 * Body: { membTypeCode, membGroupFrom, membGroupTo, memberFrom, memberTo, memberStatus, provinceCode, limit, format, clientId }
 */
router.post("/member", async (req, res) => {
  try {
    const { membCatCode, membTypeCode, membGroupCode, membGroupFrom, membGroupTo, memberFrom, memberTo, statusFilter, provinceCode, asOfDate, limit, format, clientId } = req.body;

    const filters = {
      membCatCode,
      membTypeCode,
      membGroupCode,
      membGroupFrom,
      membGroupTo,
      memberFrom,
      memberTo,
      statusFilter,
      provinceCode,
      asOfDate,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    console.log("[Member Report] filters:", JSON.stringify(filters));

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");

    const data = await getMemberReportData(filters);
    console.log("[Member Report] members:", data.members.length, "filterDesc:", data.filterDesc);
    emitProgress(clientId, `พบข้อมูลสมาชิกทั้งหมด ${data.members.length.toLocaleString('en-US')} รายการ`);

    // CSV export
    if (format === "csv") {
      const csvRows = [
        ["เลขที่สมาชิก", "เลขบัตรประชาชน", "คำนำหน้า", "ชื่อ", "นามสกุล", "ประเภท", "กลุ่ม/หน่วยงาน", "วันสมัคร", "เบอร์มือถือ", "เงินเดือน", "จังหวัด", "สถานะ"].join(","),
        ...data.members.map((m) =>
          [
            `="${m.MEMBER_NO}"`,
            `="${m.CARD_PERSON || ""}"`,
            m.PRENAME_DESC || "",
            m.MEMB_NAME || "",
            m.MEMB_SURNAME || "",
            m.MEMBTYPE_DESC || "",
            `"${(m.MEMBGROUP_DESC || "").replace(/"/g, '""')}"`,
            m.MEMBER_DATE ? new Date(m.MEMBER_DATE).toLocaleDateString("th-TH") : "",
            `="${m.MEM_TELMOBILE || ""}"`,
            m.SALARY_AMOUNT || 0,
            m.PROVINCE_DESC || "",
            m.STATUS_TEXT || "",
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="member_report_${Date.now()}.csv"`,
      });
      return res.send("\uFEFF" + csvRows.join("\n"));
    }

    // Read logo and fonts, convert to base64 for embedding in PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    // Embed THSarabunNew fonts
    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/member-report/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.members.length > CHUNK_SIZE) {
      // Split into chunks, render each, then merge with pdf-lib
      const allMembers = data.members;
      const totalChunks = Math.ceil(allMembers.length / CHUNK_SIZE);
      const msg = `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด (ชุดละไม่เกิน ${CHUNK_SIZE} แถว)`;
      console.log(`[Member Report] Large dataset: ${allMembers.length} rows, splitting into ${totalChunks} chunks`);
      emitProgress(clientId, msg);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkMembers = allMembers.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = {
          ...data,
          members: chunkMembers,
          _rowOffset: i * CHUNK_SIZE,
          _chunkInfo: `หน้าชุดที่ ${i + 1}/${totalChunks}`,
        };
        const chunkMsg = `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (${chunkMembers.length.toLocaleString('en-US')} รายการ)...`;
        console.log(`[Member Report] Rendering chunk ${i + 1}/${totalChunks} (${chunkMembers.length} rows)...`);
        emitProgress(clientId, {
          message: chunkMsg,
          action: 'count',
          current: 0,
          total: chunkMembers.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });

        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      // Merge all PDFs
      console.log(`[Member Report] Merging ${pdfBuffers.length} PDFs...`);
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุดเข้าด้วยกัน...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
      console.log(`[Member Report] Merged PDF: ${pdfBuffer.length} bytes`);
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.members.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    }

    if (req.query.save === "true") {
      const filename = `member_report_${Date.now()}.pdf`;
      const savedPath = savePdf(pdfBuffer, filename);
      return res.json({ success: true, file: savedPath, size: pdfBuffer.length, memberCount: data.members.length });
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="member_report_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Member report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/member/lookups
 * Get filter options for member report
 */
router.get("/member/lookups", async (req, res) => {
  try {
    const lookups = await getMemberLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/new-member-deposit
 * Generate new members with deposit accounts report PDF
 * Body: { startDate, endDate, lastNDays, membTypeCode, membGroupCode, statusFilter, limit, format, clientId }
 */
router.post("/new-member-deposit", async (req, res) => {
  try {
    const { startDate, endDate, lastNDays, membTypeCode, membGroupCode, statusFilter, limit, format, clientId, useMock } = req.body;

    const filters = {
      startDate,
      endDate,
      lastNDays,
      membTypeCode,
      membGroupCode,
      statusFilter,
      useMock,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    console.log("[New Member Deposit Report] filters:", JSON.stringify(filters));

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");

    const data = await getNewMemberDepositReportData(filters);
    console.log("[New Member Deposit Report] members:", data.members.length, "filterDesc:", data.filterDesc);
    emitProgress(clientId, `พบข้อมูลสมาชิกใหม่ทั้งหมด ${data.members.length.toLocaleString('en-US')} รายการ`);

    // CSV export
    if (format === "csv") {
      const csvRows = [
        ["เลขที่สมาชิก", "เลขบัตรประชาชน", "คำนำหน้า", "ชื่อ", "นามสกุล", "ประเภท", "กลุ่ม/หน่วยงาน", "วันสมัคร", "อายุ", "เดือนที่เป็นสมาชิก", "เงินเดือน", "เบอร์มือถือ", "เลขที่บัญชีเงินฝาก", "ยอดเงินฝาก", "สถานะ"].join(","),
        ...data.members.map((m) =>
          [
            `="${m.MEMBER_NO}"`,
            `="${m.CARD_PERSON || ""}"`,
            m.PRENAME_DESC || "",
            m.MEMB_NAME || "",
            m.MEMB_SURNAME || "",
            m.MEMBTYPE_DESC || "",
            `"${(m.MEMBGROUP_DESC || "").replace(/"/g, '""')}"`,
            m.MEMBER_DATE ? new Date(m.MEMBER_DATE).toLocaleDateString("th-TH") : "",
            m.AGE || 0,
            m.MONTHS_AS_MEMBER || 0,
            m.SALARY_AMOUNT || 0,
            `="${m.MEM_TELMOBILE || ""}"`,
            `="${m.DEPOSIT_ACCOUNT_NO}"`,
            m.DEPOSIT_BALANCE || 0,
            m.STATUS_TEXT || "",
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="new_member_deposit_report_${Date.now()}.csv"`,
      });
      return res.send("\uFEFF" + csvRows.join("\n"));
    }

    // Read logo and fonts, convert to base64 for embedding in PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    // Embed THSarabunNew fonts
    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/new-member-deposit/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.members.length > CHUNK_SIZE) {
      // Split into chunks, render each, then merge with pdf-lib
      const allMembers = data.members;
      const totalChunks = Math.ceil(allMembers.length / CHUNK_SIZE);
      const msg = `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด (ชุดละไม่เกิน ${CHUNK_SIZE} แถว)`;
      console.log(`[New Member Deposit Report] Large dataset: ${allMembers.length} rows, splitting into ${totalChunks} chunks`);
      emitProgress(clientId, msg);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkMembers = allMembers.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = {
          ...data,
          members: chunkMembers,
          _rowOffset: i * CHUNK_SIZE,
          _chunkInfo: `หน้าชุดที่ ${i + 1}/${totalChunks}`,
        };
        const chunkMsg = `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (${chunkMembers.length.toLocaleString('en-US')} รายการ)...`;
        console.log(`[New Member Deposit Report] Rendering chunk ${i + 1}/${totalChunks} (${chunkMembers.length} rows)...`);
        emitProgress(clientId, {
          message: chunkMsg,
          action: 'count',
          current: 0,
          total: chunkMembers.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });

        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      // Merge all PDFs
      console.log(`[New Member Deposit Report] Merging ${pdfBuffers.length} PDFs...`);
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุดเข้าด้วยกัน...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
      console.log(`[New Member Deposit Report] Merged PDF: ${pdfBuffer.length} bytes`);
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.members.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    }

    if (req.query.save === "true") {
      const filename = `new_member_deposit_report_${Date.now()}.pdf`;
      const savedPath = savePdf(pdfBuffer, filename);
      return res.json({ success: true, file: savedPath, size: pdfBuffer.length, memberCount: data.members.length });
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="new_member_deposit_report_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] New member deposit report error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/member-registry
 * รายงานทะเบียนสมาชิก (สำหรับผู้ตรวจสอบบัญชี) — 19 ฟิลด์ ครบตามข้อกำหนด
 */
router.post("/auditor/member-registry", async (req, res) => {
  try {
    const { membCatCode, membTypeCode, membGroupCode, statusFilter, asOfDate, limit, format, clientId } = req.body;

    const filters = {
      membCatCode,
      membTypeCode,
      membGroupCode,
      statusFilter,
      asOfDate,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorMemberRegistryData(filters);
    emitProgress(clientId, `พบข้อมูลสมาชิกทั้งหมด ${data.members.length.toLocaleString('en-US')} รายการ`);

    // CSV — ครบ 19 ฟิลด์ตามภาพข้อกำหนด
    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "รหัสสมาชิก",
          "คำนำหน้า",
          "ชื่อสมาชิก",
          "นามสกุล",
          "เพศ",
          "ประเภทสมาชิก",
          "ที่อยู่",
          "ตำบล",
          "อำเภอ",
          "จังหวัด",
          "รหัสไปรษณีย์",
          "เบอร์โทรศัพท์",
          "วัน เดือน ปีเกิด",
          "วันที่อนุมัติให้เป็น",
          "อนุมัติรายการโดย",
          "วันที่บันทึกรายการ",
          "สถานะสมาชิก",
          "จำนวนส่งค่าหุ้นต่อ",
          "มูลค่าหุ้นคงเหลือ",
          "เงินเดือน",
        ].join(","),
        ...data.members.map((m) =>
          [
            `="${m.MEMBER_NO}"`,
            csvText(m.PRENAME_DESC),
            csvText(m.MEMB_NAME),
            csvText(m.MEMB_SURNAME),
            csvText(m.SEX_DESC),
            csvText(m.MEMBTYPE_DESC),
            csvText(m.ADDRESS_NO),
            csvText(m.TAMBOL_DESC),
            csvText(m.DISTRICT_DESC),
            csvText(m.PROVINCE_DESC),
            `="${m.POSTCODE || ""}"`,
            `="${m.MEM_TELMOBILE || ""}"`,
            fmtDateTH(m.BIRTH_DATE),
            fmtDateTH(m.APPROVE_DATE),
            csvText(m.APPROVE_ID),
            fmtDateTH(m.MEMBER_DATE),
            csvText(m.STATUS_TEXT),
            csvNum(m.SHARE_AMOUNT),
            csvNum(m.SHARE_STOCK),
            csvNum(m.SALARY_AMOUNT),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_member_registry_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF — logo + fonts
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-member-registry/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.members.length > CHUNK_SIZE) {
      const allMembers = data.members;
      const totalChunks = Math.ceil(allMembers.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkMembers = allMembers.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = {
          ...data,
          members: chunkMembers,
          _rowOffset: i * CHUNK_SIZE,
        };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunkMembers.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.members.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_member_registry_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor member registry error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/loan-approval
 * รายงานรายละเอียดการอนุมัติและจ่ายเงินกู้ (สำหรับผู้ตรวจสอบบัญชี) — 25 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/loan-approval", async (req, res) => {
  try {
    const { startDate, endDate, loanTypeCode, membGroupCode, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      loanTypeCode,
      membGroupCode,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorLoanApprovalData(filters);
    emitProgress(clientId, `พบรายการอนุมัติเงินกู้ทั้งหมด ${data.loans.length.toLocaleString('en-US')} รายการ`);

    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "ชื่อสมาชิก",
          "เลขทะเบียน",
          "เงินเดือน",
          "หน่วยงาน",
          "เลขที่คำขอกู้",
          "จำนวนเงินขอกู้",
          "เงินกู้ที่ได้รับอนุมัติ",
          "เลขที่สัญญา",
          "เจ้าหน้าที่ผู้อนุมัติรายการ",
          "จำนวนงวด",
          "เงินงวด",
          "สัญญาเริ่มต้น",
          "วิธีการชำระ",
          "วันที่เริ่มชำระ",
          "ชำระหนี้เดิม",
          "ชำระดอกเบี้ย",
          "ชำระหุ้น",
          "ประกันชีวิต",
          "รับจริง",
          "เลขที่ใบเสร็จ",
          "ผู้บันทึกรายการ",
          "วัตถุประสงค์",
          "เลขที่บัญชีธนาคาร",
          "ชื่อธนาคาร",
          "ทุนเรือนหุ้น ณ วันที่กู้",
        ].join(","),
        ...data.loans.map((l) =>
          [
            csvText(l.MEMBER_NAME),
            `="${l.MEMBER_NO}"`,
            csvNum(l.SALARY_AMT),
            csvText(l.MEMBGROUP_DESC),
            csvText(l.LOANREQUEST_DOCNO),
            csvNum(l.LOANREQUEST_AMT),
            csvNum(l.LOANAPPROVE_AMT),
            csvText(l.LOANCONTRACT_NO),
            csvText(l.APPROVE_ID),
            l.NUM_INSTALLMENTS || 0,
            csvNum(l.PERIOD_PAYMENT_AMT),
            fmtDateTH(l.STARTCONT_DATE),
            csvText(l.LOANPAYMENT_DESC),
            csvText(l.START_KEEP_TEXT),
            csvNum(l.CLEAR_PRN_AMT),
            csvNum(l.CLEAR_INT_AMT),
            csvNum(l.SHARE_BUY_AMT),
            csvNum(l.INSURANCE_AMT),
            csvNum(l.REAL_RECEIVE_AMT),
            csvText(l.RECEIVE_NO),
            csvText(l.ENTRY_ID),
            csvText(l.LOANOBJECTIVE_DESC),
            `="${l.BANK_ACC_NO || ""}"`,
            csvText(l.BANK_DESC),
            csvNum(l.SHARE_STOCK_AT_LOAN),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_loan_approval_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-loan-approval/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 2000;
    let pdfBuffer;

    if (data.loans.length > CHUNK_SIZE) {
      const allLoans = data.loans;
      const totalChunks = Math.ceil(allLoans.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkLoans = allLoans.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = {
          ...data,
          loans: chunkLoans,
          _rowOffset: i * CHUNK_SIZE,
        };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunkLoans.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.loans.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_loan_approval_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor loan approval error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/loan-approval/lookups
 * Filter options for the loan approval report
 */
router.get("/auditor/loan-approval/lookups", async (req, res) => {
  try {
    const lookups = await getLoanLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Loan lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/share-loan-balance
 * รายงานหุ้น-หนี้คงเหลือรายตัว ณ วันที่ X — 14 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/share-loan-balance", async (req, res) => {
  try {
    const { asOfDate, loanTypeCode, membGroupCode, memberNo, limit, format, clientId } = req.body;

    const filters = {
      asOfDate,
      loanTypeCode,
      membGroupCode,
      memberNo,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorShareLoanBalanceData(filters);
    emitProgress(clientId, `พบสัญญาที่มียอดคงเหลือ ${data.items.length.toLocaleString('en-US')} สัญญา (${data.summary.distinctMembers} ราย)`);

    if (format === "csv") {
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "ปีบัญชี",
          "เดือนบัญชี",
          "เลขทะเบียนสมาชิก",
          "รหัสหน่วยงาน",
          "รหัสหุ้น_หนี้",
          "เลขที่สัญญา",
          "ยอดคงเหลือ",
          "งวดชำระล่าสุด",
          "งวดชำระทั้งสิ้น",
          "ค่าหุ้นต่องวด",
          "หุ้นคงเหลือ",
          "เงินงวด",
          "ดอกเบี้ยค้าง",
          "จำนวนวัน",
        ].join(","),
        ...data.items.map((r) =>
          [
            r.ACCOUNT_YEAR,
            `="${r.ACCOUNT_MONTH}"`,
            `="${r.MEMBER_NO}"`,
            `="${r.MEMBGROUP_CODE || ""}"`,
            `="${r.LOANTYPE_CODE || ""}"`,
            csvText(r.LOANCONTRACT_NO),
            csvNum(r.PRINCIPAL_BALANCE),
            r.LAST_PERIOD || 0,
            r.MAX_PERIOD || 0,
            csvNum(r.PERIODSHARE_AMT),
            csvNum(r.SHARESTK_AMT),
            csvNum(r.PERIOD_PAYMENT_AMT),
            csvNum(r.INTEREST_ARREAR),
            r.REPORT_DAY || 0,
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_share_loan_balance_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-share-loan-balance/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 2500;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_share_loan_balance_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor share-loan balance error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/share-loan-balance/lookups
 */
router.get("/auditor/share-loan-balance/lookups", async (req, res) => {
  try {
    const lookups = await getShareLoanBalanceLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Share-loan lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/interest-arrears
 * รายงานดอกเบี้ยค้างชำระ และจำนวนงวดที่ค้างชำระ — 8 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/interest-arrears", async (req, res) => {
  try {
    const { asOfDate, filterMode, membGroupCode, memberNo, limit, format, clientId } = req.body;

    const filters = {
      asOfDate,
      filterMode,
      membGroupCode,
      memberNo,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorInterestArrearsData(filters);
    emitProgress(clientId, `พบสัญญาค้างชำระ ${data.items.length.toLocaleString('en-US')} สัญญา (${data.summary.distinctMembers} ราย)`);

    if (format === "csv") {
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "ชื่อสมาชิก",
          "รหัสหน่วยงาน",
          "ชื่อหน่วยงาน",
          "เลขที่สัญญา",
          "หนี้คงเหลือ",
          "งวดที่ค้าง",
          "ดอกเบี้ยค้างชำระ",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            csvText(r.MEMBER_NAME),
            `="${r.MEMBGROUP_CODE || ""}"`,
            csvText(r.MEMBGROUP_DESC),
            csvText(r.LOANCONTRACT_NO),
            csvNum(r.PRINCIPAL_BALANCE),
            r.COUNT_RPM || 0,
            csvNum(r.INTEREST_ARREAR),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_interest_arrears_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-interest-arrears/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    emitProgress(clientId, {
      message: `กำลังสร้างเอกสาร PDF...`,
      action: 'count',
      current: 0,
      total: data.items.length,
      prefix: `กำลังสร้างเอกสาร PDF (`,
      suffix: ` รายการ)...`
    });
    const pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_interest_arrears_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor interest arrears error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/interest-arrears/lookups
 */
router.get("/auditor/interest-arrears/lookups", async (req, res) => {
  try {
    const lookups = await getArrearsLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Arrears lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/monthly-collection
 * รายงานส่งเก็บหุ้น-หนี้ เงินรับฝาก รายเดือน — 27 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/monthly-collection", async (req, res) => {
  try {
    const { startDate, endDate, membGroupCode, memberNo, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      membGroupCode,
      memberNo,
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorMonthlyCollectionData(filters);
    emitProgress(clientId, `พบใบเสร็จ ${data.items.length.toLocaleString('en-US')} ใบ`);

    if (format === "csv") {
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "คำนำหน้านาม",
          "ชื่อ",
          "สกุล",
          "เดือนปีที่ออกใบเสร็จ",
          "เลขที่ใบเสร็จ",
          "งวดหุ้น",
          "เงินหุ้นส่งเก็บ",
          "เงินรับฝาก",
          "รหัสเงินกู้ฉุกเฉิน",
          "สัญญาฉุกเฉิน",
          "งวดฉุกเฉินส่งเก็บ",
          "หนี้ฉุกเฉิน",
          "ดอกเบี้ยฉุกเฉิน",
          "ยอดคงเหลือฉุกเฉิน",
          "รหัสเงินกู้สามัญ",
          "สัญญาสามัญ",
          "งวดสามัญส่งเก็บ",
          "หนี้สามัญ",
          "ดอกเบี้ยสามัญ",
          "ยอดคงเหลือสามัญ",
          "รหัสเงินกู้พิเศษ",
          "สัญญาพิเศษ",
          "งวดพิเศษส่งเก็บ",
          "หนี้พิเศษ",
          "ดอกเบี้ยพิเศษ",
          "ยอดคงเหลือพิเศษ",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            csvText(r.PRENAME_DESC),
            csvText(r.MEMB_NAME),
            csvText(r.MEMB_SURNAME),
            `="${r.RECV_PERIOD || ""}"`,
            `="${r.RECEIPT_NO || ""}"`,
            r.SHARE_PERIOD || 0,
            csvNum(r.SHARE_VALUE),
            csvNum(r.DEPSAV_AMT),
            `="${r.EMER_LOANTYPE || ""}"`,
            csvText(r.EMER_CONTRACT),
            r.EMER_PERIOD || 0,
            csvNum(r.EMER_PRINCIPAL),
            csvNum(r.EMER_INTEREST),
            csvNum(r.EMER_BALANCE),
            `="${r.NORM_LOANTYPE || ""}"`,
            csvText(r.NORM_CONTRACT),
            r.NORM_PERIOD || 0,
            csvNum(r.NORM_PRINCIPAL),
            csvNum(r.NORM_INTEREST),
            csvNum(r.NORM_BALANCE),
            `="${r.SPEC_LOANTYPE || ""}"`,
            csvText(r.SPEC_CONTRACT),
            r.SPEC_PERIOD || 0,
            csvNum(r.SPEC_PRINCIPAL),
            csvNum(r.SPEC_INTEREST),
            csvNum(r.SPEC_BALANCE),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_monthly_collection_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-monthly-collection/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 2000;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_monthly_collection_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor monthly collection error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/monthly-collection/lookups
 */
router.get("/auditor/monthly-collection/lookups", async (req, res) => {
  try {
    const lookups = await getMonthlyCollLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Monthly collection lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/loan-statement
 * Statement หนี้รายตัวของสมาชิก — 15 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/loan-statement", async (req, res) => {
  try {
    const { startDate, endDate, memberNo, loanContractNo, membGroupCode, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      memberNo,
      loanContractNo,
      membGroupCode,
      limit: (limit !== undefined && limit !== null) ? limit : 1000,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorLoanStatementData(filters);
    emitProgress(clientId, `พบรายการเคลื่อนไหว ${data.items.length.toLocaleString('en-US')} รายการ (${data.summary.distinctContracts} สัญญา)`);

    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "เลขที่สัญญา",
          "ชื่อ",
          "นามสกุล",
          "ลำดับรายการ",
          "วันที่ทำรายการ",
          "วันที่เริ่มคำนวณ",
          "วันสิ้นสุดการ",
          "งวดที่",
          "รหัสรายการ",
          "เงินต้น",
          "ดอกเบี้ย",
          "ยอดคงเหลือ",
          "ดอกเบี้ยต่องวด",
          "ดอกเบี้ยค้างรับ",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            csvText(r.LOANCONTRACT_NO),
            csvText(r.MEMB_NAME),
            csvText(r.MEMB_SURNAME),
            r.SEQ_NO || 0,
            fmtDateTH(r.SLIP_DATE),
            fmtDateTH(r.CALINT_FROM),
            fmtDateTH(r.CALINT_TO),
            r.PERIOD || 0,
            csvText(r.LOANITEMTYPE_CODE),
            csvNum(r.PRINCIPAL_PAYMENT),
            csvNum(r.INTEREST_PAYMENT),
            csvNum(r.PRINCIPAL_BALANCE),
            csvNum(r.INTEREST_PERIOD),
            csvNum(r.INTEREST_ARREAR),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_loan_statement_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-loan-statement/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_loan_statement_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor loan statement error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/loan-statement/lookups
 */
router.get("/auditor/loan-statement/lookups", async (req, res) => {
  try {
    const lookups = await getLoanStmtLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Loan statement lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/share-statement
 * Statement หุ้นรายตัวของสมาชิก — 10 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/share-statement", async (req, res) => {
  try {
    const { startDate, endDate, memberNo, shareTypeCode, membGroupCode, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      memberNo,
      shareTypeCode,
      membGroupCode,
      limit: (limit !== undefined && limit !== null) ? limit : 1000,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorShareStatementData(filters);
    emitProgress(clientId, `พบรายการเคลื่อนไหวหุ้น ${data.items.length.toLocaleString('en-US')} รายการ (${data.summary.distinctMembers} ราย)`);

    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "ชื่อ",
          "ลำดับ",
          "รหัสหุ้น",
          "วันที่สลิป",
          "รหัสรายการ",
          "งวด",
          "จำนวนหุ้น",
          "จำนวนหุ้นคงเหลือ",
          "รหัสอ้างอิง",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            csvText(r.MEMBER_NAME),
            r.SEQ_NO || 0,
            `="${r.SHARETYPE_CODE || ""}"`,
            fmtDateTH(r.SLIP_DATE),
            `="${r.SHRITEMTYPE_CODE || ""}"`,
            r.PERIOD || 0,
            csvNum(r.SHARE_AMOUNT),
            csvNum(r.SHARESTK_AMT),
            csvText(r.REF_DOCNO),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_share_statement_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/auditor-share-statement/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_share_statement_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor share statement error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/share-statement/lookups
 */
router.get("/auditor/share-statement/lookups", async (req, res) => {
  try {
    const lookups = await getShareStmtLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Share statement lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/deposit-transaction
 * รายงานฝาก/ถอน เงินฝาก — 10 ฟิลด์ตามข้อกำหนด
 */
router.post("/auditor/deposit-transaction", async (req, res) => {
  try {
    const { startDate, endDate, memberNo, deptAccountNo, deptTypeCode, itemTypeCode, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      memberNo,
      deptAccountNo,
      deptTypeCode,
      itemTypeCode,
      limit: (limit !== undefined && limit !== null) ? limit : 1000,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorDepositTransactionData(filters);
    emitProgress(clientId, `พบรายการเคลื่อนไหวเงินฝาก ${data.items.length.toLocaleString('en-US')} รายการ`);

    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "เลขที่บัญชี",
          "ชื่อ-สกุล",
          "วันที่รายการ",
          "รหัสรายการ",
          "จำนวนเงิน",
          "คงเหลือ",
          "รหัสประเภทเงินฝาก",
          "ประเภทเงินฝาก",
          "รายการ",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            `="${r.DEPTACCOUNT_NO || ""}"`,
            csvText(r.MEMBER_NAME),
            fmtDateTH(r.DEPTSLIP_DATE),
            `="${r.DEPTITEMTYPE_CODE || ""}"`,
            csvNum(r.DEPTSLIP_AMT),
            csvNum(r.PRNCBAL),
            `="${r.DEPTTYPE_CODE || ""}"`,
            csvText(r.DEPTTYPE_DESC),
            csvText(r.DEPTITEMTYPE_DESC),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditor_deposit_transaction_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/deposit-transaction/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="auditor_deposit_transaction_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Auditor deposit transaction error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/deposit-transaction/lookups
 */
router.get("/auditor/deposit-transaction/lookups", async (req, res) => {
  try {
    const lookups = await getDepositTxLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Deposit transaction lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/report/auditor/deposit-interest-tax
 * รายงานสรุปดอกเบี้ยและภาษี หัก ณ ที่จ่าย — 9 ฟิลด์ตามข้อกำหนด (+ TAX_AMT)
 */
router.post("/auditor/deposit-interest-tax", async (req, res) => {
  try {
    const { startDate, endDate, memberNo, deptAccountNo, deptTypeCode, limit, format, clientId } = req.body;

    const filters = {
      startDate,
      endDate,
      memberNo,
      deptAccountNo,
      deptTypeCode,
      limit: (limit !== undefined && limit !== null) ? limit : 1000,
    };

    emitProgress(clientId, "กำลังเตรียมดึงข้อมูลจากฐานข้อมูล...");
    const data = await getAuditorDepositInterestTaxData(filters);
    emitProgress(clientId, `พบรายการดอกเบี้ย ${data.items.length.toLocaleString('en-US')} รายการ`);

    if (format === "csv") {
      const fmtDateTH = (d) => {
        if (!d) return "";
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
      };
      const csvText = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const csvNum = (v) => (v == null || isNaN(Number(v))) ? "0.00" : Number(v).toFixed(2);

      const csvRows = [
        [
          "เลขทะเบียนสมาชิก",
          "เลขบัญชี",
          "ชื่อบัญชี",
          "รหัสรายการ",
          "จำนวนดอกเบี้ย",
          "ภาษีหัก ณ ที่จ่าย",
          "วันที่รายการ",
          "ยอดคงเหลือเดิม",
          "ยอดคงเหลือใหม่",
          "ประเภทบัญชีเงินฝาก",
        ].join(","),
        ...data.items.map((r) =>
          [
            `="${r.MEMBER_NO}"`,
            `="${r.DEPTACCOUNT_NO || ""}"`,
            csvText(r.ACCOUNT_NAME),
            `="${r.DEPTITEMTYPE_CODE || ""}"`,
            csvNum(r.INT_AMT),
            csvNum(r.TAX_AMT),
            fmtDateTH(r.DEPTSLIP_DATE),
            csvNum(r.BALANCE_OLD),
            csvNum(r.BALANCE_NEW),
            csvText(r.DEPTTYPE_DESC),
          ].join(",")
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deposit_interest_tax_${Date.now()}.csv"`,
      });
      return res.send("﻿" + csvRows.join("\n"));
    }

    // PDF
    const logoPath = path.join(__dirname, "../../public/logo/logo.png");
    let logoBase64 = "";
    if (fs.existsSync(logoPath)) {
      logoBase64 = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");
    }
    data.logoBase64 = logoBase64;

    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
      italic: "THSarabunNew Italic.ttf",
      boldItalic: "THSarabunNew BoldItalic.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/deposit-interest-tax/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.items.length > CHUNK_SIZE) {
      const allItems = data.items;
      const totalChunks = Math.ceil(allItems.length / CHUNK_SIZE);
      emitProgress(clientId, `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = allItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = { ...data, items: chunk, _rowOffset: i * CHUNK_SIZE };
        emitProgress(clientId, {
          message: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks}...`,
          action: 'count',
          current: 0,
          total: chunk.length,
          prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
          suffix: ` รายการ)...`
        });
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }
      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุด...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.items.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
    }
    emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="deposit_interest_tax_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Deposit interest-tax error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/report/auditor/deposit-interest-tax/lookups
 */
router.get("/auditor/deposit-interest-tax/lookups", async (req, res) => {
  try {
    const lookups = await getDepositIntTaxLookups();
    res.json(lookups);
  } catch (err) {
    console.error("[Route] Deposit int-tax lookups error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
