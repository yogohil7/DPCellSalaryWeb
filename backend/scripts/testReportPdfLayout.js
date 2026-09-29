/**
 * PDF / PRINT LAYOUT — regression tests (2026-09-24).
 *
 *   Cheque Register = A4 LANDSCAPE, every other report = A4 PORTRAIT,
 *   one shared config (frontend/src/utils/reportPdfConfig.js), no global
 *   landscape default, no report's @page leaking into another, every visible
 *   PDF button wired, same rows as the screen (no second query).
 *
 * Static + unit checks only; touches no database.
 * Usage: cd backend && npm run test:report-pdf-layout
 */
const fs = require("fs");
const path = require("path");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const PAGES = path.join(FRONT, "pages");
const read = (p) => fs.readFileSync(p, "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? `  -> ${detail}` : ""}`); }
}

/* page file -> report key it must use */
const REPORT_PAGES = {
  ChequeRegister: "chequeRegister",
  BankCopy: "bankCopy",
  SalaryRegister: "salaryRegister",
  SalaryRegisterDetail: "salaryRegisterDetail",
  SectionSummary: "sectionSummary",
  GpfSummary: "gpfSummary",
  InstituteWiseGpfSummary: "instituteWiseGpfSummary",
  NpsSummary: "npsSummary",
  NpsInstituteWiseSummary: "npsInstituteWiseSummary",
  NpsGpfDeduction: "npsGpfDeduction",
  NpsScheduleSummary: "npsScheduleSummary",
  EmployeeWiseSalary: "employeeWiseSalary",
  EmployeePaySlip: "employeePaySlip",
  IncomeTaxProfessionalTax: "incomeTaxProfessionalTax",
  EmployeeReport: "employeeReport",
  InstituteWiseSalary: "instituteWiseSalary",
  MonthWiseEmployeeSalary: "monthWiseEmployeeSalary",
  FinalSalaryBill: "finalSalaryBill",
  SalaryVariationReport: "salaryVariationReport",
  SalaryEntryVariationReport: "salaryEntryVariationReport",
  SalaryEntry: "salaryEntry",
  AccountOfficerBills: "accountOfficerBills",
};

