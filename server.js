require("dotenv").config();

const path = require("path");
const express = require("express");
const jsreportCore = require("@jsreport/jsreport-core");
const db = require("./src/db/oracle");
const reportRoutes = require("./src/routes/report");

const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // ───── Initialize jsreport ─────
  console.log("[jsreport] Initializing...");
  const jsreport = jsreportCore({
    // Disable jsreport's built-in Express server
    extensions: {
      express: { enabled: false },
    },
    tempDirectory: "./tmp",
    loadConfig: false,
    reportTimeout: 300000, // 5 minutes for large reports
  });

  jsreport.use(require("@jsreport/jsreport-chrome-pdf")());
  jsreport.use(require("@jsreport/jsreport-handlebars")());

  // pdf-utils is optional for merge operations
  try {
    jsreport.use(require("@jsreport/jsreport-pdf-utils")());
  } catch (e) {
    console.log("[jsreport] pdf-utils not loaded (optional):", e.message);
  }

  await jsreport.init();
  console.log("[jsreport] Initialized successfully");

  // Store jsreport instance on app for use in routes
  app.set("jsreport", jsreport);

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
  app.use("/api/report", reportRoutes);

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
    await jsreport.close();
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
