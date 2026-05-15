/**
 * PDF Renderer using puppeteer-core@19 + Handlebars
 * Replaces jsreport for Chrome 109 compatibility on Windows Server 2012 R2
 */
const puppeteer = require("puppeteer-core-19");
const Handlebars = require("handlebars");
const fs = require("fs");

let browser = null;
let chromePath = null;

/**
 * Initialize the renderer — find Chrome and launch a persistent browser
 */
async function init() {
  chromePath =
    process.env.CHROME_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

  if (!fs.existsSync(chromePath)) {
    // Try alternate location
    const alt = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    if (fs.existsSync(alt)) chromePath = alt;
    else throw new Error(`Chrome not found at ${chromePath}`);
  }

  console.log(`[PdfRenderer] Chrome: ${chromePath}`);

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    timeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-software-rasterizer",
    ],
  });

  console.log("[PdfRenderer] Browser launched");
  return browser;
}

/**
 * Render HTML template string + data → PDF Buffer
 *
 * @param {string} templateContent - Handlebars HTML template
 * @param {object} data            - Data to pass to the template
 * @param {string} helpersJs       - JS string defining Handlebars helper functions
 * @param {object} chromeOpts      - PDF options (margins, format, landscape, etc.)
 * @returns {Promise<Buffer>}
 */
async function renderPdf(templateContent, data, helpersJs, chromeOpts = {}) {
  if (!browser || !browser.isConnected()) {
    console.log("[PdfRenderer] Browser not connected, relaunching...");
    await init();
  }

  // Register helpers from JS string
  const hbs = Handlebars.create();
  if (helpersJs) {
    // Execute the helpers JS in a context that registers them on this hbs instance
    const helperFn = new Function("Handlebars", helpersJs + `
      ;const _names = Object.keys(this).filter(k => typeof this[k] === 'function');
      // no-op, helpers are defined as globals in the function scope
    `);
    // Parse helper functions from the JS string and register them
    const helperNames = helpersJs.match(/function\s+(\w+)\s*\(/g) || [];
    for (const match of helperNames) {
      const name = match.replace(/function\s+/, "").replace(/\s*\(/, "");
      try {
        const fn = new Function(
          "Handlebars",
          helpersJs + `\nreturn ${name};`
        )(hbs);
        hbs.registerHelper(name, fn);
      } catch (e) {
        // skip helpers that can't be extracted
      }
    }
  }

  // Compile and render template
  const compiled = hbs.compile(templateContent);
  const html = compiled(data);

  // Open page, set content, generate PDF
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 120000 });

    const pdfOptions = {
      format: chromeOpts.format || "A4",
      landscape: chromeOpts.landscape || false,
      printBackground: chromeOpts.printBackground !== false,
      margin: {
        top: chromeOpts.marginTop || "0mm",
        bottom: chromeOpts.marginBottom || "0mm",
        left: chromeOpts.marginLeft || "0mm",
        right: chromeOpts.marginRight || "0mm",
      },
    };

    if (chromeOpts.displayHeaderFooter) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = chromeOpts.headerTemplate || "<span></span>";
      pdfOptions.footerTemplate = chromeOpts.footerTemplate || "<span></span>";
    }

    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Close the browser
 */
async function close() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    console.log("[PdfRenderer] Browser closed");
  }
}

module.exports = { init, renderPdf, close };
