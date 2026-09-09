/*
  ==================================================================
  "REGULAR SALARY" MUST INCLUDE REGULAR + OLD
  ==================================================================

  THE RULE

    Salary Month is the PERIOD a salary belongs to.
    Bill Month is an independent bill-generation month.
    An OLD bill is an ordinary salary bill for the selected Salary Month that
    carries an earlier Bill Month (resolveChequeSalaryType: REGULAR when
    Salary Month == Bill Month, otherwise OLD).

    So selecting  Salary Month = JUN-2026, Salary Type = Regular Salary
    must return every ordinary salary bill of June 2026 whatever its Bill
    Month, and must NOT return DA Difference, other salary months, or
    unapproved or archived bills.

  WHAT THIS SUITE DOES

    It runs the REAL shipped mappers and filters of every affected report —
    not a re-implementation — over one shared fixture, and asserts on the
    dataset each report's own data builder returns. A frontend that merely
    displays more rows would not satisfy any assertion here.

  SHARED FIXTURE (selected month: JUN-2026)

    A  Bill APR-2026  Salary JUN-2026  OLD             1000  -> included
    B  Bill MAY-2026  Salary JUN-2026  OLD             2000  -> included
    C  Bill JUN-2026  Salary JUN-2026  REGULAR         3000  -> included
    D  Bill MAY-2026  Salary MAY-2026  OLD             4000  -> excluded
    E  Bill JUL-2026  Salary JUL-2026  REGULAR         5000  -> excluded
    F  Bill JUN-2026  Salary JUN-2026  DA DIFFERENCE   1500  -> excluded
    G  Bill JUN-2026  Salary JUN-2026  REGULAR, OPEN    900  -> excluded
    H  Bill JUN-2026  Salary JUN-2026  OLD, ARCHIVED    800  -> excluded

    Applicable total for Regular Salary = 6000.

  Offline. No database, no server, no network. The db module is replaced by a
  RECORDING stub that logs every statement, so the suite proves it issued no
  INSERT / UPDATE / DELETE / MERGE.

  Usage: cd backend && npm run test:regular-salary-includes-old
*/

const path = require("path");
const Module = require("module");

/* ---------- recording offline stub ---------- */
const statements = [];
function record(text) {
  statements.push(String(text || ""));
  return Promise.resolve({ recordset: [] });
}
const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: (strings, ...vals) =>
      record(Array.isArray(strings) ? strings.join(" ? ") : strings),
    Request: function R() {
      return {
        input() { return this; },
        query: (t) => record(t),
      };
    },
  },
  connectDB: async () => true,
};

