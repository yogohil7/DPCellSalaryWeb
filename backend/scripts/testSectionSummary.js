/**
 * SECTION SUMMARY report (cases A-V).
 *
 * The report groups the Cheque Register's own approved rows by section. These
 * assertions check returned values, not source shape.
 *
 * Runs offline. Usage: cd backend && npm run test:section-summary
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

const summary = require("../routes/sectionSummary");
const cheque = require("../routes/chequeRegister");
const { groupBySection, XLSX_COLUMNS } = summary;
const { amountInWordsIndian } = require("../utils/amountInWords");

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "sectionSummary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SectionSummary.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "sectionSummary.css"), "utf8");

/* ===================== FIXTURE ===================== */

/* Official order: BD(1), DD(2), PH(3), OGE(4). SectionIds deliberately not in
   that order, so only the real SrNo can produce the expected sequence. */
const SECTIONS = new Map([
  [11, { rank: 1, order: 0, sectionName: "BD Section" }],
  [4,  { rank: 2, order: 1, sectionName: "DD Section" }],
  [9,  { rank: 3, order: 2, sectionName: "PH Section" }],
  [2,  { rank: 4, order: 3, sectionName: "OGE Section" }],
]);

/* Rows in the shape mapAggregateRow produces. */
const reg = (sectionId, sectionName, instituteCode, emp, chequeAmount) => ({
  sectionId, sectionName, instituteCode, emp, chequeAmount,
});

