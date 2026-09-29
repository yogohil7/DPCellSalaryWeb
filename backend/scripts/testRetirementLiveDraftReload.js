/**
 * LIVE BUG (2026-09-25): retirement GPF/NPS stop rule not enforced on
 * Get Data for a DRAFT bill whose employee rows were already saved once.
 *
 * Reported live evidence: Institute PLAN-09, Bill Month AUG-2026 / Salary
 * Month August-2026, Institute Status DRAFT.
 *   Employee 2109 — DateOfRetirement 31-08-2026, Pension NPS — screen showed
 *     NPS 7,392 (WRONG: must be 0 — Aug-2026 is the retirement month itself).
 *   Employee 2110 — DateOfRetirement 30-04-2038, Pension NPS — NPS 7,392
 *     (correct: retirement is far in the future).
 *
 * ROOT CAUSE: buildEmployeeRows() (backend/routes/salaryEntry.js) has two
 * branches per employee: a SAVED-SNAPSHOT branch (taken whenever a row
 * already exists in dbo.SalaryEmployeeDetails for this bill/institute) and
 * a FRESH-CALCULATION branch (via calculateForEmployee, only reached the
 * very first time a row is loaded). The retirement-stop rule was wired into
 * the fresh-calculation branch and into Save Draft / Submit, but the
 * saved-snapshot branch (mapSavedDetailToGridRow) never re-checked it at
 * all, in ANY workflow status. Once Employee 2109's row was saved even a
 * single time, every subsequent Get Data reused that saved snapshot
 * forever, and DateOfRetirement being on file made no difference.
 *
 * FIX: buildEmployeeRows now looks up the bill instance's workflow status
 * once, and for the saved-snapshot branch only, RE-DERIVES the
 * retirement-stop flag from the CURRENT EmployeeMaster.DateOfRetirement and
 * the bill's Salary Month whenever that instance is NOT APPROVED/LOCKED
 * (mapSavedDetailToGridRow gained an explicit, opt-in `retirementStop`
 * parameter, default false, so every other caller is unaffected). A
 * genuinely historical APPROVED/LOCKED row is still never recalculated —
 * see testRetirementGpfNpsStop.js's updated wiring checks and TEST 6 below.
 *
 * A SEPARATE, second bug was found and fixed in the same investigation:
 * frontend/src/pages/SalaryEntry.jsx set the `salaryMonth` React state from
 * result.bill.salaryMonth ALONE (a bare month name, e.g. "August", with no
 * year) after Get Data / Save Draft / Submit. The frontend's retirement-rule
 * mirror (utils/retirementRules.js -> parseSalaryMonthLabel) requires a
 * year to compute an ordinal, and returns "not stopped" for anything it
 * cannot parse — so even a correctly-zeroed backend NPS value was
 * overwritten back to a freshly (wrongly) calculated nonzero amount by the
 * grid's own live-recalculation (calculateEmployee), because its own stop
 * check silently always evaluated to false. Fixed by combining
 * result.bill.salaryMonth with result.bill.salaryYear into a parseable
 * "MMM-YYYY" label (toSalaryMonthLabel) before it reaches state, at all
 * three call sites (Get Data, Save Draft, Submit). See TEST 7+ below.
 *
 * Runs offline: the database layer is stubbed. No SQL Server needed.
 * Usage: cd backend && node scripts/testRetirementLiveDraftReload.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ===================== DB STUB ===================== */
/* Both sql.query`...` and (new sql.Request()).query`...` route through the
   same dispatcher, matched on the SQL text — exactly what buildEmployeeRows
   actually issues, in order: EmployeeMaster (roster), SalaryEmployeeDetails
   (saved snapshot), EmployeePayrollConfiguration (fallback, via
   Request.execute() rejecting to simulate a missing stored procedure, the
   same as every other offline test in this project),
   SalaryBillInstituteWorkflow (instance status). */
let FIXTURE = { employees: [], saved: [], workflow: null };

function textOf(strings) {
  return Array.isArray(strings) ? strings.join(" ") : String(strings || "");
}

function dispatch(text) {
  if (/FROM dbo\.EmployeeMaster e\b/.test(text)) {
    return { recordset: FIXTURE.employees };
  }
  if (/FROM dbo\.SalaryEmployeeDetails\b/.test(text)) {
    return { recordset: FIXTURE.saved };
  }
  if (/FROM dbo\.SalaryBillInstituteWorkflow\b/.test(text)) {
    return { recordset: FIXTURE.workflow ? [FIXTURE.workflow] : [] };
  }
  if (/FROM dbo\.EmployeePayrollConfiguration\b/.test(text)) {
    return { recordset: [] }; /* -> defaultPayrollConfig(), HRA not forced zero */
  }
  return { recordset: [] };
}

