/*
 * ONE place that decides how every report prints / saves as PDF (2026-09-24).
 *
 *   Cheque Register  -> LEGAL LANDSCAPE (8.5 x 14 in, 2026-09-24)
 *   every other report -> A4 PORTRAIT
 *
 * There is NO landscape default: an unknown or missing report name is A4
 * PORTRAIT.  Page CSS files no longer carry their own global @page rule
 * (Vite bundles every page's CSS into one file, so one report's @page used to
 * leak into every other report).  Instead the active report's rule is
 * injected as <style id="report-print-page"> while that report is on screen
 * (see useReportPrintPage.js) and inside the PDF document the grid toolbar
 * builds (see DataGrid.jsx).
 *
 * PDF = the browser's "Save as PDF" print destination.  No PDF library is
 * bundled; the PDF and Print buttons print the SAME rows the screen shows —
 * nothing here queries the server.
 *
 * This file is plain JavaScript with no imports so it can be unit-tested
 * under Node (backend/scripts/testReportPdfLayout.js).
 */

export const PDF_PAGE_SIZE = "A4";

/* Paper sizes in mm (width x height, portrait). */
export const PAPER_SIZES_MM = Object.freeze({
  A4: { width: 210, height: 297 },
  legal: { width: 215.9, height: 355.6 },
});
export const DEFAULT_REPORT_ORIENTATION = "portrait";
export const REPORT_PRINT_STYLE_ID = "report-print-page";

/*
 * printScale: reports whose print layout was designed for the landscape page
 * are scaled by the ratio of the portrait to the landscape printable width
 * (190 mm / 277 mm ~= 0.68), so the same layout fits the portrait page
 * instead of being clipped on the right.  1 = unchanged.
 */
const PORTRAIT_FIT = 0.68;

