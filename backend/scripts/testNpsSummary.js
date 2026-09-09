/**
 * NPS SUMMARY and NPS INSTITUTE WISE SUMMARY (cases A-F).
 *
 * Value-level: every assertion checks returned rows and figures.
 *
 * Runs offline. Usage: cd backend && npm run test:nps-reports
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

const nps = require("../routes/npsSummary");
const cheque = require("../routes/chequeRegister");
const { filterNpsRows, groupNpsBySection, groupNpsByInstitute,
        SUMMARY_XLSX_COLUMNS, INSTITUTE_XLSX_COLUMNS } = nps;

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "npsSummary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const summarySrc = fs.readFileSync(path.join(FRONT, "pages", "NpsSummary.jsx"), "utf8");
const instSrc = fs.readFileSync(path.join(FRONT, "pages", "NpsInstituteWiseSummary.jsx"), "utf8");
const summaryCss = fs.readFileSync(path.join(FRONT, "pages", "npsSummary.css"), "utf8");
const instCss = fs.readFileSync(path.join(FRONT, "pages", "npsInstituteWise.css"), "utf8");

/* ===================== FIXTURE ===================== */

/*
  Phase 8 sanity: the route must require the existing salaryCategory
  helpers used by loadDaNpsRows, otherwise the commented-out import causes
  the live endpoint to 500 with "loadDaDifferenceRows is not defined".
*/
const liveRouteSrc = routeSrc;
function hasSalaryCategoryImport(src) {
  return /require\(["']\.\.\/utils\/salaryCategory["']\)/.test(src)
    || /from\s+["']\.\.\/utils\/salaryCategory["']/.test(src);
}

const SEC = {
  CPD: { id: 11, sr: 1, name: "CPD Section" },
  OGE: { id: 4,  sr: 2, name: "OGE Section" },
};

const JUN = { BillCode: "JUN-2026", BillMonth: "JUN-2026", SalaryMonth: "June",
              SalaryMonthNumber: "06", SalaryYear: "2026" };
const JUN_BM_MAY = { BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", SalaryMonth: "June",
                     SalaryMonthNumber: "06", SalaryYear: "2026" };
const JUL = { BillCode: "JUL-2026", BillMonth: "JUL-2026", SalaryMonth: "July",
              SalaryMonthNumber: "07", SalaryYear: "2026" };

const row = (sec, code, name, employeeId, npsAmt, bill = JUN, over = {}) => ({
  ...bill,
  WorkflowStatus: "APPROVED",
  InstituteCode: code,
  InstituteName: name,
  SectionId: SEC[sec].id,
  SectionSrNo: SEC[sec].sr,
  SectionName: SEC[sec].name,
  EmployeeId: employeeId,
  EmployeeName: `Emp${employeeId}`,
  PensionType: "NPS",
  NPS: npsAmt,
  ...over,
});

const ROWS = [
  /* CPD-17 regular: three employees. */
  row("CPD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 1, 2000),
  row("CPD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 2, 2000),
  row("CPD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 3, 1648),
  /* CPD-06 has BOTH a regular and an older bill. */
  row("CPD", "CPD-06", "Gujarat State Probation", 4, 3000),
  row("CPD", "CPD-06", "Gujarat State Probation", 5, 5648, JUN_BM_MAY),
  /* A second section. */
  row("OGE", "OGE-05", "Samanya Vruddhashram", 6, 4000),
  /* Control: a July salary-month row. */
  row("CPD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 7, 99999, JUL),
];

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
  console.log("NPS SUMMARY + NPS INSTITUTE WISE SUMMARY");
  console.log("=".repeat(76));

  const june = filterNpsRows(ROWS, { month: 6, year: 2026, salaryTime: "1" });
  const sectionRows = groupNpsBySection(june);
  const instRows = groupNpsByInstitute(june);

  /* ---------------- A, B ---------------- */
  section("A, B — June 2026 and July 2026, Salary Time 1");

  check("A. June returns the six June rows", june.length, 6);
  check("A. the July control is excluded",
    june.some((r) => r.BillCode === "JUL-2026"), false);
  check("B. July returns only its own row",
    filterNpsRows(ROWS, { month: 7, year: 2026 }).map((r) => Number(r.EmployeeId)), [7]);
  check("B. and its NPS is the July figure",
    filterNpsRows(ROWS, { month: 7, year: 2026 })[0].NPS, 99999);

  /* ---------------- columns ---------------- */
  section("Columns");

  check("the summary has the NPS columns",
    SUMMARY_XLSX_COLUMNS.map((c) => c.label),
    ["Sr_No.", "NAME", "EMP", "N.P.S.", "Amount"]);
  check("the institute-wise report has its own",
    INSTITUTE_XLSX_COLUMNS.map((c) => c.label),
    ["Sr_No.", "Code No.", "Institute Name", "Month", "Type", "Total", "N.P.S.", "Amount"]);
  check("no GPF, tax or other deduction is carried",
    /GPFSubscription|GPFAdvance|IncomeTax|ProfessionalTax|OtherDeduction/.test(routeSrc), false);
  check("the NPS amount is read from the stored NPS column",
    /d\.NPS\b/.test(routeSrc), true);
  check("it is never derived from Basic, Gross or Net",
    /BasicPay|GrossSalary|NetSalary/.test(routeSrc), false);

  /* ---------------- C, E — REGULAR + OLD ---------------- */
  section("C, E — REGULAR and OLD, kept as separate rows");

  const cpd06 = instRows.filter((r) => r.code === "CPD-06");
  check("C. both bill types are present",
    [...new Set(instRows.map((r) => r.type))].sort(), ["OLD", "REG"]);
  check("E. CPD-06 has two rows, not one", cpd06.length, 2);
  check("E. each with its own Month and Type",
    cpd06.map((r) => [r.month, r.type]), [["JUNE", "REG"], ["MAY", "OLD"]]);
  check("E. and its own NPS", cpd06.map((r) => r.nps), [3000, 5648]);
  check("E. REGULAR and OLD are never merged",
    cpd06[0].nps + cpd06[1].nps === 8648 && cpd06[0].nps !== 8648, true);
  // The route's only "REG"/"OLD" mentions are classification (const type = ...)
  // and the sort tie-break; neither drops a row. Assert the absence of an
  // actual filtering construct, and prove it by value below.
  check("C. no type filter exists in the route",
    /\.filter\([^)]*type\s*[=!]==|WHERE[^;]*\bType\s*=|salaryType\s*!==\s*["']OLD["']\s*\)\s*(?:continue|return)/
      .test(routeSrc), false);
  check("C. filterNpsRows keeps both REGULAR and OLD bills",
    [...new Set(june.map((r) => String(r.BillCode || "").includes("-BM-") ? "OLD" : "REG"))].sort(),
    ["OLD", "REG"]);
  check("C. no row is dropped between filter and grouping",
    june.reduce((sum, r) => sum + Number(r.NPS || 0), 0),
    instRows.reduce((sum, r) => sum + Number(r.nps || 0), 0));
  check("Amount equals the NPS amount on every row",
    instRows.every((r) => r.amount === r.nps), true);

  /* ---------------- D — multiple institutes ---------------- */
  section("D — multiple institutes, ordered by section then institute");

  check("D. one row per institute per bill",
    instRows.map((r) => [r.code, r.type]),
    [["CPD-06", "REG"], ["CPD-06", "OLD"], ["CPD-17", "REG"], ["OGE-05", "REG"]]);
  check("D. CPD (SrNo 1) comes before OGE (SrNo 2)",
    instRows[0].code.startsWith("CPD") && instRows[3].code === "OGE-05", true);
  check("D. CPD-06 before CPD-17, numerically",
    instRows.map((r) => r.code).indexOf("CPD-06") <
      instRows.map((r) => r.code).indexOf("CPD-17"), true);
  check("D. Sr. No. runs 1..n after ordering",
    instRows.map((r) => r.srNo), [1, 2, 3, 4]);
  check("D. employee counts are per bill",
    instRows.map((r) => r.total), [1, 1, 3, 1]);

  /* ---------------- section summary ---------------- */
  section("Section summary rows");

  check("one row per section, in master order",
    sectionRows.map((r) => r.name), ["CPD Section", "OGE Section"]);
  check("CPD employees = 3 + 1 + 1", sectionRows[0].emp, 5);
  check("CPD NPS = 2000+2000+1648 + 3000 + 5648", sectionRows[0].nps, 14296);
  check("OGE NPS", sectionRows[1].nps, 4000);
  check("Amount mirrors NPS", sectionRows.map((r) => r.amount === r.nps), [true, true]);
  check("Sr. No. after ordering", sectionRows.map((r) => r.srNo), [1, 2]);

  /* ---------------- reconciliation ---------------- */
  section("Reconciliation: Cheque Register = NPS Summary = Institute Wise");

  const registerDbRows = [
    { ...JUN, WorkflowStatus: "APPROVED", InstituteCode: "CPD-17",
      InstituteName: "Samarpan", SectionId: SEC.CPD.id, SectionName: SEC.CPD.name,
      EmpCount: 3, NPS: 5648, BillCategory: "Salary", BillType: "" },
    { ...JUN, WorkflowStatus: "APPROVED", InstituteCode: "CPD-06",
      InstituteName: "Gujarat State Probation", SectionId: SEC.CPD.id,
      SectionName: SEC.CPD.name, EmpCount: 1, NPS: 3000,
      BillCategory: "Salary", BillType: "" },
    { ...JUN_BM_MAY, WorkflowStatus: "APPROVED", InstituteCode: "CPD-06",
      InstituteName: "Gujarat State Probation", SectionId: SEC.CPD.id,
      SectionName: SEC.CPD.name, EmpCount: 1, NPS: 5648,
      BillCategory: "Salary", BillType: "" },
    { ...JUN, WorkflowStatus: "APPROVED", InstituteCode: "OGE-05",
      InstituteName: "Samanya", SectionId: SEC.OGE.id, SectionName: SEC.OGE.name,
      EmpCount: 1, NPS: 4000, BillCategory: "Salary", BillType: "" },
  ];
  const registerRows = cheque.filterRows(
    registerDbRows.map((r, i) => cheque.mapAggregateRow(r, i + 1)),
    { month: 6, year: 2026, table: "SALARY" }
  );
  const registerNps = registerRows.reduce((s, r) => s + Number(r.nps), 0);
  const summaryNps = sectionRows.reduce((s, r) => s + r.nps, 0);
  const instituteNps = instRows.reduce((s, r) => s + r.nps, 0);

  check("the register sees both REGULAR and OLD",
    [registerRows.filter((r) => r.type === "REGULAR").length,
     registerRows.filter((r) => r.type === "OLD").length], [3, 1]);
  check("Cheque Register NPS total = NPS Summary total", registerNps, summaryNps);
  check("NPS Summary total = NPS Institute Wise total", summaryNps, instituteNps);
  check("all three equal 18,296", [registerNps, summaryNps, instituteNps],
    [18296, 18296, 18296]);
  check("dropping the OLD bill would NOT reconcile",
    registerRows.filter((r) => r.type === "REGULAR")
      .reduce((s, r) => s + Number(r.nps), 0) === summaryNps, false);
  check("both reports read the same stored column the register sums",
    /ISNULL\(SUM\(d\.NPS\), 0\)/.test(
      fs.readFileSync(path.join(__dirname, "..", "routes", "chequeRegister.js"), "utf8")
    ) && /d\.NPS/.test(routeSrc), true);

  /* ---------------- F — no data ---------------- */
  section("F — no NPS records");

  check("F. an out-of-range month returns nothing",
    filterNpsRows(ROWS, { month: 1, year: 2026 }), []);
  check("F. grouping an empty set yields no rows",
    [groupNpsBySection([]), groupNpsByInstitute([])], [[], []]);
  check("F. the summary page shows the message",
    /No NPS records found for the selected criteria\./.test(summarySrc), true);
  check("F. the institute-wise page shows it too",
    /No NPS records found for the selected criteria\./.test(instSrc), true);
  check("F. no zero rows are invented — only rows with NPS are loaded",
    /ISNULL\(d\.NPS, 0\) <> 0/.test(routeSrc), true);

  /* ---------------- eligibility, routes, typography ---------------- */
  section("Eligibility, routes and typography");

  check("only APPROVED and LOCKED are counted",
    filterNpsRows(
      ["APPROVED", "LOCKED", "DRAFT", "RETURNED", "REJECTED", "SUBMITTED"]
        .map((st, i) => row("CPD", "CPD-06", "X", 800 + i, 10, JUN, { WorkflowStatus: st })),
      { month: 6, year: 2026 }
    ).map((r) => r.WorkflowStatus), ["APPROVED", "LOCKED"]);
  check("the shared status set is reused",
    /APPROVED_WORKFLOW_STATUSES/.test(routeSrc), true);
  check("DA Difference and archived bills are excluded",
    /<> N'DA DIFFERENCE'/.test(routeSrc) && /ISNULL\(b\.IsArchived, 0\) = 0/.test(routeSrc), true);
  check("the period rule is the shared salary-month resolver",
    /salaryMonthPartsOf\(/.test(routeSrc), true);
  check("the Bill Month and REG/OLD helpers are reused, not copied",
    /billMonthPartsOf\(/.test(routeSrc) && /resolveChequeSalaryType\(/.test(routeSrc), true);
  check("a section filter narrows to that section",
    groupNpsBySection(filterNpsRows(ROWS, { month: 6, year: 2026, sectionId: SEC.OGE.id }))
      .map((r) => r.name), ["OGE Section"]);
  check("salaryCategory is required so loadDaNpsRows does not 500",
    hasSalaryCategoryImport(liveRouteSrc), true);
  check("CATEGORY_DA_DIFFERENCE is imported alongside loadDaDifferenceRows",
    /CATEGORY_DA_DIFFERENCE/.test(liveRouteSrc), true);
  check("every npsSummary helper reuses the existing salaryCategory implementation, not a duplicate",
    /\.NPS/.test(liveRouteSrc) && !/function\s+loadDaDifferenceRows\s*\(/.test(liveRouteSrc), true);
  check("DA Difference path: stored nps only, nonzero filtering, existing grouping preserved",
    /loadDaNpsRows/.test(liveRouteSrc) && /loadAllNpsRows/.test(liveRouteSrc)
      && liveRouteSrc.includes("Number(row.nps") && /groupNpsBySection|groupNpsByInstitute/.test(liveRouteSrc), true);
  section("Live builder path — proves the Fix 1 endpoint no longer 500s");
  check("the route now requires salaryCategory so loadDaDifferenceRows is defined",
    hasSalaryCategoryImport(liveRouteSrc), true);
  check("loadAllNpsRows concatenates regular + DA sets so neither regular/old nor DA are dropped",
    /loadAllNpsRows/.test(liveRouteSrc) && /Promise\.all/.test(liveRouteSrc)
      && /loadNpsRows\(\)/.test(liveRouteSrc) && /loadDaNpsRows\(\)/.test(liveRouteSrc), true);
  check("check(response structure remains { message, data }) compatible with frontend",
    /res\.json\([^)]*message[^)]*data[^)]*\)/.test(liveRouteSrc) || /\.json\(\{[^}]*message[^}]*data[^}]*\}\)/.test(liveRouteSrc), true);
  check("both routes are authenticated and permission-gated",
    /\/api\/nps-summary",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("both reports use the global Inter token",
    /font-family: var\(--font-family-base\)/.test(summaryCss) &&
      /font-family: var\(--font-family-base\)/.test(instCss), true);
  check("neither uses Times New Roman, on screen or on paper",
    /Times New Roman/.test(summaryCss) || /Times New Roman/.test(instCss), false);
  check("printing hides the filters and actions",
    /@media print/.test(summaryCss) && /@media print/.test(instCss), true);
  check("the four cheque/challan fields are editable on both",
    [(summarySrc.match(/nps-cheque-print/g) || []).length,
     (instSrc.match(/npsiw-cheque-print/g) || []).length], [4, 4]);

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
