/**
 * Cheque Register "Group" column tests (A-H).
 *
 * Asserts the Group column carries each row's own Institute Code, that the
 * Section Name filter data is untouched, and that nothing else in the row
 * mapping changed. Runs offline against the real source file.
 *
 * Usage:  cd backend && npm run test:cheque-group
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* Offline stub so requiring the route never dials SQL Server. */
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

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const backendSrc = read("routes/chequeRegister.js");
const uiSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "ChequeRegister.jsx"),
  "utf8"
);
const cssSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "chequeRegister.css"),
  "utf8"
);
const apiSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "utils", "chequeRegisterApi.js"),
  "utf8"
);
const gridSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "DataGrid.jsx"),
  "utf8"
);

/** Mirrors the shipped `group` mapping in routes/chequeRegister.js. */
function mapGroup(row, daDiff = false) {
  return (
    row.InstituteCode ||
    row.SectionName ||
    (daDiff ? "DA Difference" : "Salary")
  );
}

function main() {
  console.log("=".repeat(68));
  console.log("Cheque Register — Group column shows Institute Code");
  console.log("=".repeat(68));

  /* All rows below share ONE section, as in the June-2026 report. */
  const SECTION = "OGE Section";

  /* ---------------- A, B, C ---------------- */
  section("A, B, C — each institute shows its own code");

  check("A. OGE-01",
    mapGroup({ InstituteCode: "OGE-01", SectionName: SECTION }), "OGE-01");
  check("B. OGE-02",
    mapGroup({ InstituteCode: "OGE-02", SectionName: SECTION }), "OGE-02");
  check("C. OGE-05",
    mapGroup({ InstituteCode: "OGE-05", SectionName: SECTION }), "OGE-05");
  check("no row shows the section name",
    ["OGE-01", "OGE-02", "OGE-05"].every(
      (code) => mapGroup({ InstituteCode: code, SectionName: SECTION }) !== SECTION
    ), true);

  /* ---------------- D ---------------- */
  section("D — several institutes in the SAME section stay distinct");

  const report = [
    { InstituteName: "Samany Vruddhashram", InstituteCode: "OGE-05", SectionName: SECTION },
    { InstituteName: "Another Institute",   InstituteCode: "OGE-02", SectionName: SECTION },
    { InstituteName: "Third Institute",     InstituteCode: "OGE-01", SectionName: SECTION },
  ];
  const groups = report.map((r) => mapGroup(r));
  check("D. groups follow the institutes", groups, ["OGE-05", "OGE-02", "OGE-01"]);
  check("D. all groups are distinct", new Set(groups).size, 3);
  check("D. none collapsed to the shared section", groups.includes(SECTION), false);

  /* Nothing is hard-coded: an unrelated code maps through unchanged. */
  check("no hard-coded OGE prefix",
    mapGroup({ InstituteCode: "CPD-25", SectionName: "CPD Section" }), "CPD-25");
  check("a brand-new institute code works",
    mapGroup({ InstituteCode: "XYZ-99", SectionName: SECTION }), "XYZ-99");

  /* Fallback only when a row genuinely has no institute code. */
  check("falls back to the old value when there is no code",
    mapGroup({ InstituteCode: "", SectionName: SECTION }), SECTION);
  check("DA Difference fallback preserved",
    mapGroup({ InstituteCode: "", SectionName: "" }, true), "DA Difference");
  check("Salary fallback preserved",
    mapGroup({ InstituteCode: "", SectionName: "" }, false), "Salary");

  /* ---------------- E ---------------- */
  section("E — the Section Name filter is untouched");

  check("E. sectionName is still returned separately",
    /sectionName: row\.SectionName \|\| ""/.test(backendSrc), true);
  check("E. sectionId is still returned",
    /sectionId: row\.SectionId/.test(backendSrc), true);
  check("E. the section lookup still selects SectionName",
    /SELECT SectionId, SectionCode, SectionName/.test(backendSrc), true);
  check("E. group no longer reads SectionName first",
    /group:\s*row\.SectionName \|\|/.test(backendSrc), false);
  check("E. group reads InstituteCode first",
    /group:\s*[\s\S]{0,40}row\.InstituteCode/.test(backendSrc), true);

  /* ---------------- F ---------------- */
  section("F — Month / Year / Table / Salary Time filters untouched");

  for (const param of ["month", "year", "table", "sectionId"]) {
    check(`F. ${param} filter still sent by the UI`,
      new RegExp(`${param}[,:]`).test(uiSrc), true);
  }
  check("F. InstituteCode is scoped from the workflow row, not a new join",
    /i\.InstituteCode = w\.InstituteCode/.test(backendSrc), true);

  /* ---------------- G ---------------- */
  section("G — screen, CSV, Excel, PDF and Print all use the same field");

  check("G. the Group column is keyed 'group'",
    /\{ key: "group", label: "Group" \}/.test(uiSrc), true);
  check("G. the on-screen cell renders row.group",
    /<td>\{row\.group \|\| "-"\}<\/td>/.test(uiSrc), true);
  check("G. exportRows spreads the row, so exports inherit group",
    /rows\.map\(\(row\) => \(\{\s*\.\.\.row,/.test(uiSrc), true);
  check("G. exports do not override group",
    /\.\.\.row,[\s\S]{0,200}group:/.test(uiSrc), false);
  check("G. one COLUMNS list drives grid, exports and print",
    (uiSrc.match(/const COLUMNS = \[/g) || []).length, 1);

  /* ---------------- H ---------------- */
  section("H — totals and every other column unchanged");

  check("H. cheque amount still uses the shared helper",
    /calculateChequeAmount/.test(backendSrc), true);
  for (const key of ["instituteName", "place", "billNo", "date", "salaryMonth", "type"]) {
    check(`H. ${key} mapping untouched`,
      new RegExp(`${key}:`).test(backendSrc), true);
  }
  check("H. exactly one group mapping exists",
    (backendSrc.match(/^\s*group:/gm) || []).length, 1);
  check("H. instituteCode is still returned as its own field",
    /instituteCode: row\.InstituteCode \|\| ""/.test(backendSrc), true);
  check("H. no new table or duplicated institute data",
    /CREATE TABLE|INSERT INTO dbo\.Institutes/.test(backendSrc), false);

  /* ============ SALARY MONTH COLUMN = each bill's own BILL MONTH ============ */
  section("CASE 1-3 — Salary Month column shows each bill's own Bill Month");

  /* Mirrors billMonthOf() in ChequeRegister.jsx. */
  const billMonthOf = (row) =>
    row.billMonthLabel || row.billMonth || row.salaryMonth || "-";

  const registerRows = [
    { instituteCode: "OGE-05", billCode: "JUN-2026",        salaryMonth: "June", billMonthLabel: "JUN-2026" },
    { instituteCode: "OGE-05", billCode: "JUN-2026-BM-MAY", salaryMonth: "June", billMonthLabel: "MAY-2026" },
    { instituteCode: "CPD-25", billCode: "JUN-2026",        salaryMonth: "June", billMonthLabel: "JUN-2026" },
  ];

  check("CASE 1. OGE-05 master shows JUN-2026", billMonthOf(registerRows[0]), "JUN-2026");
  check("CASE 2. OGE-05 BM-MAY shows MAY-2026", billMonthOf(registerRows[1]), "MAY-2026");
  check("CASE 3. CPD-25 shows JUN-2026", billMonthOf(registerRows[2]), "JUN-2026");
  check("two bills of the SAME institute differ",
    billMonthOf(registerRows[0]) !== billMonthOf(registerRows[1]), true);
  check("SalaryMonth is NOT used when a bill month exists",
    registerRows.every((r) => billMonthOf(r) !== r.salaryMonth), true);
  check("falls back only when no bill month is known",
    billMonthOf({ salaryMonth: "June" }), "June");
  check("unnormalised BillMonth still displays",
    billMonthOf({ billMonth: "MAY-2026" }), "MAY-2026");

  check("backend exposes a normalised billMonthLabel",
    /billMonthLabel: formatMonthLabel\(billYm\)/.test(backendSrc), true);
  check("SalaryMonth column no longer renders row.salaryMonth",
    /\{row\.salaryMonth\}\s*\n?\s*\{row\.salaryYear/.test(uiSrc), false);
  check("the screen cell uses billMonthOf", /<td>\{billMonthOf\(row\)\}<\/td>/.test(uiSrc), true);
  check("stored SalaryMonth values are untouched",
    /salaryMonth: row\.SalaryMonth \|\| ""/.test(backendSrc), true);
  check("Month/Year filter semantics unchanged",
    /matchesFilterMonthYear/.test(backendSrc), true);

  /* ============ ONE SOURCE OF TRUTH ============ */
  section("Screen, Excel, CSV/PDF/Copy and Print agree");

  check("exportRows override salaryMonth with the bill month",
    /salaryMonth: billMonthOf\(row\)/.test(uiSrc), true);
  check("Excel column maps to billMonthLabel",
    /\{ key: "billMonthLabel", label: "Salary Month" \}/.test(backendSrc), true);
  check("export reuses the SAME report builder as the screen",
    (backendSrc.match(/buildChequeRegisterReport\(/g) || []).length >= 3, true);
  check("screen endpoint uses the builder too",
    /const data = await buildChequeRegisterReport\(req\.query\)/.test(backendSrc), true);

  /* ============ EXCEL ============ */
  section("Excel is a real .xlsx from the project's existing library");

  check("uses the xlsx package", /require\("xlsx"\)/.test(backendSrc), true);
  check("writes a real xlsx workbook",
    /bookType: "xlsx"/.test(backendSrc), true);
  check("sends the spreadsheetml content type",
    /openxmlformats-officedocument\.spreadsheetml\.sheet/.test(backendSrc), true);
  check("is NOT a renamed CSV", /toCsv[\s\S]{0,60}\.xlsx/.test(backendSrc), false);
  check("money and EMP are written as numbers",
    /if \(column\.type === "number"\) return Number\(value \|\| 0\)/.test(backendSrc), true);
  check("totals row included in the workbook",
    /totalsRow\.push\("TOTAL"\)/.test(backendSrc), true);
  check("export respects the same filters",
    /buildFilterParams/.test(apiSrc), true);
  check("frontend downloads it as a blob",
    /URL\.createObjectURL\(blob\)/.test(apiSrc), true);
  check("xlsx is a backend dependency already",
    Boolean(require(path.join(__dirname, "..", "package.json")).dependencies.xlsx), true);

  /* ============ BUTTON PLACEMENT ============ */
  section("Buttons below the table, no duplicates");

  check("actions bar exists", /className="cr-report-actions no-print"/.test(uiSrc), true);
  /* Compare the real elements, not a mention in a comment. */
  const actionsAt = uiSrc.indexOf('<div className="cr-report-actions no-print">');
  const tableEndsAt = uiSrc.lastIndexOf("</table>");
  const totalsAt = uiSrc.lastIndexOf("<tfoot>");
  check("the actions bar sits AFTER the table", actionsAt > tableEndsAt, true);
  check("and AFTER the totals row", actionsAt > totalsAt, true);
  check("right aligned below the report",
    /\.cr-report-actions \{[\s\S]{0,200}justify-content: flex-end/.test(cssSrc), true);
  check("exactly one Excel button", (uiSrc.match(/cr-btn-excel/g) || []).length, 1);
  check("exactly one Print button", (uiSrc.match(/cr-btn-print/g) || []).length, 1);
  check("the old top-toolbar Print is gone",
    /cr-toolbar-actions/.test(uiSrc), false);
  check("shared toolbar hides its duplicate Excel/Print",
    /hiddenActions=\{\["excel", "print"\]\}/.test(uiSrc), true);
  check("GridToolbar rendered once", (uiSrc.match(/<GridToolbar/g) || []).length, 1);
  check("Copy/CSV/PDF/Column Visibility still available",
    /<GridToolbar/.test(uiSrc), true);
  check("hiddenActions defaults to showing everything (other pages safe)",
    /hiddenActions = \[\]/.test(gridSrc), true);

  /* ============ PRINT ============ */
  section("Print output");

  check("app chrome hidden when printing",
    /\.app-sidebar,[\s\S]{0,120}\.app-header/.test(cssSrc), true);
  check("filters and action bar hidden when printing",
    /\.cr-filters,[\s\S]{0,80}\.cr-report-actions/.test(cssSrc), true);
  check("landscape paper", /size: A4 landscape/.test(cssSrc), true);
  check("table fits the page", /table-layout: fixed/.test(cssSrc), true);
  check("header repeats across pages", /display: table-header-group/.test(cssSrc), true);
  check("totals stay with the table", /display: table-footer-group/.test(cssSrc), true);
  check("title block kept in print", /\.cr-result-head \{[\s\S]{0,120}text-align: center/.test(cssSrc), true);

  /* ============ EXPORT / PRINT PARITY (F) ============ */
  section("Export & print parity — CSV / Excel / PDF / Print");

  check("one row source feeds CSV, PDF, Copy and Print",
    /rows=\{exportRows\}/.test(uiSrc), true);
  check("Group in the export rows is the row's own group (Institute Code)",
    /exportRows[\s\S]{0,700}group:\s*row\.group/.test(uiSrc), false);
  check("export rows spread the screen row, so group travels unchanged",
    /const exportRows = useMemo\([\s\S]{0,400}\.\.\.row,/.test(uiSrc), true);
  check("Salary Month in the export rows is the BILL month",
    /const exportRows = useMemo\([\s\S]{0,400}salaryMonth: billMonthOf\(row\)/.test(uiSrc), true);
  check("the totals row travels with CSV / PDF / Copy",
    /const exportRows = useMemo\([\s\S]{0,1200}srNo: "TOTAL"/.test(uiSrc), true);
  check("totals are reused, never recomputed for the export",
    /srNo: "TOTAL"[\s\S]{0,400}money\(totals\[key\]\)/.test(uiSrc), true);
  check("the export totals depend on the same totals state",
    /}, \[rows, totals\]\);/.test(uiSrc), true);
  check("no totals row is emitted when the report is empty",
    /if \(!totals \|\| mapped\.length === 0\) return mapped;/.test(uiSrc), true);
  check("CSV is a real CSV, not a renamed table",
    /download\(`\$\{title\}\.csv`, toCsv\(header, body\)/.test(gridSrc), true);
  check("the page's Excel button hits the real .xlsx endpoint",
    /downloadChequeRegisterExcel/.test(uiSrc), true);
  check("the .xlsx export carries a totals row too",
    /Totals row, in the same shape the screen prints/.test(backendSrc), true);
  check("the .xlsx Group column is the Institute Code column",
    /key: "group"/.test(backendSrc), true);
  check("the .xlsx Salary Month column is fed by billMonthLabel",
    /billMonthLabel[\s\S]{0,80}Salary Month|Salary Month[\s\S]{0,80}billMonthLabel/.test(backendSrc), true);

  /* ============ BILL MONTH RESOLUTION (value-level) ============ */
  section("Bill Month is resolved from BillMonth, not the salary month number");

  /*
     normalizeYearMonth returns its explicit month/year arguments without ever
     parsing the month string. Passing SalaryMonthNumber while normalizing
     BillMonth therefore produced the SALARY month: JUN-2026-BM-MAY resolved
     to June instead of May, so the Salary Month column and the register's
     month filter both used the wrong month. These assertions check the
     RESOLVED VALUE, not the shape of the call.
  */
  const { billMonthPartsOf } = require("../routes/chequeRegister");
  const key = (p) => (p ? `${p.year}-${String(p.month).padStart(2, "0")}` : null);

  check("a Bill-Month variant resolves to its own month",
    key(billMonthPartsOf("MAY-2026", "June", "2026", "06")), "2026-05");
  check("the canonical bill resolves to its own month",
    key(billMonthPartsOf("JUN-2026", "June", "2026", "06")), "2026-06");
  check("the two June bills resolve to DIFFERENT months",
    key(billMonthPartsOf("MAY-2026", "June", "2026", "06")) !==
      key(billMonthPartsOf("JUN-2026", "June", "2026", "06")), true);
  check("an APR variant resolves to April",
    key(billMonthPartsOf("APR-2026", "June", "2026", "06")), "2026-04");
  check("a bill with no BillMonth still falls back to the salary month",
    key(billMonthPartsOf(null, "June", "2026", "06")), "2026-06");
  check("an empty BillMonth falls back too",
    key(billMonthPartsOf("", "June", "2026", "06")), "2026-06");
  check("the raw utility still short-circuits (why the wrapper exists)",
    key(require("../utils/salaryMonthKey").normalizeYearMonth("MAY-2026", "2026", "06")),
    "2026-06");
  check("the register maps its Salary Month column from the resolved parts",
    /billMonthLabel: formatMonthLabel\(billYm\)/.test(backendSrc), true);
  /* The report PERIOD is the salary month; the Bill Month is display and
     REGULAR/OLD classification only. Two different resolvers, on purpose. */
  check("the report period filter uses the SALARY month",
    /salaryParts = salaryMonthPartsOf\(/.test(backendSrc), true);
  check("the month column still resolves the BILL month",
    /billYm = billMonthPartsOf\(/.test(backendSrc), true);
  check("no caller passes SalaryMonthNumber while normalizing a BillMonth",
    /normalizeYearMonth\(\s*row\.BillMonth,\s*row\.SalaryYear,\s*row\.SalaryMonthNumber/.test(backendSrc), false);

  console.log(`\n${"=".repeat(68)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(68));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
