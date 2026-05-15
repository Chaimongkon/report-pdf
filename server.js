require("dotenv").config();

// Set Chrome path for puppeteer before any module loads
if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
  const fs = require("fs");
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      process.env.PUPPETEER_EXECUTABLE_PATH = p;
      console.log(`[Chrome] Found: ${p}`);
      break;
    }
  }
}

const path = require("path");
const express = require("express");
const db = require("./src/db/oracle");
const pdfRenderer = require("./src/utils/pdfRenderer");
const reportRoutes = require("./src/routes/report");
const depositRoutes = require("./src/routes/deposit");

const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // ───── Initialize PDF Renderer (puppeteer-core@19 + Chrome 109) ─────
  await pdfRenderer.init();
  console.log("[PdfRenderer] Initialized successfully");

  // Store renderer on app for use in routes
  app.set("pdfRenderer", pdfRenderer);

  // ───── Initialize Oracle (optional, skip if not configured) ─────
  const oracleConfigured =
    process.env.ORACLE_USER &&
    process.env.ORACLE_USER !== "your_username" &&
    process.env.ORACLE_PASSWORD !== "your_password";

  if (oracleConfigured) {
    try {
      await db.initialize();
      console.log("[Oracle] Connected to database");
    } catch (err) {
      console.warn("[Oracle] Not connected - use useMock=true in requests:", err.message);
    }
  } else {
    console.log("[Oracle] Not configured - use useMock=true in requests");
    console.log("[Oracle] Edit .env file to configure Oracle connection");
  }

  // ───── Static files (no cache for dev) ─────
  app.use(express.static(path.join(__dirname, "public"), {
    etag: false,
    setHeaders: (res) => {
      res.set("Cache-Control", "no-store");
    },
  }));

  // ───── Increase timeout for large reports (10 min) ─────
  app.use((req, res, next) => {
    res.setTimeout(600000);
    next();
  });

  // ───── Routes ─────
  app.use("/api/report/deposit", depositRoutes); // More specific route must come first
  app.use("/api/report", reportRoutes);        // General route comes second

  // API info endpoint
  app.get("/api", (req, res) => {
    res.json({
      service: "PDF Report Generator",
      version: "1.0.0",
      endpoints: {
        "POST /api/report/member": "Generate member report PDF from Oracle",
        "GET  /api/report/member/lookups": "Get filter dropdown options",
        "POST /api/report/sales": "Generate sales report PDF (mock)",
        "POST /api/report/batch": "Generate batch reports",
        "POST /api/report/merge": "Merge multiple reports into one PDF",
        "GET  /api/report/health": "Health check",
      },
    });
  });

  // ───── Start Server ─────
  app.listen(PORT, () => {
    console.log(`\n[Server] Report PDF service running at http://localhost:${PORT}`);
    console.log(`[Server] Try: POST http://localhost:${PORT}/api/report/sales`);
    console.log(`         Body: { "useMock": true }\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Server] Shutting down...");
    await pdfRenderer.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
