/**
 * Handlebars helpers for report templates
 */
module.exports = {
  /**
   * Format number with commas and 2 decimal places
   * Usage: {{formatNumber 1234567.89}}
   */
  formatNumber(value) {
    if (value == null || isNaN(value)) return "0.00";
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  /**
   * Convert string to lowercase
   * Usage: {{lowercase "HELLO"}}
   */
  lowercase(str) {
    return str ? String(str).toLowerCase() : "";
  },

  /**
   * Format date string
   * Usage: {{formatDate "2024-03-15" "DD/MM/YYYY"}}
   */
  formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear() + 543; // Buddhist Era
    return `${day}/${month}/${year}`;
  },

  /**
   * Conditional equals
   * Usage: {{#ifEquals status "Completed"}}...{{/ifEquals}}
   */
  ifEquals(a, b, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  },

  /**
   * Row index (1-based)
   * Usage: {{rowIndex @index}}
   */
  rowIndex(index) {
    return index + 1;
  },
};