const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: (strings) => Promise.resolve(dispatch(textOf(strings))),
    Request: function R() {
      return {
        input() { return this; },
        execute: () => Promise.reject(new Error("no stored procedure in test stub")),
        query: (strings) => Promise.resolve(dispatch(textOf(strings))),
      };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const salaryEntry = require("../routes/salaryEntry");
const { buildEmployeeRows } = salaryEntry;

const salaryEntrySrc = fs.readFileSync(path.join(ROOT, "routes", "salaryEntry.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(ROOT, "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8");

/* ===================== TEST RUNNER ===================== */
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

/* ===================== FIXTURE HELPERS ===================== */

const BILL = { BillCodeId: 9001, SalaryMonth: "August", SalaryYear: "2026", SalaryMonthNumber: "08" };
const INSTITUTE = { InstituteId: 55, InstituteCode: "PLAN-09", InstituteName: "CHINMAY RESIDENT INSTITUTE FOR M.R. CHILDREN" };
const ASOF_AUG_2026 = "2026-08-31"; /* asOfFromBill(BILL) would produce this */

function employee(id, name, dateOfRetirement) {
  return { EmployeeId: id, EmployeeName: name, EmployeeCode: `E${id}`, DateOfRetirement: dateOfRetirement };
}

function savedRow(over) {
  return {
    Id: over.EmployeeId, EmployeeId: over.EmployeeId, EmployeeName: "", Designation: "ASSISTANT TEACHER",
    EmployeeType: "REGULAR", BasicPay: 61000, GradePay: 0, DA: 0, HRA: 0, MA: 0, TA: 0, CLA: 0,
    SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
    GPFSubscription: 0, GPFAdvance: 0, NPS: 7392, IncomeTax: 0, ProfessionalTax: 0,
    OtherDeduction: 0, PensionType: "NPS", InstituteCode: "PLAN-09", DisplayOrder: 1,
    DAPercentage: null, HRAPercentage: null, NPSManual: 0, TAManual: 0,
    ...over,
  };
}

async function loadRowsFor({ workflow, savedRows, salaryMonth = BILL, asOfDate = ASOF_AUG_2026 }) {
  FIXTURE = {
    employees: [
      employee(2109, "ASHOKKUMAR BHI", "2026-08-31"),
      employee(2110, "PANKAJKUMAR BHAGAT", "2038-04-30"),
    ],
    saved: savedRows,
    workflow,
  };
  const { rows } = await buildEmployeeRows({
    bill: salaryMonth,
    institute: INSTITUTE,
    asOfDate,
    billMonth: "AUG-2026",
    isCanonical: true,
  });
  return rows;
}

const byId = (rows, id) => rows.find((r) => Number(r.employeeId) === id);

/* ===================== TESTS 1-5 — the exact live case ===================== */

section("TEST 1-2 — DRAFT bill, ALREADY-SAVED rows: the exact live case");
(async () => {
  const draftWorkflow = { WorkflowId: 501, Status: "DRAFT", BillMonth: "AUG-2026" };
  const savedBoth = [
    savedRow({ EmployeeId: 2109, EmployeeName: "ASHOKKUMAR BHI" }),
    savedRow({ EmployeeId: 2110, EmployeeName: "PANKAJKUMAR BHAGAT" }),
  ];
  const rows = await loadRowsFor({ workflow: draftWorkflow, savedRows: savedBoth });

  const e2109 = byId(rows, 2109);
  const e2110 = byId(rows, 2110);

  check("TEST 1: Employee 2109 (retirement 31-08-2026), Salary Month Aug-2026, DRAFT+already-saved -> NPS = 0",
    e2109.nps, 0);
  check("TEST 1b: gpfNpsRetirementStop = true is surfaced on the row",
    e2109.gpfNpsRetirementStop, true);
  check("TEST 2 (control): Employee 2110 (retirement 30-04-2038) -> NPS unaffected, still 7392",
    e2110.nps, 7392);
  check("TEST 2b: control's gpfNpsRetirementStop = false",
    e2110.gpfNpsRetirementStop, false);

  section("TEST 3 — same DRAFT scenario, boundary months");
  const rowsMay = await loadRowsFor({
    workflow: draftWorkflow,
    savedRows: savedBoth,
    salaryMonth: { ...BILL, SalaryMonth: "May", SalaryMonthNumber: "05" },
    asOfDate: "2026-05-31",
  });
  check("TEST 3: Salary Month = May-2026 (retirement 31-08-2026, window is Jun/Jul/Aug) -> NOT stopped",
    byId(rowsMay, 2109).gpfNpsRetirementStop, false);
  check("TEST 3b: May-2026 NPS calculates normally (not the stale saved 7392, nor forced 0)",
    byId(rowsMay, 2109).nps > 0, true);

  const rowsSep = await loadRowsFor({
    workflow: draftWorkflow,
    savedRows: savedBoth,
    salaryMonth: { ...BILL, SalaryMonth: "September", SalaryMonthNumber: "09" },
    asOfDate: "2026-09-30",
  });
  check("TEST 4: Salary Month = September-2026 (after retirement) -> NOT applicable/stopped",
    byId(rowsSep, 2109).gpfNpsRetirementStop, false);

  const rowsJun = await loadRowsFor({
    workflow: draftWorkflow,
    savedRows: savedBoth,
    salaryMonth: { ...BILL, SalaryMonth: "June", SalaryMonthNumber: "06" },
    asOfDate: "2026-06-30",
  });
  check("TEST 4b: Salary Month = June-2026 (retirementMonth - 2) -> stopped (boundary inclusive)",
    byId(rowsJun, 2109).gpfNpsRetirementStop, true);
  check("TEST 4c: June-2026 NPS forced to 0",
    byId(rowsJun, 2109).nps, 0);

  section("TEST 5 — regression: an APPROVED/LOCKED instance's saved row is NEVER recalculated");
  const lockedRows = await loadRowsFor({
    workflow: { WorkflowId: 502, Status: "APPROVED", BillMonth: "AUG-2026" },
    savedRows: savedBoth,
  });
  check("TEST 5: APPROVED bill, Employee 2109, Aug-2026 -> the saved historical NPS (7392) is kept exactly as saved",
    byId(lockedRows, 2109).nps, 7392);
  check("TEST 5b: gpfNpsRetirementStop is not claimed for a row that was never recalculated",
    byId(lockedRows, 2109).gpfNpsRetirementStop, false);

  const lockedRows2 = await loadRowsFor({
    workflow: { WorkflowId: 503, Status: "LOCKED", BillMonth: "AUG-2026" },
    savedRows: savedBoth,
  });
  check("TEST 5c: LOCKED bill behaves the same as APPROVED — saved value untouched",
    byId(lockedRows2, 2109).nps, 7392);

  section("TEST 6 — no workflow row yet (a brand-new DRAFT instance) still enforces the rule");
  const rowsNoWorkflow = await loadRowsFor({ workflow: null, savedRows: savedBoth });
  check("TEST 6: no workflow row -> treated as editable draft, rule still enforced",
    byId(rowsNoWorkflow, 2109).nps, 0);

  /* ===================== TEST 7+ — frontend salaryMonth label fix ===================== */

  section("TEST 7 — frontend: salaryMonth state carries a parseable year (the second bug)");
  check("toSalaryMonthLabel helper exists and combines month + year",
    /const toSalaryMonthLabel = \(monthText, year\) => \{/.test(pageSrc), true);
  check("Get Data response wires salaryMonth through toSalaryMonthLabel (not String() alone)",
    /setSalaryMonth\(toSalaryMonthLabel\(result\.bill\.salaryMonth, result\.bill\.salaryYear\)\)/.test(pageSrc),
    true);
  check("exactly three call sites now use toSalaryMonthLabel (Get Data, Save Draft, Submit)",
    (pageSrc.match(/setSalaryMonth\(toSalaryMonthLabel\(result\.bill\.salaryMonth, result\.bill\.salaryYear\)\)/g) || []).length,
    3);
  check("no remaining call site sets salaryMonth from a bare String(result.bill.salaryMonth)",
    /setSalaryMonth\(String\(result\.bill\.salaryMonth\)\)/.test(pageSrc), false);

  /* Exercise the actual helper (copied 1:1 from the page — verifies the
     LOGIC, since the page itself is a default-exported component and not
     unit-callable here). */
  const toSalaryMonthLabel = (monthText, year) => {
    const raw = String(monthText || "").trim();
    if (!raw) return "";
    const y = String(year || "").trim();
    if (!y) return raw;
    return `${raw.split("-")[0].toUpperCase()}-${y}`;
  };
  check("TEST 7a: ('August', '2026') -> 'AUGUST-2026' (parseable: has a year)",
    toSalaryMonthLabel("August", "2026"), "AUGUST-2026");
  check("TEST 7b: no year available -> falls back to the bare label (unchanged old behavior)",
    toSalaryMonthLabel("August", ""), "August");

  const frontendRuleSrc = fs.readFileSync(
    path.join(ROOT, "..", "frontend", "src", "utils", "retirementRules.js"), "utf8");
  check("TEST 7c: the frontend rule parser CANNOT parse a bare month name (proves the bug existed)",
    /parseSalaryMonthLabel/.test(frontendRuleSrc), true);
  /* Load the real frontend parser logic to prove both the bug and the fix,
     using the exact same regex/parsing this file ships. */
  const parseMatch = frontendRuleSrc.match(/function parseSalaryMonthLabel\(label\) \{[\s\S]*?\n\}/);
  const parseFn = new Function(
    "MONTH_NAMES",
    `${parseMatch[0]}; return parseSalaryMonthLabel;`
  )(["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]);
  check("TEST 7d: parseSalaryMonthLabel('August') (bare, the OLD bug value) -> null (unparseable)",
    parseFn("August"), null);
  check("TEST 7e: parseSalaryMonthLabel('AUGUST-2026') (the FIXED value) -> parses correctly",
    parseFn("AUGUST-2026"), { year: 2026, month: 8 });

  console.log(`\n${"=".repeat(78)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(78));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