export const REPORT_PDF_CONFIG = Object.freeze({
  chequeRegister: { title: "Cheque Register", pageSize: "legal", orientation: "landscape", margin: "10mm", printScale: 1 },
  bankCopy: { title: "Bank Copy", orientation: "portrait", margin: "10mm", printScale: 1 },
  salaryRegister: { title: "Salary Register", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  salaryRegisterDetail: { title: "Salary Details", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  sectionSummary: { title: "Section Summary", orientation: "portrait", margin: "12mm", printScale: 1 },
  gpfSummary: { title: "GPF Summary", orientation: "portrait", margin: "12mm", printScale: 1 },
  instituteWiseGpfSummary: { title: "Institute Wise GPF Summary", orientation: "portrait", margin: "12mm", printScale: PORTRAIT_FIT },
  npsSummary: { title: "NPS Summary", orientation: "portrait", margin: "12mm", printScale: 1 },
  npsInstituteWiseSummary: { title: "NPS Institute Wise Summary", orientation: "portrait", margin: "12mm", printScale: PORTRAIT_FIT },
  npsGpfDeduction: { title: "NPS GPF Deduction Report", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  npsScheduleSummary: { title: "NPS Schedule Summary", orientation: "portrait", margin: "10mm", printScale: 1 },
  employeeWiseSalary: { title: "Employee Wise Salary", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  employeePaySlip: { title: "Employee Pay Slip", orientation: "portrait", margin: "12mm", printScale: 1 },
  incomeTaxProfessionalTax: { title: "Income Tax & Professional Tax", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  employeeReport: { title: "Employee Report", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  instituteWiseSalary: { title: "Institute Wise Salary", orientation: "portrait", margin: "10mm", printScale: PORTRAIT_FIT },
  monthWiseEmployeeSalary: { title: "Month-Wise Employee Salary Report", orientation: "portrait", margin: "8mm", printScale: PORTRAIT_FIT },
  finalSalaryBill: { title: "Final Salary Bill", orientation: "portrait", margin: "12mm 10mm 16mm 10mm", printScale: PORTRAIT_FIT },
  salaryVariationReport: { title: "Salary Variation Report", orientation: "portrait", margin: "8mm", printScale: PORTRAIT_FIT },
  salaryEntryVariationReport: { title: "Variation Report", orientation: "portrait", margin: "10mm", printScale: 1 },
  salaryEntry: { title: "Salary Entry", orientation: "portrait", margin: "10mm", printScale: 1 },
  accountOfficerBills: { title: "Salary Bill Approval", orientation: "portrait", margin: "10mm", printScale: 1 },
});

/* Printable width in CSS px (96 px per inch) for a given orientation and margin. */
const MM_TO_PX = 96 / 25.4;
function horizontalMarginMm(margin) {
  const parts = String(margin || "10mm").trim().split(/\s+/).map((p) => parseFloat(p) || 0);
  if (parts.length === 1) return parts[0] * 2;
  if (parts.length === 2 || parts.length === 3) return parts[1] * 2;
  return parts[1] + parts[3];
}

export function getReportPdfOptions(reportName) {
  const key = String(reportName || "");
  const config = Object.prototype.hasOwnProperty.call(REPORT_PDF_CONFIG, key)
    ? REPORT_PDF_CONFIG[key]
    : null;
  const orientation = config?.orientation === "landscape" ? "landscape" : DEFAULT_REPORT_ORIENTATION;
  const margin = config?.margin || "10mm";
  const pageSize = config?.pageSize && PAPER_SIZES_MM[config.pageSize] ? config.pageSize : PDF_PAGE_SIZE;
  const paper = PAPER_SIZES_MM[pageSize];
  const pageWidthMm = orientation === "landscape" ? paper.height : paper.width;
  const printableWidthPx = Math.floor((pageWidthMm - horizontalMarginMm(margin)) * MM_TO_PX);
  const scale = Number(config?.printScale);
  return {
    reportName: key,
    known: Boolean(config),
    title: config?.title || "",
    pageSize,
    orientation,
    margin,
    printScale: scale > 0 && scale <= 1 ? scale : 1,
    printableWidthPx,
  };
}

/* The @page rule for a report, with a page number where the browser supports margin boxes. */
export function reportPageRuleCss(reportName) {
  const o = getReportPdfOptions(reportName);
  return (
    `@page { size: ${o.pageSize} ${o.orientation}; margin: ${o.margin};` +
    ` @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; } }`
  );
}

/*
 * CSS injected while a report is on screen.  Everything besides @page is
 * scoped to html[data-print-report="<name>"], so it can never touch another
 * report.
 */
export function reportPrintStyleCss(reportName) {
  const o = getReportPdfOptions(reportName);
  let css = reportPageRuleCss(reportName);
  if (o.printScale !== 1) {
    css +=
      `\n@media print { html[data-print-report="${o.reportName}"] body { zoom: ${o.printScale}; } }`;
  }
  return css;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NUMERIC_CELL = /^-?(?:₹\s*)?[\d,]+(?:\.\d+)?$/;
const TOTAL_LABEL = /^(?:grand\s+)?total$/i;

export function formatIndianMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isTotalRow(row) {
  const first = row.find((cell) => String(cell ?? "").trim() !== "");
  return TOTAL_LABEL.test(String(first ?? "").trim());
}

/*
 * The full HTML document the PDF / Print button prints.  header/body/footer
 * are the SAME cell strings the screen grid exports (DataGrid exportRows);
 * this function only lays them out.
 */
export function buildReportPrintHtml({
  reportName,
  title,
  subtitle,
  header = [],
  body = [],
  footer = [],
  printedOn,
}) {
  const o = getReportPdfOptions(reportName);
  const heading = title || o.title || "Report";
  const subLines = (Array.isArray(subtitle) ? subtitle : [subtitle])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
  const cols = header.length;
  const fontPx = cols > 20 ? 7 : cols > 14 ? 8 : cols > 8 ? 9 : 10;
  const cell = (value) => {
    const text = String(value ?? "");
    const cls = NUMERIC_CELL.test(text.trim()) ? ' class="num"' : "";
    return `<td${cls}>${esc(text)}</td>`;
  };
  const rowHtml = (row, forceTotal) =>
    `<tr${forceTotal || isTotalRow(row) ? ' class="rp-total"' : ""}>${row.map(cell).join("")}</tr>`;
  const bodyHtml = body.length
    ? body.map((row) => rowHtml(row, false)).join("")
    : `<tr><td colspan="${Math.max(cols, 1)}" class="rp-empty">No records.</td></tr>`;
  const footHtml = footer.map((row) => rowHtml(row, true)).join("");
  const stamp = printedOn || "";

  return `<!doctype html>
<html data-print-report="${esc(o.reportName)}" data-print-orientation="${o.orientation}">
<head>
<meta charset="utf-8">
<title>${esc(heading)}</title>
<style>
${reportPageRuleCss(reportName)}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; font-size: ${fontPx}px; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.rp-head { text-align: center; margin: 0 0 6px; }
.rp-head h1 { font-size: ${fontPx + 5}px; margin: 0 0 2px; text-transform: uppercase; }
.rp-sub { font-size: ${fontPx + 1}px; margin: 1px 0; }
.rp-meta { font-size: ${Math.max(fontPx - 1, 7)}px; text-align: right; margin: 0 0 4px; }
table { border-collapse: collapse; width: 100%; table-layout: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #333; padding: 0.2em 0.3em; vertical-align: top; overflow-wrap: break-word; }
th { background: #e5e9f0; font-weight: bold; text-align: center; }
td.num { text-align: right; white-space: nowrap; }
tr.rp-total td { font-weight: bold; background: #f1f3f6; }
td.rp-empty { text-align: center; padding: 8px; }
</style>
</head>
<body>
<div class="rp-head">
<h1>${esc(heading)}</h1>
${subLines.map((line) => `<div class="rp-sub">${esc(line)}</div>`).join("\n")}
</div>
${stamp ? `<div class="rp-meta">Printed on ${esc(stamp)}</div>` : ""}
<table>
<thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${bodyHtml}${footHtml}</tbody>
</table>
</body>
</html>`;
}
