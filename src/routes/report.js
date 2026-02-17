const express = require("express");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { getMockSalesData, getSalesReportData } = require("../services/reportService");
const { getMemberReportData, getMemberLookups } = require("../services/memberService");
const { savePdf, batchGenerate, saveBatchResults } = require("../utils/pdfUtils");

const router = express.Router();

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
async function renderPdf(jsreport, templateContent, data, chromeOpts) {
  const result = await jsreport.render({
    template: {
      content: templateContent,
      engine: "handlebars",
      recipe: "chrome-pdf",
      helpers: HELPERS_JS,
      chrome: chromeOpts || CHROME_OPTIONS,
    },
    data: data,
  });

  const chunks = [];
  for await (const chunk of result.stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
    const jsreport = req.app.get("jsreport");

    const pdfBuffer = await renderPdf(jsreport, templateContent, data);

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
    const jsreport = req.app.get("jsreport");

    const renderFn = async (params) => {
      const data = await getReportData(params, useMock);
      return renderPdf(jsreport, templateContent, data);
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
    const jsreport = req.app.get("jsreport");

    // Generate all individual PDFs
    const pdfBuffers = [];
    for (const params of reports) {
      const data = await getReportData(params, useMock);
      const buf = await renderPdf(jsreport, templateContent, data);
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
 * POST /api/report/member
 * Generate member report PDF from Oracle
 * Body: { membTypeCode, membGroupFrom, membGroupTo, memberFrom, memberTo, memberStatus, provinceCode, limit, format }
 */
router.post("/member", async (req, res) => {
  try {
    const { membCatCode, membTypeCode, membGroupCode, membGroupFrom, membGroupTo, memberFrom, memberTo, statusFilter, provinceCode, limit, format } = req.body;

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
      limit: (limit !== undefined && limit !== null) ? limit : 500,
    };

    console.log("[Member Report] filters:", JSON.stringify(filters));
    const data = await getMemberReportData(filters);
    console.log("[Member Report] members:", data.members.length, "filterDesc:", data.filterDesc);

    // CSV export
    if (format === "csv") {
      const csvRows = [
        ["เลขที่สมาชิก", "คำนำหน้า", "ชื่อ", "นามสกุล", "ประเภท", "กลุ่ม/หน่วยงาน", "วันสมัคร", "เบอร์มือถือ", "เงินเดือน", "จังหวัด", "สถานะ"].join(","),
        ...data.members.map((m) =>
          [
            m.MEMBER_NO,
            m.PRENAME_DESC || "",
            m.MEMB_NAME || "",
            m.MEMB_SURNAME || "",
            m.MEMBTYPE_DESC || "",
            `"${(m.MEMBGROUP_DESC || "").replace(/"/g, '""')}"`,
            m.MEMBER_DATE ? new Date(m.MEMBER_DATE).toLocaleDateString("th-TH") : "",
            m.MEM_TELMOBILE || "",
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
    const jsreport = req.app.get("jsreport");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.members.length > CHUNK_SIZE) {
      // Split into chunks, render each, then merge with pdf-lib
      const allMembers = data.members;
      const totalChunks = Math.ceil(allMembers.length / CHUNK_SIZE);
      console.log(`[Member Report] Large dataset: ${allMembers.length} rows, splitting into ${totalChunks} chunks`);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkMembers = allMembers.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkData = {
          ...data,
          members: chunkMembers,
          _rowOffset: i * CHUNK_SIZE,
          _chunkInfo: `หน้าชุดที่ ${i + 1}/${totalChunks}`,
        };
        console.log(`[Member Report] Rendering chunk ${i + 1}/${totalChunks} (${chunkMembers.length} rows)...`);
        const buf = await renderPdf(jsreport, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      // Merge all PDFs
      console.log(`[Member Report] Merging ${pdfBuffers.length} PDFs...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
      console.log(`[Member Report] Merged PDF: ${pdfBuffer.length} bytes`);
    } else {
      pdfBuffer = await renderPdf(jsreport, templateContent, data, CHROME_LANDSCAPE);
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

module.exports = router;