(async () => {
  const cfgSrc = read(path.join(FRONT, "utils", "reportPdfConfig.js"));
  const cfg = await import("data:text/javascript;base64," + Buffer.from(cfgSrc).toString("base64"));
  const { REPORT_PDF_CONFIG, getReportPdfOptions, reportPageRuleCss, reportPrintStyleCss, buildReportPrintHtml, formatIndianMoney } = cfg;

  console.log("TEST 1 - Cheque Register is LEGAL LANDSCAPE");
  const cr = getReportPdfOptions("chequeRegister");
  check("chequeRegister orientation landscape", cr.orientation === "landscape");
  check("chequeRegister page size legal", cr.pageSize === "legal");
  check("chequeRegister @page rule", /size: legal landscape/.test(reportPageRuleCss("chequeRegister")));
  check("chequeRegister printable width = 14in - 20mm", cr.printableWidthPx === Math.floor((355.6 - 20) * 96 / 25.4), cr.printableWidthPx);
  check("no other report uses legal", Object.keys(REPORT_PDF_CONFIG).filter((k) => getReportPdfOptions(k).pageSize !== "A4").join() === "chequeRegister");

  console.log("TEST 2 - every other report is A4 PORTRAIT");
  for (const key of Object.values(REPORT_PAGES).filter((k) => k !== "chequeRegister")) {
    const o = getReportPdfOptions(key);
    check(`${key} -> A4 portrait`, o.known && o.orientation === "portrait" && o.pageSize === "A4"
      && /size: A4 portrait/.test(reportPageRuleCss(key)), JSON.stringify(o));
  }

  console.log("TEST 3 - no landscape default");
  for (const name of ["", undefined, null, "unknownReport", "toString", "__proto__"]) {
    check(`getReportPdfOptions(${JSON.stringify(name)}) is portrait`, getReportPdfOptions(name).orientation === "portrait");
  }
  check("DEFAULT_REPORT_ORIENTATION is portrait", cfg.DEFAULT_REPORT_ORIENTATION === "portrait");

  console.log("TEST 4 - Cheque Register is the ONLY landscape report");
  const landscape = Object.keys(REPORT_PDF_CONFIG).filter((k) => REPORT_PDF_CONFIG[k].orientation === "landscape");
  check("exactly one landscape entry (chequeRegister)", landscape.length === 1 && landscape[0] === "chequeRegister", landscape.join(","));
  const allSrc = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(css|jsx?|html)$/.test(f)) allSrc.push(p);
    }
  })(FRONT);
  const landscapeFiles = allSrc.filter((p) => !p.endsWith("reportPdfConfig.js") && /size\s*:\s*[^;]*landscape/.test(read(p)));
  check("no other source file sets a landscape page size", landscapeFiles.length === 0, landscapeFiles.join(", "));

  console.log("TEST 5 - no global @page rule in any stylesheet");
  const cssWithPage = allSrc.filter((p) => p.endsWith(".css") && /@page\s*\{/.test(read(p)));
  check("no .css file declares @page", cssWithPage.length === 0, cssWithPage.map((p) => path.basename(p)).join(", "));

  console.log("TEST 6 - injected print CSS is report-scoped");
  for (const key of Object.keys(REPORT_PDF_CONFIG)) {
    const css = reportPrintStyleCss(key).replace(/@page\s*\{[^{}]*\{[^{}]*\}[^{}]*\}/g, "");
    const scoped = css.split("\n").filter((l) => l.trim()).every((l) => l.includes(`html[data-print-report="${key}"]`));
    check(`${key}: every non-@page rule is scoped to its own report`, scoped, css);
  }
  const hook = read(path.join(FRONT, "utils", "useReportPrintPage.js"));
  check("hook removes the rule on unmount / restores previous report", /active\.splice\(index, 1\)/.test(hook) && /el\.remove\(\)/.test(hook));

  console.log("TEST 7 - every report page registers its own orientation");
  for (const [file, key] of Object.entries(REPORT_PAGES)) {
    const src = read(path.join(PAGES, `${file}.jsx`));
    check(`${file}: useReportPrintPage("${key}")`, src.includes(`useReportPrintPage("${key}")`));
    const other = (src.match(/useReportPrintPage\("([^"]+)"\)/g) || []).filter((m) => !m.includes(`"${key}"`));
    check(`${file}: no other report's name`, other.length === 0, other.join(","));
  }

  console.log("TEST 8 - page Print buttons use the report's own page setup");
  for (const [file, key] of Object.entries(REPORT_PAGES)) {
    const src = read(path.join(PAGES, `${file}.jsx`));
    check(`${file}: no bare window.print()`, !/window\.print\(\)/.test(src));
    const calls = src.match(/printReport\("([^"]+)"\)/g) || [];
    check(`${file}: printReport uses "${key}"`, calls.length > 0 && calls.every((c) => c.includes(`"${key}"`)), calls.join(","));
  }

  console.log("TEST 9 - PDF / Print toolbar buttons actually print");
  const grid = read(path.join(FRONT, "components", "DataGrid.jsx"));
  check("printGrid no longer uses window.open(..., noopener) (returned null -> dead button)", !/window\.open\(/.test(grid));
  check("printGrid prints through an iframe", /createElement\("iframe"\)/.test(grid) && /win\.print\(\)/.test(grid));
  check("PDF button present and calls runExport(\"pdf\")", /runExport\("pdf"\)/.test(grid));
  check("print frame is cleaned up", /frame\.remove\(\)/.test(grid));
  check("wide grids are fitted, never clipped", /printableWidthPx/.test(grid) && /scrollWidth/.test(grid));

  console.log("TEST 10 - every visible PDF button is wired to its report");
  for (const [file, key] of Object.entries(REPORT_PAGES)) {
    const src = read(path.join(PAGES, `${file}.jsx`));
    const m = src.match(/<GridToolbar[\s\S]*?\/>/);
    if (!m) continue;
    const pdfHidden = /hiddenActions=\{\[[^\]]*"pdf"/.test(m[0]);
    if (pdfHidden) { check(`${file}: PDF button hidden (page prints itself)`, true); continue; }
    check(`${file}: GridToolbar reportName="${key}"`, m[0].includes(`reportName="${key}"`));
    check(`${file}: GridToolbar prints a heading / filter subtitle`, /subtitle=\{/.test(m[0]));
  }

  console.log("TEST 11 - printed document: heading, filters, repeated header, totals");
  const html = buildReportPrintHtml({
    reportName: "chequeRegister",
    title: "Cheque Register",
    subtitle: ["DDRS SECTION", "Bill Month: JUL-2026"],
    header: ["Sr. No.", "Institute", "Net"],
    body: [["1", "A <b>&", "12,34,567.50"], ["TOTAL", "", "12,34,567.50"]],
    footer: [["TOTAL", "", "99.00"]],
    printedOn: "24/09/2026",
  });
  check("Legal landscape @page inside the document", /@page \{ size: legal landscape;/.test(html));
  check("thead repeats on every page", /thead \{ display: table-header-group; \}/.test(html));
  check("rows never split across pages", /tr \{ break-inside: avoid; page-break-inside: avoid; \}/.test(html));
  check("title and filter lines printed", html.includes("<h1>Cheque Register</h1>") && html.includes("Bill Month: JUL-2026") && html.includes("DDRS SECTION"));
  check("TOTAL row from the data marked as total", /<tr class="rp-total"><td>TOTAL<\/td>/.test(html));
  check("footer totals printed", html.includes("99.00"));
  check("cell text escaped", html.includes("A &lt;b&gt;&amp;"));
  check("amounts right-aligned", html.includes('<td class="num">12,34,567.50</td>'));
  const portraitHtml = buildReportPrintHtml({ reportName: "bankCopy", header: ["A"], body: [] });
  check("Bank Copy document is A4 portrait", /size: A4 portrait/.test(portraitHtml) && !/landscape/.test(portraitHtml));
  check("empty report prints a no-records row, not a blank page", portraitHtml.includes("No records."));

  console.log("TEST 12 - Indian number formatting kept");
  check("formatIndianMoney(1234567.5) = 12,34,567.50", formatIndianMoney(1234567.5) === "12,34,567.50");
  check("already-formatted strings are passed through", formatIndianMoney("12,34,567.50") === "12,34,567.50");
  check("cells are printed exactly as the screen formatted them", html.includes(">12,34,567.50<"));

  console.log("TEST 13 - page numbers");
  check("@page carries Page N of M", /counter\(page\)/.test(reportPageRuleCss("chequeRegister")) && /counter\(pages\)/.test(reportPageRuleCss("salaryRegister")));

  console.log("TEST 14 - PDF uses the same dataset as the screen (no second query)");
  check("DataGrid imports no API / fetch", !/fetch\(|Api"|axios/.test(grid));
  check("reportPdfConfig has no imports or requests", !/^import /m.test(cfgSrc) && !/fetch\(/.test(cfgSrc));
  check("print rows come from the toolbar rows prop (exportRows(printCols, rows))", /exportRows\(printCols, rows\)/.test(grid));
  for (const file of ["ChequeRegister", "BankCopy", "SalaryRegister", "SectionSummary", "GpfSummary", "InstituteWiseGpfSummary", "NpsSummary", "NpsInstituteWiseSummary", "IncomeTaxProfessionalTax", "InstituteWiseSalary"]) {
    const src = read(path.join(PAGES, `${file}.jsx`));
    const m = src.match(/<GridToolbar[\s\S]*?\/>/);
    check(`${file}: toolbar rows = exportRows (the same memo the screen/CSV use, TOTAL included)`, /rows=\{exportRows\}/.test(m[0]));
  }
  const se = read(path.join(PAGES, "SalaryEntry.jsx"));
  check("Salary Entry PDF totals = the table-foot `totals` memo", /footerRows=\{\s*calculatedEmployees\.length\s*\?\s*\[\{ \.\.\.totals/.test(se));
  const ao = read(path.join(PAGES, "AccountOfficerBills.jsx"));
  check("Approval PDF totals = the summary-card values", /grossSalary: selectedBill\.grossAmount/.test(ao) && /netSalary: selectedBill\.netSalary/.test(ao));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
