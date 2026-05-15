const express = require("express");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { EventEmitter } = require("events");
const { getDepositLookups, getRptm0009Data } = require("../services/depositService");
const { savePdf } = require("../utils/pdfUtils");

const router = express.Router();
// Shared with report.js ideally, but for simplicity defining its own emitter for this route group
const progressEmitter = new EventEmitter();

function emitProgress(clientId, payload) {
    if (clientId) {
        if (typeof payload === 'string') {
            progressEmitter.emit(`progress-${clientId}`, { message: payload });
        } else {
            progressEmitter.emit(`progress-${clientId}`, payload);
        }
    }
}

const CHROME_LANDSCAPE = {
    marginTop: "0mm",
    marginBottom: "12mm",
    marginLeft: "0mm",
    marginRight: "0mm",
    format: "A4",
    landscape: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;text-align:center;font-size:7px;color:#bbb;border-top:1px solid #ccc;padding-top:2px;">
    สหกรณ์ออมทรัพย์กรมทางหลวง จำกัด | ระบบรายงาน PDF | หน้า <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>`,
};

// Re-using the same helpers from report.js for this router file
const HELPERS_JS = `
function formatNumber(value) {
  if (value == null || isNaN(value) || Number(value) === 0) return "-";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAccount(acct) {
  if (!acct) return "";
  var s = String(acct).replace(/[^0-9]/g, "");
  if (s.length >= 10) return s.substr(0,3) + "-" + s.substr(3,1) + "-" + s.substr(4,5) + "-" + s.substr(9);
  return acct;
}

function dashIfEmpty(value) {
  if (value == null || value === "") return "-";
  return value;
}

function formatDateTH(dateVal) {
  if (!dateVal) return "-";
  var d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  var day = String(d.getDate()).padStart(2, "0");
  var month = String(d.getMonth() + 1).padStart(2, "0");
  var year = d.getFullYear() + 543;
  return day + "/" + month + "/" + year;
}

function rowIndex(index, offset) {
  if (typeof offset !== 'number') offset = 0;
  return index + 1 + offset;
}
`;

async function renderPdf(pdfRenderer, templateContent, data, chromeOpts) {
    return pdfRenderer.renderPdf(templateContent, data, HELPERS_JS, chromeOpts);
}

/**
 * GET /api/report/deposit/progress
 * Server-Sent Events endpoint to stream generation progress
 */
router.get("/progress", (req, res) => {
    const clientId = req.query.clientId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (data) => {
        res.write(`data: ${JSON.stringify(data)}nn`);
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
 * GET /api/report/deposit/lookups
 * Get filter options for deposit forms
 */
router.get("/lookups", async (req, res) => {
    try {
        const lookups = await getDepositLookups();
        res.json(lookups);
    } catch (err) {
        console.error("[Route] Deposit Lookups error:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/report/deposit/rptm0009
 * Generate deposit report 7
 * Body: { branchCode, date, format, limit, clientId }
 */
router.post("/rptm0009", async (req, res) => {
    try {
        const { branchCode, date, format, limit, clientId } = req.body;

        const filters = {
            branchCode,
            date,
            limit: (limit !== undefined && limit !== null) ? limit : 0,
        };

        console.log("[Deposit Report] filters:", JSON.stringify(filters));

        emitProgress(clientId, "กำลังเตรียมข้อมูลรายงาน RPTM0009...");

        const data = await getRptm0009Data(filters);
        emitProgress(clientId, `พบข้อมูลรายการทั้งหมด ${data.records.length.toLocaleString('en-US')} รายการ`);

    // CSV export
    if (format === "csv") {
      const csvRows = [
        ["ลำดับ", "วันที่", "เลขบัญชี", "ชื่อบัญชี", "ยอดคงเหลือ", "ดอกเบี้ยสะสม", "วันที่ครบดิว", "ระยะเวลาวัน", "คิดดอก(เดือน)", "ดอกเบี้ยถึงวันครบ", "8วัน-1เดือน", "> 1-3เดือน", "> 3-6เดือน", "> 6-12เดือน", "> 1-5ปี"].join(","),
        ...data.records.map((r) => {
          const fmtNum = (v) => {
            if (v == null || v === "" || Number(v) === 0) return "-";
            return `"${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`;
          };
          const fmtInt = (v) => (v == null || v === "" || v === 0) ? "-" : v;
          const fmtDate = (d) => d ? new Date(d).toLocaleDateString("th-TH") : "-";
          return [
            r.ROW_NUM || "",
            fmtDate(r.REC_DATE),
            r.ACCOUNT_NO ? r.ACCOUNT_NO.replace(/^(\d{3})(\d)(\d{5})(\d+)$/, "$1-$2-$3-$4") : "",
            `"${r.ACCOUNT_NAME || ""}"`,
            fmtNum(r.BALANCE),
            fmtNum(r.ACC_INTEREST),
            fmtDate(r.DUE_DATE),
            fmtInt(r.DURATION_DAYS),
            fmtInt(r.INT_MONTHS),
            fmtNum(r.INT_TO_DUE),
            fmtNum(r.BUCKET_8D_1M),
            fmtNum(r.BUCKET_1_3M),
            fmtNum(r.BUCKET_3_6M),
            fmtNum(r.BUCKET_6_12M),
            fmtNum(r.BUCKET_1_5Y),
          ].join(",");
        }
        ),
      ];
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rptm0009_report_${Date.now()}.csv"`,
      });
      return res.send("\uFEFF" + csvRows.join("\n"));
    }

    // Embed THSarabunNew fonts
    const fontDir = path.join(__dirname, "../../public/THSarabunNew");
    const fontFiles = {
      regular: "THSarabunNew.ttf",
      bold: "THSarabunNew Bold.ttf",
    };
    data.fonts = {};
    for (const [key, filename] of Object.entries(fontFiles)) {
      const fp = path.join(fontDir, filename);
      if (fs.existsSync(fp)) {
        data.fonts[key] = "data:font/truetype;base64," + fs.readFileSync(fp).toString("base64");
      }
    }

    const templatePath = path.join(__dirname, "../../templates/deposit-rptm0009/content.html");
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const pdfRenderer = req.app.get("pdfRenderer");

    const CHUNK_SIZE = 3000;
    let pdfBuffer;

    if (data.records.length > CHUNK_SIZE) {
      const allRecords = data.records;
      const totalChunks = Math.ceil(allRecords.length / CHUNK_SIZE);
      const msg = `ข้อมูลมีจำนวนมาก แบ่งการสร้าง PDF เป็น ${totalChunks} ชุด`;
      emitProgress(clientId, msg);

      const pdfBuffers = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkRecords = allRecords.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const isLast = (i === totalChunks - 1);
        const chunkData = {
          ...data,
          records: chunkRecords,
          _rowOffset: i * CHUNK_SIZE,
          _chunkInfo: `หน้าชุดที่ ${i + 1}/${totalChunks}`,
          totals: isLast ? data.totals : null,
        };
        const chunkMsg = `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (${chunkRecords.length.toLocaleString('en-US')} รายการ)...`;
        
        emitProgress(clientId, {
            message: chunkMsg,
            action: 'count',
            current: 0,
            total: chunkRecords.length,
            prefix: `กำลังสร้างหน้าชุดที่ ${i + 1}/${totalChunks} (`,
            suffix: ` รายการ)...`
        });
        
        const buf = await renderPdf(pdfRenderer, templateContent, chunkData, CHROME_LANDSCAPE);
        pdfBuffers.push(buf);
      }

      emitProgress(clientId, `กำลังรวมไฟล์ PDF ทั้ง ${totalChunks} ชุดเข้าด้วยกัน...`);
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      pdfBuffer = Buffer.from(await mergedPdf.save());
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    } else {
      emitProgress(clientId, {
        message: `กำลังสร้างเอกสาร PDF...`,
        action: 'count',
        current: 0,
        total: data.records.length,
        prefix: `กำลังสร้างเอกสาร PDF (`,
        suffix: ` รายการ)...`
      });
      pdfBuffer = await renderPdf(pdfRenderer, templateContent, data, CHROME_LANDSCAPE);
      emitProgress(clientId, `สร้างเอกสารเสร็จสมบูรณ์ เตรียมส่งไฟล์...`);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rptm0009_report_${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[Route] Deposit report error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