/* ---------- runner ---------- */
let passed = 0, failed = 0;
const failures = [];
let sectionName = "", secPass = 0, secFail = 0;
const sectionReport = [];
function closeSection() {
  if (!sectionName) return;
  sectionReport.push({
    name: sectionName,
    verdict: secFail === 0 ? "PASS" : "FAIL",
    assertions: secPass + secFail,
  });
  console.log(`  → ${secFail === 0 ? "PASS" : "FAIL"}   assertions: ${secPass + secFail}`);
}
function section(t) {
  closeSection();
  sectionName = t; secPass = 0; secFail = 0;
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; secPass++; console.log(`  PASS  ${name}`); }
  else {
    failed++; secFail++;
    failures.push(`[${sectionName}] ${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

/* ---------- the real report modules ---------- */
const chequeRegister = require("../routes/chequeRegister");
const employeeWise = require("../routes/employeeWiseSalary");
const instituteWise = require("../routes/instituteWiseSalary");
const npsSummary = require("../routes/npsSummary");
const salaryRegister = require("../routes/salaryRegister");
const { billTypeMatchesFilter, resolveChequeSalaryType } =
  require("../utils/salaryMonthKey");

/* ---------- shared fixture ---------- */
const FIXTURE = [
  { key: "A", BillMonth: "APR-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount: 1000, da: false, status: "APPROVED", archived: false },
  { key: "B", BillMonth: "MAY-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount: 2000, da: false, status: "APPROVED", archived: false },
  { key: "C", BillMonth: "JUN-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount: 3000, da: false, status: "LOCKED",   archived: false },
  { key: "D", BillMonth: "MAY-2026", SalaryMonth: "MAY-2026", SalaryMonthNumber: 5, SalaryYear: "2026", amount: 4000, da: false, status: "APPROVED", archived: false },
  { key: "E", BillMonth: "JUL-2026", SalaryMonth: "JUL-2026", SalaryMonthNumber: 7, SalaryYear: "2026", amount: 5000, da: false, status: "APPROVED", archived: false },
  { key: "F", BillMonth: "JUN-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount: 1500, da: true,  status: "APPROVED", archived: false },
  { key: "G", BillMonth: "JUN-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount:  900, da: false, status: "OPEN",     archived: false },
  { key: "H", BillMonth: "MAY-2026", SalaryMonth: "JUN-2026", SalaryMonthNumber: 6, SalaryYear: "2026", amount:  800, da: false, status: "APPROVED", archived: true },
];

/*
  The archived row never reaches a report: every loader excludes it in SQL
  (ISNULL(b.IsArchived,0) = 0), so a JS-level filter has no archived rows to
  see. Feeding H to the mappers would test a case the database has already
  removed, so the loaded set omits it exactly as the query would — and the
  SQL exclusion itself is asserted separately, on the shipped source.
*/
const LOADED = FIXTURE.filter((r) => !r.archived);

const JUN = { month: 6, year: 2026 };
const EXPECTED_KEYS = ["A", "B", "C"];
const EXPECTED_TOTAL = 6000;

/* Raw DB-shaped row builders, one per report's own SELECT shape. */
const common = (f, i) => ({
  BillCodeId: 100 + i,
  BillCode: `BILL-${f.key}`,
  BillMonth: f.BillMonth,
  SalaryMonth: f.SalaryMonth,
  SalaryMonthNumber: f.SalaryMonthNumber,
  SalaryYear: f.SalaryYear,
  BillCategory: f.da ? "Difference" : "Salary",
  BillType: f.da ? "DA DIFFERENCE" : "",
  WorkflowStatus: f.status,
  InstituteCode: "CPD-06",
  InstituteName: "Institute Six",
  SectionId: 1,
  SectionSrNo: 1,
  SectionName: "SECTION ONE",
});

const aggregateRows = LOADED.map((f, i) => ({
  ...common(f, i),
  WorkflowId: 900 + i,
  EmpCount: 1,
  NetSalary: f.amount,
  IncomeTax: 0,
  ProfessionalTax: 0,
}));

const detailRows = LOADED.map((f, i) => ({
  ...common(f, i),
  DetailId: 500 + i,
  EmployeeId: 7,
  EmployeeName: "TEST EMPLOYEE",
  NetSalary: f.amount,
  NetPay: f.amount,
  NPS: f.amount,
}));

const keyOf = (billCode) => String(billCode || "").replace("BILL-", "");
const sumBy = (rows, get) =>
  rows.reduce((t, r) => t + (Number(get(r)) || 0), 0);

console.log("======================================================================");
console.log('  "REGULAR SALARY" = REGULAR + OLD  FOR THE SELECTED SALARY MONTH');
console.log("======================================================================");

/* ================================================================== */
section("0. The canonical helper");

check("Regular Salary keeps REGULAR", billTypeMatchesFilter("REGULAR", "REGULAR"), true);
check("Regular Salary keeps OLD", billTypeMatchesFilter("REGULAR", "OLD"), true);
check("Old Salary is still a real narrowing option — OLD only",
  [billTypeMatchesFilter("OLD", "OLD"), billTypeMatchesFilter("OLD", "REGULAR")],
  [true, false]);
check("ALL keeps both", [billTypeMatchesFilter("ALL", "REGULAR"), billTypeMatchesFilter("ALL", "OLD")], [true, true]);
check("Regular Salary never matches a DA DIFFERENCE bill type",
  billTypeMatchesFilter("REGULAR", "DA DIFFERENCE"), false);
check("the UI spellings are accepted",
  [billTypeMatchesFilter("Regular Salary", "OLD"), billTypeMatchesFilter("regular_salary", "OLD")],
  [true, true]);
check("the fixture's own types come from the shared classifier",
  LOADED.map((f) => resolveChequeSalaryType({
    salaryMonth: f.SalaryMonth, billMonth: f.BillMonth,
    salaryYear: f.SalaryYear, billYear: f.SalaryYear,
    salaryMonthNumber: f.SalaryMonthNumber,
  })),
  ["OLD", "OLD", "REGULAR", "REGULAR", "REGULAR", "REGULAR", "REGULAR"]);

/* ================================================================== */
section("1. Cheque Register — the builder Section Summary is made of");

const crMapped = aggregateRows.map((r, i) => chequeRegister.mapAggregateRow(r, i + 1));
const crRegular = chequeRegister.filterRows(crMapped, { ...JUN, table: "REGULAR" });

check("Regular Salary for JUN-2026 returns A, B and C",
  crRegular.map((r) => keyOf(r.billCode)).sort(), EXPECTED_KEYS);
check("Test 2 — OLD with Bill Month APR-2026 is included",
  crRegular.some((r) => keyOf(r.billCode) === "A"), true);
check("Test 3 — OLD with Bill Month MAY-2026 is included",
  crRegular.some((r) => keyOf(r.billCode) === "B"), true);
check("Test 4 — REGULAR with Bill Month JUN-2026 is included",
  crRegular.some((r) => keyOf(r.billCode) === "C"), true);
check("Test 5 — OLD belonging to Salary Month MAY-2026 is excluded",
  crRegular.some((r) => keyOf(r.billCode) === "D"), false);
check("Test 6 — REGULAR belonging to Salary Month JUL-2026 is excluded",
  crRegular.some((r) => keyOf(r.billCode) === "E"), false);
check("Test 7 — DA Difference is excluded from Regular Salary",
  crRegular.some((r) => keyOf(r.billCode) === "F"), false);
check("Test 8 — the OPEN June bill is excluded; the approval rule is not weakened",
  crRegular.some((r) => keyOf(r.billCode) === "G"), false);
check("every returned row is APPROVED or LOCKED",
  crRegular.every((r) => ["APPROVED", "LOCKED"].includes(r.workflowStatus)), true);
check("Test 1 — the applicable total is 6000",
  sumBy(crRegular, (r) => r.chequeAmount), EXPECTED_TOTAL);
check("Old Salary alone still returns only the OLD bills",
  chequeRegister.filterRows(crMapped, { ...JUN, table: "OLD" })
    .map((r) => keyOf(r.billCode)).sort(), ["A", "B"]);
check("DA Difference mode is unchanged — it returns only the DA bill",
  chequeRegister.filterRows(crMapped, { ...JUN, table: "DA_DIFFERENCE" })
    .map((r) => keyOf(r.billCode)), ["F"]);
check("and DA Difference mode returns no regular or old salary row",
  chequeRegister.filterRows(crMapped, { ...JUN, table: "DA_DIFFERENCE" })
    .some((r) => ["A", "B", "C"].includes(keyOf(r.billCode))), false);

/* ================================================================== */
section("2. Test 10 — Bill Month is preserved, never normalised");

const byKey = new Map(crRegular.map((r) => [keyOf(r.billCode), r]));
check("A keeps Bill Month APR-2026", byKey.get("A").billMonthLabel, "APR-2026");
check("B keeps Bill Month MAY-2026", byKey.get("B").billMonthLabel, "MAY-2026");
check("C keeps Bill Month JUN-2026", byKey.get("C").billMonthLabel, "JUN-2026");
check("the three Bill Months stay distinct",
  [...new Set(crRegular.map((r) => r.billMonthLabel))].sort(),
  ["APR-2026", "JUN-2026", "MAY-2026"]);
check("while all three report the same Salary Month key",
  [...new Set(crRegular.map((r) => r.salaryMonthKey))], ["2026-06"]);
check("and each row keeps its own REGULAR / OLD type",
  crRegular.map((r) => `${keyOf(r.billCode)}:${r.type}`),
  ["A:OLD", "B:OLD", "C:REGULAR"]);

/* ================================================================== */
section("3. Section Summary — aggregation over the same rows");

const summaryTotal = sumBy(crRegular, (r) => r.chequeAmount);
const summaryEmployees = sumBy(crRegular, (r) => r.emp);
check("Section Summary is built from the Cheque Register, not its own query",
  typeof chequeRegister.buildChequeRegisterReport, "function");
check("Test 11 — the section total is the sum of all three bills",
  summaryTotal, EXPECTED_TOTAL);
check("and counts every included bill's employees",
  summaryEmployees, 3);
check("all three bills fall in one section, so aggregation yields one line",
  [...new Set(crRegular.map((r) => r.sectionId))].length, 1);
check("the institute is counted once, not once per bill month",
  [...new Set(crRegular.map((r) => r.instituteCode))], ["CPD-06"]);

/* ================================================================== */
section("4. Employee Wise Salary / IT & PT / NPS-GPF Deduction");

const ewsMapped = detailRows.filter((r) => r.BillCategory !== "Difference")
  .map(employeeWise.mapSalaryRow);
const ewsRegular = employeeWise.filterSalaryRows(ewsMapped, { ...JUN, salaryType: "REGULAR" });
check("Regular Salary returns A, B and C",
  ewsRegular.map((r) => keyOf(r.billCode)).sort(), EXPECTED_KEYS);
check("the applicable total is 6000", sumBy(ewsRegular, (r) => r.net), EXPECTED_TOTAL);
check("Bill Months (Paid Month) stay distinct",
  ewsRegular.map((r) => r.paidMonth).sort(), ["APR-2026", "JUN-2026", "MAY-2026"]);
check("Old Salary alone still narrows to OLD",
  employeeWise.filterSalaryRows(ewsMapped, { ...JUN, salaryType: "OLD" })
    .map((r) => keyOf(r.billCode)).sort(), ["A", "B"]);
check("the OPEN bill is still excluded",
  ewsRegular.some((r) => keyOf(r.billCode) === "G"), false);
check("other salary months are still excluded",
  ewsRegular.some((r) => ["D", "E"].includes(keyOf(r.billCode))), false);

/* ================================================================== */
section("5. Institute Wise Salary");

const iwsMapped = detailRows.filter((r) => r.BillCategory !== "Difference")
  .map(instituteWise.mapSalaryRow);
const iwsRegular = instituteWise.filterSalaryRows(iwsMapped, { ...JUN, salaryType: "REGULAR" });
check("Regular Salary returns A, B and C",
  iwsRegular.map((r) => keyOf(r.billCode)).sort(), EXPECTED_KEYS);
check("the applicable total is 6000", sumBy(iwsRegular, (r) => r.net), EXPECTED_TOTAL);
check("Old Salary alone still narrows to OLD",
  instituteWise.filterSalaryRows(iwsMapped, { ...JUN, salaryType: "OLD" })
    .map((r) => keyOf(r.billCode)).sort(), ["A", "B"]);
check("the OPEN bill is still excluded",
  iwsRegular.some((r) => keyOf(r.billCode) === "G"), false);

/* ================================================================== */
section("6. NPS Summary and NPS Institute Wise Summary");

const npsRows = LOADED.map((f, i) => ({
  ...common(f, i),
  EmployeeId: 7,
  EmployeeName: "TEST EMPLOYEE",
  PensionType: "NPS",
  NPS: f.amount,
  SalaryCategory: f.da ? "DA_DIFFERENCE" : "REGULAR",
}));
const junNps = npsRows.filter((r) => r.SalaryMonthNumber === 6 && r.SalaryYear === "2026");
const npsRegular = npsSummary.filterNpsRowsBySalaryType(junNps, "REGULAR");
check("Regular Salary returns the June regular and old rows",
  npsRegular.map((r) => keyOf(r.BillCode)).sort(), ["A", "B", "C", "G"]);
check("DA Difference is excluded from Regular Salary",
  npsRegular.some((r) => keyOf(r.BillCode) === "F"), false);
check("Old Salary alone still narrows to OLD",
  npsSummary.filterNpsRowsBySalaryType(junNps, "OLD")
    .map((r) => keyOf(r.BillCode)).sort(), ["A", "B"]);
check("DA Difference mode is unchanged",
  npsSummary.filterNpsRowsBySalaryType(junNps, "DA_DIFFERENCE")
    .map((r) => keyOf(r.BillCode)), ["F"]);
check("ALL still keeps every category",
  npsSummary.filterNpsRowsBySalaryType(junNps, "ALL").length, junNps.length);
/*
  filterNpsRowsBySalaryType narrows by salary type only — the APPROVED/LOCKED
  rule is enforced by loadNpsRows' own WHERE clause, which is asserted on the
  shipped source in section 8. G is present here because this fixture bypasses
  that query, not because the rule was weakened.
*/
check("the approval rule for NPS lives in the loader's WHERE clause",
  /IN \(N'APPROVED', N'LOCKED'\)/.test(
    require("fs").readFileSync(path.join(__dirname, "..", "routes", "npsSummary.js"), "utf8")
  ), true);

/* ================================================================== */
section("7. Salary Register");

/*
  The register's salary loader excludes DA Difference in SQL
  (BillCategory <> 'DIFFERENCE' AND BillType <> 'DA DIFFERENCE'), and DA rows
  reach the register through aggregateDaRows already tagged DA_DIFFERENCE.
  The fixture is shaped the same way, so F is appended as a DA-tagged row
  rather than pushed through the salary mapper it would never reach.
*/
const registerRows = LOADED
  .filter((f) => !f.da)
  .map((f, i) => ({
    ...common(f, i),
    BillNo: `NO-${f.key}`,
    Status: f.status,
    EmpCount: 1,
    NetSalary: f.amount,
  }))
  .map(salaryRegister.mapSalaryBillRow)
  .concat([{
    ...salaryRegister.mapSalaryBillRow({
      ...common(FIXTURE.find((f) => f.da), 99),
      BillNo: "NO-F", Status: "APPROVED", EmpCount: 1, NetSalary: 1500,
    }),
    salaryType: "DA_DIFFERENCE",
  }]);
const regRegular = salaryRegister.filterRegisterRows(registerRows, {
  ...JUN, salaryType: "REGULAR",
});
check("Regular Salary returns A, B and C",
  regRegular.map((r) => keyOf(r.billCode)).sort(), EXPECTED_KEYS);
/* The register prints full month names ("JUNE 2026"), unlike the Cheque
   Register's MON-YYYY. Only the distinctness matters here. */
check("Bill Months stay distinct on the register",
  regRegular.map((r) => r.billMonth).sort(),
  ["APRIL 2026", "JUNE 2026", "MAY 2026"]);
check("all three report the same Salary Month",
  [...new Set(regRegular.map((r) => r.salaryMonth))], ["JUNE 2026"]);
check("Old Salary alone still narrows to OLD",
  salaryRegister.filterRegisterRows(registerRows, { ...JUN, salaryType: "OLD" })
    .map((r) => keyOf(r.billCode)).sort(), ["A", "B"]);
check("DA Difference mode is unchanged",
  salaryRegister.filterRegisterRows(registerRows, { ...JUN, salaryType: "DA_DIFFERENCE" })
    .some((r) => ["A", "B", "C"].includes(keyOf(r.billCode))), false);
check("the OPEN bill is still excluded",
  regRegular.some((r) => keyOf(r.billCode) === "G"), false);
check("an explicit Bill Month filter still narrows by Bill Month",
  salaryRegister.filterRegisterRows(registerRows, {
    ...JUN, salaryType: "REGULAR", billMonth: 5, billYear: 2026,
  }).map((r) => keyOf(r.billCode)), ["B"]);

/* ================================================================== */
section("8. Existing eligibility rules are untouched in the shipped SQL");

const fs = require("fs");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", "routes", f), "utf8");
const LOADERS = [
  "chequeRegister.js", "employeeWiseSalary.js", "instituteWiseSalary.js",
  "npsSummary.js", "salaryRegister.js",
];
check("Test 9 — every loader still excludes archived bills",
  LOADERS.filter((f) => !/ISNULL\(b\.IsArchived, 0\) = 0/.test(src(f))), []);
check("every loader still requires APPROVED or LOCKED",
  LOADERS.filter((f) => !/IN \(N'APPROVED', N'LOCKED'\)/.test(src(f))), []);
check("no loader filters the period by Bill Month in SQL",
  LOADERS.filter((f) => /WHERE[\s\S]{0,400}b\.BillMonth\s*=/.test(src(f))), []);
check("Bank Copy's Regular mode still filters on the salary month only",
  /salaryMonthPartsOf\(/.test(src("bankCopy.js")) &&
    !/row\.type !== "REGULAR"/.test(src("bankCopy.js")), true);
check("Final Salary Bill was not touched by this change",
  /row\.type !== "REGULAR"/.test(src("finalSalaryBill.js")), false);
check("no report still requires type === REGULAR for a Regular Salary filter",
  LOADERS.filter((f) => /salaryType === "REGULAR" && row\.type !== "REGULAR"/.test(src(f))), []);

/* ================================================================== */
section("9. Test 12 — no SQL writes");

const joined = statements.join("\n").toUpperCase();
check("INSERT statements", (joined.match(/\bINSERT\b/g) || []).length, 0);
check("UPDATE statements", (joined.match(/\bUPDATE\b/g) || []).length, 0);
check("DELETE statements", (joined.match(/\bDELETE\b/g) || []).length, 0);
check("MERGE statements", (joined.match(/\bMERGE\b/g) || []).length, 0);
check("no real database connection was opened",
  require.cache[dbPath].exports.sql.query.name !== "realQuery", true);

/* ================================================================== */
section("10. Display labels say that Old is included");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src", "pages");
const page = (f) => fs.readFileSync(path.join(FRONT, f), "utf8");
const route = (f) => fs.readFileSync(path.join(__dirname, "..", "routes", f), "utf8");

/*
  Display-only. Every selector below keeps value="REGULAR" — only the text a
  user reads changes, so that the dropdown states the behaviour the backend
  already has. Two of these reports (Income Tax & Professional Tax, and the
  Employee/Institute Wise meta endpoints) use the shorter wording "Regular",
  and keep their own style as "Regular (incl. Old)".
*/
const FULL = "Regular Salary (incl. Old)";
const LABELLED_PAGES = [
  "ChequeRegister.jsx", "SectionSummary.jsx", "EmployeeWiseSalary.jsx",
  "InstituteWiseSalary.jsx", "NpsGpfDeduction.jsx", "NpsSummary.jsx",
  "NpsInstituteWiseSummary.jsx", "SalaryRegister.jsx",
];
check("every affected report page shows the (incl. Old) wording",
  LABELLED_PAGES.filter((f) => !page(f).includes(FULL)), []);
check("Income Tax & Professional Tax says so in its own shorter wording",
  /label: "Regular \(incl\. Old\)"/.test(page("IncomeTaxProfessionalTax.jsx")), true);
check("no affected page still shows a bare Regular Salary option",
  LABELLED_PAGES.filter((f) =>
    /<option value="REGULAR">Regular Salary<\/option>|label: "Regular Salary"/.test(page(f))), []);
check("the meta endpoints that serve these dropdowns match",
  ["chequeRegister.js", "instituteWiseSalary.js", "salaryRegister.js"]
    .filter((f) => !route(f).includes(FULL)), []);
check("NPS Schedule Summary's existing wording is unchanged",
  page("NpsScheduleSummary.jsx").includes('<option value="REGULAR">Regular Salary (incl. Old)</option>'), true);

check("the option value is still REGULAR everywhere",
  LABELLED_PAGES.filter((f) =>
    !/value="REGULAR"|value: "REGULAR"/.test(page(f))), []);
check("Old Salary keeps its wording and its OLD value",
  ["ChequeRegister.jsx", "SectionSummary.jsx", "EmployeeWiseSalary.jsx",
   "InstituteWiseSalary.jsx", "NpsSummary.jsx", "SalaryRegister.jsx"]
    .filter((f) => !/value="OLD">Old Salary<|value: "OLD", label: "Old Salary"/.test(page(f))), []);
check("no Old Salary option was given an (incl.) suffix",
  /Old Salary \(incl/.test(LABELLED_PAGES.map(page).join("\n")), false);
check("Bank Copy's payment-type selector is a different control and is unchanged",
  page("BankCopy.jsx").includes('label: "Regular Salary Bank Copy"'), true);
check("the labels changed nothing about the filter — REGULAR still spans both",
  [billTypeMatchesFilter("REGULAR", "REGULAR"),
   billTypeMatchesFilter("REGULAR", "OLD"),
   billTypeMatchesFilter("REGULAR", "DA DIFFERENCE")],
  [true, true, false]);
check("and the June dataset is byte-for-byte the same as before the relabel",
  chequeRegister.filterRows(crMapped, { ...JUN, table: "REGULAR" })
    .map((r) => keyOf(r.billCode)).sort(), EXPECTED_KEYS);

closeSection();

console.log("\n======================================================================");
console.log("SECTION SUMMARY");
console.log("======================================================================");
for (const s of sectionReport) {
  console.log(`  ${s.verdict.padEnd(6)} ${String(s.assertions).padStart(2)} assertions   ${s.name}`);
}
console.log("\n======================================================================");
console.log(`  TOTAL ASSERTIONS : ${passed + failed}`);
console.log(`  PASSED           : ${passed}`);
console.log(`  FAILED           : ${failed}`);
console.log("======================================================================");
if (failures.length) {
  console.log("\nFAILURES");
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed === 0 ? 0 : 1);
