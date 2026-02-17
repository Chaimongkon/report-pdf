const fs = require("fs");
const path = require("path");

/**
 * Save PDF buffer to a file
 * @param {Buffer} pdfBuffer - PDF content
 * @param {string} filename - Output filename
 * @returns {string} Full output path
 */
function savePdf(pdfBuffer, filename) {
  const outputDir = process.env.OUTPUT_DIR || "./output";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`[PDF] Saved: ${outputPath}`);
  return outputPath;
}

/**
 * Generate batch reports for multiple parameter sets
 * @param {Function} renderFn - async function(params) => Buffer
 * @param {Array<object>} paramsList - Array of parameter objects
 * @returns {Promise<Array<{params, buffer, filename}>>} results
 */
async function batchGenerate(renderFn, paramsList) {
  const results = [];
  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    console.log(`[Batch] Generating report ${i + 1}/${paramsList.length}...`);
    try {
      const buffer = await renderFn(params);
      const filename = `report_${i + 1}_${Date.now()}.pdf`;
      results.push({ params, buffer, filename, success: true });
    } catch (err) {
      console.error(`[Batch] Error on report ${i + 1}:`, err.message);
      results.push({ params, buffer: null, filename: null, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * Save batch results as individual files or a zip
 * @param {Array} results - from batchGenerate
 * @param {string} mode - 'files' | 'zip'
 * @returns {string[]} saved file paths
 */
function saveBatchResults(results, mode = "files") {
  const outputDir = process.env.OUTPUT_DIR || "./output";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const savedPaths = [];
  for (const result of results) {
    if (result.success && result.buffer) {
      const outputPath = path.join(outputDir, result.filename);
      fs.writeFileSync(outputPath, result.buffer);
      savedPaths.push(outputPath);
    }
  }

  console.log(`[Batch] Saved ${savedPaths.length} PDF files to ${outputDir}`);
  return savedPaths;
}

module.exports = { savePdf, batchGenerate, saveBatchResults };
