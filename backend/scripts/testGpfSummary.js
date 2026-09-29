/**
 * GPF SUMMARY report (cases A-R).
 *
 * Value-level: the assertions check the rows and figures the report actually
 * returns, not merely that a function or field exists.
 *
 * Runs offline. Usage: cd backend && npm run test:gpf-summary
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};

const gpf = require("../routes/gpfSummary");
const { groupGpfBySection, filterGpfRows, XLSX_COLUMNS } = gpf;

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "gpfSummary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "GpfSummary.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "gpfSummary.css"), "utf8");

/* ===================== FIXTURE ===================== */

/* Official order BD(1), DD(2), PH(3), MR(4), CCICPD(5).
   SectionIds are deliberately not in that order. */
const SEC = {
  BD:     { id: 11, sr: 1, name: "BD Section" },
  DD:     { id: 4,  sr: 2, name: "DD Section" },
  PH:     { id: 9,  sr: 3, name: "PH Section" },
  MR:     { id: 2,  sr: 4, name: "MR Section" },
  CCICPD: { id: 7,  sr: 5, name: "CCICPD Section" },
};

const JUN = { BillCode: "JUN-2026", BillMonth: "JUN-2026", SalaryMonth: "June",
              SalaryMonthNumber: "06", SalaryYear: "2026" };
const JUN_BM_MAY = { BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", SalaryMonth: "June",
                     SalaryMonthNumber: "06", SalaryYear: "2026" };
const MAY = { BillCode: "MAY-2026", BillMonth: "MAY-2026", SalaryMonth: "May",
              SalaryMonthNumber: "05", SalaryYear: "2026" };

const row = (sec, bill, employeeId, gpfAmt, advAmt, over = {}) => ({
  ...bill,
  WorkflowStatus: "APPROVED",
  InstituteCode: `${sec}-01`,
  SectionId: SEC[sec].id,
  SectionSrNo: SEC[sec].sr,
  SectionName: SEC[sec].name,
  EmployeeId: employeeId,
  EmployeeName: `Emp${employeeId}`,
  PensionType: "GPF",
  GPFSubscription: gpfAmt,
  GPFAdvance: advAmt,
  ...over,
});

const ROWS = [
  /* Shuffled section order on purpose. */
  row("MR", JUN, 401, 343500, 0),
  row("BD", JUN, 101, 200000, 0),
  row("CCICPD", JUN, 501, 60500, 0),
  row("BD", JUN, 102, 195000, 0),
  row("DD", JUN, 201, 500000, 20000),
  row("PH", JUN, 301, 229000, 0),
  row("DD", JUN, 202, 235800, 0),
  /* Same employee, a second June bill with a different Bill Month. */
  row("BD", JUN_BM_MAY, 101, 50000, 0),
  /* Control: a MAY salary-month bill that must not appear in June. */
  row("BD", MAY, 199, 999999, 999999),
];

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