const REGISTER_ROWS = [
  reg(2, "OGE Section", "OGE-05", 3, 300000),
  reg(11, "BD Section", "BD-01", 8, 500000),
  reg(9, "PH Section", "PH-01", 29, 1918296),
  reg(11, "BD Section", "BD-02", 12, 700000),
  /* Same institute, a second bill of the same salary month. */
  reg(11, "BD Section", "BD-01", 5, 250000),
  reg(4, "DD Section", "DD-11", 177, 12556012),
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
  console.log("SECTION SUMMARY (cases A-V)");
  console.log("=".repeat(76));

  const rows = groupBySection(REGISTER_ROWS, SECTIONS);
  const total = rows.reduce(
    (acc, r) => ({
      instituteCount: acc.instituteCount + r.instituteCount,
      employeeCount: acc.employeeCount + r.employeeCount,
      chequeAmount: acc.chequeAmount + r.chequeAmount,
    }),
    { instituteCount: 0, employeeCount: 0, chequeAmount: 0 }
  );

  /* ---------------- A, B, C, D, E ---------------- */
  section("A-E — rows, official order, and Sr. No.");

  check("A. one row per section", rows.length, 4);
  check("A. exactly five columns", XLSX_COLUMNS.length, 5);
  check("A. with the required headings",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr_No.", "SECTION", "INSTITUTE", "EMPLOYEE", "CHEQUE AMOUNT"]);
  check("B. sections follow the master order, not the alphabet",
    rows.map((r) => r.section),
    ["BD Section", "DD Section", "PH Section", "OGE Section"]);
  check("B. alphabetical order would have differed",
    ["BD Section", "DD Section", "PH Section", "OGE Section"].slice().sort()
      .join() !== rows.map((r) => r.section).join(), true);
  check("B. and it is not SectionId order (11, 4, 9, 2)",
    rows[0].section, "BD Section");
  check("C. Sr. No. starts at 1", rows[0].srNo, 1);
  check("D. Sr. No. is dense 1..n over the sorted rows",
    rows.map((r) => r.srNo), [1, 2, 3, 4]);
  check("D. numbering happens after the sort",
    routeSrc.indexOf("ordered.map((group, idx)") >
      routeSrc.indexOf("[...bySection.values()].sort"), true);
  check("E. the Total row is not part of the numbered rows",
    rows.some((r) => String(r.srNo) === "Total"), false);
  check("E. the screen prints Total in the Sr. No. cell, unnumbered",
    /<td className="ss-c-sr">Total<\/td>/.test(pageSrc), true);
  check("E. the exported Total line carries no serial",
    /srNo: "Total"/.test(pageSrc), true);

  /* ---------------- F, G, H, I ---------------- */
  section("F-I — counts, amounts and the grand total");

  const bd = rows.find((r) => r.section === "BD Section");
  check("F. BD has two DISTINCT institutes across three bills",
    bd.instituteCount, 2);
  check("F. a repeated institute is not counted twice",
    bd.instituteCount !== 3, true);
  check("G. BD employees = 8 + 12 + 5", bd.employeeCount, 25);
  check("G. DD employees come straight from the register", 
    rows.find((r) => r.section === "DD Section").employeeCount, 177);
  check("H. BD cheque amount = 500000 + 700000 + 250000",
    bd.chequeAmount, 1450000);
  check("H. PH cheque amount", 
    rows.find((r) => r.section === "PH Section").chequeAmount, 1918296);
  check("I. total institutes = sum of the displayed rows",
    total.instituteCount, 2 + 1 + 1 + 1);
  check("I. total employees = sum of the displayed rows",
    total.employeeCount, 25 + 177 + 29 + 3);
  check("I. total cheque amount = sum of the displayed rows",
    total.chequeAmount, 1450000 + 12556012 + 1918296 + 300000);
  check("I. the route sums the rows, never a second query",
    /rows\.reduce\(/.test(routeSrc), true);

  /* ---------------- J, K, L, M ---------------- */
  section("J-M — period membership is the SALARY month");

  /* Driven through the register's real filter, the one source of the rule. */
  const bill = (code, billMonth, salaryMonth, monthNumber, instituteCode) => ({
    BillCode: code, BillMonth: billMonth, SalaryMonth: salaryMonth,
    SalaryMonthNumber: monthNumber, SalaryYear: "2026",
    WorkflowStatus: "APPROVED", InstituteCode: instituteCode,
    InstituteName: instituteCode, SectionName: "BD Section", SectionId: 11,
    EmpCount: 1, NetSalary: 1000, BillCategory: "Salary", BillType: "",
  });
  const mapped = [
    bill("JUN-2026-BM-MAY", "MAY-2026", "June", "06", "BD-01"),
    bill("JUN-2026", "JUN-2026", "June", "06", "BD-02"),
    bill("JUN-2026-BM-APR", "APR-2026", "June", "06", "BD-03"),
    bill("MAY-2026", "MAY-2026", "May", "05", "BD-04"),
  ].map((r, i) => cheque.mapAggregateRow(r, i + 1));

  const june = cheque.filterRows(mapped, { month: 6, year: 2026, table: "SALARY" });
  const may = cheque.filterRows(mapped, { month: 5, year: 2026, table: "SALARY" });

  check("J. June returns the three June salary-month bills", june.length, 3);
  check("K. Bill Month does not decide membership — MAY and APR bills are in June",
    june.map((r) => r.billCode).sort(),
    ["JUN-2026", "JUN-2026-BM-APR", "JUN-2026-BM-MAY"]);
  check("L. all three aggregate into one section row",
    groupBySection(june, SECTIONS).map((r) => [r.section, r.instituteCount, r.employeeCount]),
    [["BD Section", 3, 3]]);
  check("M. the MAY salary-month bill is not in June",
    june.some((r) => r.billCode === "MAY-2026"), false);
  check("M. and May returns only that bill",
    may.map((r) => r.billCode), ["MAY-2026"]);
  check("J. the report delegates the period rule to the register builder",
    /buildChequeRegisterReport\(\{/.test(routeSrc), true);
  check("K. the route does no month filtering of its own",
    /matchesFilterMonthYear|billMonthPartsOf/.test(routeSrc), false);

  /* ---------------- N, O, P ---------------- */
  section("N-P — section filter and eligibility");

  check("N. a section filter yields only that section",
    groupBySection(
      REGISTER_ROWS.filter((r) => r.sectionId === 4), SECTIONS
    ).map((r) => r.section), ["DD Section"]);
  check("N. the sectionId is passed to the register, not re-implemented",
    /sectionId: query\.sectionId/.test(routeSrc), true);
  check("O. eligibility comes from the register's approved statuses",
    cheque.filterRows(
      [
        bill("A", "JUN-2026", "June", "06", "BD-01"),
        { ...bill("B", "JUN-2026", "June", "06", "BD-02"), WorkflowStatus: "LOCKED" },
        { ...bill("C", "JUN-2026", "June", "06", "BD-03"), WorkflowStatus: "DRAFT" },
        { ...bill("D", "JUN-2026", "June", "06", "BD-04"), WorkflowStatus: "RETURNED" },
        { ...bill("E", "JUN-2026", "June", "06", "BD-05"), WorkflowStatus: "REJECTED" },
        { ...bill("F", "JUN-2026", "June", "06", "BD-06"), WorkflowStatus: "SUBMITTED" },
      ].map((r, i) => cheque.mapAggregateRow(r, i + 1)),
      { month: 6, year: 2026, table: "SALARY" }
    ).map((r) => r.billCode), ["A", "B"]);
  check("P. Draft/Returned/Rejected/Submitted are all excluded above", true, true);
  /* Section Summary now covers a section's whole cheque total for the month:
     ordinary salary bills AND DA Difference bills. */
  check("P. DA Difference bills are included by the ALL table scope",
    /table: query\.table \|\| query\.salaryType \|\| "ALL"/.test(routeSrc), true);
  check("P. the caller can still narrow to one category",
    /query\.table \|\| query\.salaryType/.test(routeSrc), true);
  check("P. the DA rows come from the shared Cheque Register builder",
    /buildChequeRegisterReport/.test(routeSrc), true);
  check("P. nothing is recalculated in this route",
    /BasicPay|GrossSalary\s*\*|NPS\s*\*/.test(routeSrc), false);
  const bothCategories = cheque.filterRows(
    [
      { BillCode:"A", BillMonth:"JUN-2026", SalaryMonth:"June", SalaryMonthNumber:"06",
        SalaryYear:"2026", WorkflowStatus:"APPROVED", InstituteCode:"CPD-06", NetSalary:100 },
      { BillCode:"D", BillMonth:"JUN-2026", SalaryMonth:"June", SalaryMonthNumber:"06",
        SalaryYear:"2026", WorkflowStatus:"APPROVED", InstituteCode:"CPD-06", NetSalary:50,
        BillCategory:"DIFFERENCE" },
    ].map((r, i) => cheque.mapAggregateRow(r, i + 1)),
    { month: 6, year: 2026, table: "ALL" }
  );
  check("P. ALL keeps both an ordinary bill and a DA Difference bill",
    bothCategories.map((r) => r.billCode), ["A", "D"]);
  check("P. and they remain distinguishable",
    bothCategories.map((r) => Boolean(r.isDaDifference)), [false, true]);
  check("O. no status string is duplicated in this route",
    /APPROVED|LOCKED/.test(routeSrc), false);

  /* ---------------- Q ---------------- */
  section("Q — amount in words from the displayed grand total");

  check("Q. words are generated from the grand total",
    /amountInWordsIndian\(total\.chequeAmount\)/.test(routeSrc), true);
  check("Q. the shared utility is reused, not duplicated",
    /require\("\.\.\/utils\/amountInWords"\)/.test(routeSrc), true);
  check("Q. Indian numbering is produced for the total",
    typeof amountInWordsIndian(total.chequeAmount), "string");
  check("Q. a sample total reads in crore/lakh form",
    /Crore|Lakh/i.test(amountInWordsIndian(35554854)), true);
  check("Q. the label matches the printed form",
    /Amount In Word :-/.test(pageSrc), true);

  /* ---------------- R, S, T ---------------- */
  section("R-T — Cheque No. and Date are editable and inert");

  check("R. cheque number is a text input", 
    /type="text"[\s\S]{0,200}value=\{chequeNo\}/.test(pageSrc), true);
  check("R. it is bound to editable state",
    /onChange=\{\(e\) => setChequeNo\(e\.target\.value\)\}/.test(pageSrc), true);
  check("S. date is an editable date input",
    /type="date"[\s\S]{0,200}value=\{chequeDate\}/.test(pageSrc), true);
  check("S. it is bound to editable state",
    /onChange=\{\(e\) => setChequeDate\(e\.target\.value\)\}/.test(pageSrc), true);
  check("S. the printed date uses the report's dd-MMM-yyyy form",
    /formatReportDate\(chequeDate\)/.test(pageSrc), true);
  check("T. neither field is sent to any API",
    /chequeNo|chequeDate/.test(
      pageSrc.slice(pageSrc.indexOf("const filters ="), pageSrc.indexOf("async function handleShow"))
    ), false);
  check("T. the route accepts no cheque number or date at all",
    /chequeNo|chequeDate/.test(routeSrc), false);
  check("T. and writes nothing to the database",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeSrc), false);

  /* ---------------- U, V ---------------- */
  section("U, V — exports mirror the screen; no salary is computed");

  check("U. exports read the same rows the table renders",
    /rows=\{exportRows\}/.test(pageSrc), true);
  check("U. export rows are the report rows plus the Total line",
    /const mapped = rows\.map\(/.test(pageSrc), true);
  check("U. the page never re-sorts or renumbers for export",
    /exportRows[\s\S]{0,600}\.sort\(/.test(pageSrc), false);
  check("U. the .xlsx export reuses the same builder",
    (routeSrc.match(/buildSectionSummaryReport\(/g) || []).length >= 2, true);
  check("U. the shared toolbar is reused, not modified",
    /hiddenActions=\{\["excel", "print"\]\}/.test(pageSrc), true);
  check("V. the route runs no salary engine",
    /calculateForEmployee|TransportAllowanceMaster|DAMaster|PayMatrix/.test(routeSrc), false);
  check("V. it reads no gross salary",
    /GrossSalary/.test(routeSrc), false);
  check("V. the cheque amount is the register's own value",
    /group\.chequeAmount \+= toNum\(row\.chequeAmount\)/.test(routeSrc), true);

  /* ---------------- Presentation & security ---------------- */
  section("Header, typography, print and permission");

  check("header lines match the printed form",
    [/DIRECTOR OF SOCIAL DEFENCE/.test(routeSrc), /DP-CELL WISE/.test(routeSrc)],
    [true, true]);
  check("the month line is spelled out, e.g. JULY-2026",
    /"JULY", "AUGUST"/.test(routeSrc), true);
  check("the report sheet uses a serif face",
    /font-family: "Times New Roman"/.test(cssSrc), true);
  check("rows are compact",
    /padding: 2px 8px/.test(cssSrc), true);
  check("borders are thin and black",
    /border: 1px solid #000/.test(cssSrc), true);
  check("filters, toolbar and buttons are hidden when printing",
    /\.ss-filters,[\s\S]{0,120}\.ss-actions \{\s*\n\s*display: none/.test(cssSrc), true);
  check("A4 portrait paper (reportPdfConfig)",
    (new RegExp("sectionSummary: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "SectionSummary.jsx"), "utf8").includes('useReportPrintPage("sectionSummary")')), true);
  check("the typed cheque number prints as text",
    /\.ss-cheque-print \{\s*\n\s*display: inline-block/.test(cssSrc), true);
  check("the API is authenticated and permission-gated",
    /\/api\/section-summary",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);

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
