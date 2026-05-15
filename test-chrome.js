// Test puppeteer-core@19 with Chrome 109
// Install first: npm install puppeteer-core-19@npm:puppeteer-core@19.11.1
const puppeteer = require("puppeteer-core-19");

const chromePath = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

console.log("Node:", process.version);
console.log("puppeteer-core-19:", require("puppeteer-core-19/package.json").version);
console.log("Chrome:", chromePath);

(async () => {
  console.log("\nLaunching Chrome 109 with puppeteer-core@19...");
  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      timeout: 30000,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    console.log("Chrome launched!");
    const page = await browser.newPage();
    console.log("Page created. Setting content...");
    await page.setContent("<h1>Hello World</h1><p>Test PDF</p>");
    console.log("Content set. Generating PDF...");
    const pdf = await page.pdf({ format: "A4" });
    console.log("PDF:", pdf.length, "bytes");
    await browser.close();
    console.log("\nSUCCESS! puppeteer-core@19 + Chrome 109 works!");
  } catch (err) {
    console.error("FAILED:", err.message);
    console.error(err);
  }
  process.exit(0);
})();