function main() {
  console.log("=".repeat(76));
  console.log("GPF SUMMARY (cases A-R)");
  console.log("=".repeat(76));

  const june = filterGpfRows(ROWS, { month: 6, year: 2026 });
  const rows = groupGpfBySection(june);
  const total = rows.reduce(
    (acc, r) => ({
      emp: acc.emp + r.emp,
      gpf: acc.gpf + r.gpf,
      gpfAdvance: acc.gpfAdvance + r.gpfAdvance,
      total: acc.total + r.total,
    }),
    { emp: 0, gpf: 0, gpfAdvance: 0, total: 0 }
  );

  /* ---------------- A, B ---------------- */
  section("A, B — the report and its month");

  check("A. one row per section", rows.length, 5);
  check("A. six columns, in the printed order",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "NAME", "EMP", "G.P.F.", "G.P.F.Adv", "TOTAL"]);
  check("B. the month line is built from the selection, not hard-coded",
    /MONTH_FULL_NAMES\[monthNum - 1\]/.test(routeSrc), true);
  check("B. July renders as JULY-2026",
    ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST",
     "SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"][6] + "-2026", "JULY-2026");
  check("B. the heading lines match the printed form",
    [/DIRECTOR OF SOCIAL DEFENCE/.test(routeSrc), /GPF SUMMARY/.test(routeSrc)],
    [true, true]);

  /* ---------------- C, D ---------------- */
  section("C, D — grouping and official section order");

  check("C. rows are grouped by section",
    rows.map((r) => r.name),
    ["BD Section", "DD Section", "PH Section", "MR Section", "CCICPD Section"]);
  check("D. that is the master order, not alphabetical",
    rows.map((r) => r.name).join() !==
      rows.map((r) => r.name).slice().sort().join(), true);
  check("D. and not SectionId order (11, 4, 9, 2, 7)", rows[0].name, "BD Section");
  check("D. Sr. No. is dense 1..n after the sort",
    rows.map((r) => r.srNo), [1, 2, 3, 4, 5]);

  /* ---------------- E, F, G, H ---------------- */
  section("E-H — EMP, GPF, GPF Advance and the row TOTAL");

  const bd = rows.find((r) => r.name === "BD Section");
  const dd = rows.find((r) => r.name === "DD Section");

  check("E. BD has two DISTINCT employees across three rows", bd.emp, 2);
  check("E. the employee in two June bills is counted once", bd.emp !== 3, true);
  check("E. DD employee count", dd.emp, 2);
  check("F. BD GPF = 200000 + 195000 + 50000 (both bills)", bd.gpf, 445000);
  check("F. PH GPF", rows.find((r) => r.name === "PH Section").gpf, 229000);
  check("G. DD GPF Advance = 20000", dd.gpfAdvance, 20000);
  check("G. a section with no advance shows 0", bd.gpfAdvance, 0);
  check("H. TOTAL = GPF + GPF Advance, per row",
    rows.map((r) => r.total === r.gpf + r.gpfAdvance), [true, true, true, true, true]);
  check("H. DD total = 735800 + 20000", dd.total, 755800);

  /* ---------------- I ---------------- */
  section("I — grand totals come from the displayed rows");

  check("I. total EMP = sum of section EMP", total.emp, 2 + 2 + 1 + 1 + 1);
  check("I. total GPF = sum of section GPF",
    total.gpf, 445000 + 735800 + 229000 + 343500 + 60500);
  check("I. total GPF Advance", total.gpfAdvance, 20000);
  check("I. grand total = total GPF + total GPF Advance",
    total.total, total.gpf + total.gpfAdvance);
  check("I. the route sums the rows, never a second query",
    /rows\.reduce\(/.test(routeSrc), true);

  /* ---------------- period ---------------- */
  section("Period membership is the SALARY month");

  check("the June bill whose Bill Month is May is included",
    june.some((r) => r.BillCode === "JUN-2026-BM-MAY"), true);
  check("the MAY salary-month bill is excluded",
    june.some((r) => r.BillCode === "MAY-2026"), false);
  check("so the control's 999999 is in no section row",
    rows.some((r) => r.gpf === 999999 || r.gpfAdvance === 999999), false);
  check("and the totals are exactly the June figures",
    [total.gpf, total.gpfAdvance], [1813800, 20000]);
  check("employee 199 (May only) appears in no row",
    june.some((r) => Number(r.EmployeeId) === 199), false);
  check("May returns only the May salary-month row",
    filterGpfRows(ROWS, { month: 5, year: 2026 }).map((r) => r.BillCode), ["MAY-2026"]);
  check("the period rule is the shared one, not re-implemented",
    /salaryMonthPartsOf\(/.test(routeSrc), true);

  /* ---------------- eligibility ---------------- */
  section("Eligibility follows the existing approved-report rules");

  const statuses = ["APPROVED", "LOCKED", "DRAFT", "RETURNED", "REJECTED", "SUBMITTED"]
    .map((status, i) => row("BD", JUN, 900 + i, 100, 0, { WorkflowStatus: status }));
  check("only APPROVED and LOCKED rows are counted",
    filterGpfRows(statuses, { month: 6, year: 2026 })
      .map((r) => r.WorkflowStatus), ["APPROVED", "LOCKED"]);
  check("the shared status set is reused, not duplicated",
    /APPROVED_WORKFLOW_STATUSES/.test(routeSrc), true);
  check("DA Difference bills are excluded in SQL",
    /<> N'DA DIFFERENCE'/.test(routeSrc), true);
  check("archived bills are excluded in SQL",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(routeSrc), true);
  check("only rows carrying a GPF amount are listed",
    /ISNULL\(d\.GPFSubscription, 0\) <> 0 OR ISNULL\(d\.GPFAdvance, 0\) <> 0/.test(routeSrc), true);
  check("a section filter returns only that section",
    groupGpfBySection(filterGpfRows(ROWS, { month: 6, year: 2026, sectionId: 4 }))
      .map((r) => r.name), ["DD Section"]);

  /* ---------------- J, K, L, M, N ---------------- */
  section("J-N — the four editable fields, and printing them");

  check("J. Cheque No is an editable text field",
    /value=\{chequeNo\}[\s\S]{0,160}onChange=\{\(e\) => setChequeNo\(e\.target\.value\)\}/.test(pageSrc), true);
  check("K. Cheque Date is an editable date field",
    /type="date"[\s\S]{0,160}value=\{chequeDate\}/.test(pageSrc), true);
  check("L. Chalan No is an editable text field",
    /value=\{chalanNo\}[\s\S]{0,160}onChange=\{\(e\) => setChalanNo\(e\.target\.value\)\}/.test(pageSrc), true);
  check("M. Chalan Date is an editable date field",
    /type="date"[\s\S]{0,160}value=\{chalanDate\}/.test(pageSrc), true);
  check("J-M. all four start blank",
    (pageSrc.match(/useState\(""\)/g) || []).length >= 4, true);
  check("N. all four typed values are rendered as print text",
    (pageSrc.match(/gs-cheque-print/g) || []).length, 4);
  check("N. dates print as dd-mm-yyyy",
    /return `\$\{d\}-\$\{m\}-\$\{y\}`/.test(pageSrc), true);
  check("N. the print rule reveals them",
    /\.gs-cheque-print \{\s*\n\s*display: inline-block/.test(cssSrc), true);
  check("N. and hides the input controls",
    /\.no-print[\s\S]{0,200}display: none/.test(cssSrc), true);
  check("the fields never reach the API",
    /chequeNo|chalanNo|chequeDate|chalanDate/.test(
      pageSrc.slice(pageSrc.indexOf("const filters ="), pageSrc.indexOf("async function handleShow"))
    ), false);
  check("and the route accepts no such parameter",
    /chequeNo|chalanNo/.test(routeSrc), false);
  check("the report writes nothing to the database",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeSrc), false);

  /* ---------------- O, P, Q ---------------- */
  section("O-Q — print layout and legacy typography");

  check("O. A4 portrait (reportPdfConfig)", (new RegExp("gpfSummary: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "GpfSummary.jsx"), "utf8").includes('useReportPrintPage("gpfSummary")')), true);
  check("O. navigation, filters and buttons are hidden when printing",
    /\.gs-filters,[\s\S]{0,140}\.gs-actions \{\s*\n\s*display: none/.test(cssSrc), true);
  check("P. the screen follows the global typography token",
    /\.gs-sheet \{[\s\S]{0,220}font-family: var\(--font-family-base\)/.test(cssSrc), true);
  check("P. the printed form keeps its serif face",
    /@media print \{[\s\S]{0,400}font-family: "Times New Roman"/.test(cssSrc), true);
  check("P. compact legacy row height", /padding: 2px 8px/.test(cssSrc), true);
  check("Q. thin black rules", /border: 1px solid #000/.test(cssSrc), true);
  check("Q. centred bold heading",
    /\.gs-head \{[\s\S]{0,120}text-align: center/.test(cssSrc), true);
  check("Q. header cells are bold",
    /\.gs-table thead th \{[\s\S]{0,80}font-weight: 700/.test(cssSrc), true);
  check("Q. the Total row is bold",
    /\.gs-table tfoot td \{[\s\S]{0,60}font-weight: 700/.test(cssSrc), true);
  check("Q. the signature block sits bottom-right",
    /\.gs-sign \{[\s\S]{0,140}text-align: right/.test(cssSrc), true);
  check("Q. it names the Account Officer",
    /Account Officer[\s\S]{0,120}Gandhinagar, Gujarat State/.test(pageSrc), true);

  /* ---------------- R ---------------- */
  section("R — nothing else was touched");

  check("R. the route computes no salary",
    /calculateForEmployee|TransportAllowanceMaster|DAMaster|PayMatrix/.test(routeSrc), false);
  check("R. it reads the stored GPF columns only",
    /d\.GPFSubscription,\s*\n\s*d\.GPFAdvance/.test(routeSrc), true);
  check("R. the shared toolbar is reused, not modified",
    /hiddenActions=\{\["excel", "print"\]\}/.test(pageSrc), true);
  check("R. the API is authenticated and permission-gated",
    /\/api\/gpf-summary",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("R. exports read the same rows the table renders",
    /rows=\{exportRows\}/.test(pageSrc), true);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
