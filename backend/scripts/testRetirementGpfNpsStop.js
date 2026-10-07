/**
 * Retirement-Based GPF/NPS Deduction Stop Rule (2026-09-25).
 *
 * Business rule: GPF/NPS employee deduction becomes ZERO starting from the
 * 3rd calendar month before the employee's retirement month (the
 * retirement month itself plus the two months immediately before it),
 * compared against the SALARY Month — never the Bill Month.
 *
 *   deductionStopMonth = retirementMonth - 2 calendar months
 *   stop when deductionStopMonth <= SalaryMonth <= retirementMonth
 *
 * Covers the exact TEST 1-15 scenarios from the spec, plus regression
 * checks that GPF Advance / Income Tax / Professional Tax / Other
 * Deduction / Cheque Amount are untouched, and that locked/saved
 * historical data is never silently recalculated.
 *
 * Runs offline: the database layer is stubbed. No SQL Server needed.
 * Usage: cd backend && node scripts/testRetirementGpfNpsStop.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */
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

const { isGpfNpsStoppedForRetirement, salaryYearMonthFromAsOfDate } =
  require("../utils/retirementRules");
const salaryEntry = require("../routes/salaryEntry");
const { finalizeSnapshotAmounts, asOfFromBill } = salaryEntry;

const salaryEntrySrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "salaryEntry.js"), "utf8");
const salaryCalculateSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "salaryCalculate.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8");
const frontendRuleSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "utils", "retirementRules.js"), "utf8");

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

const stop = (dateOfRetirement, salaryYear, salaryMonth) =>
  isGpfNpsStoppedForRetirement({ dateOfRetirement, salaryYear, salaryMonth });

/* ===================== TESTS 1-10 — the formula itself ===================== */

section("TESTS 1-5 — Retirement 31-07-2027");
check("TEST 1: Salary Apr-2027 -> normal (false)", stop("2027-07-31", 2027, 4), false);
check("TEST 2: Salary May-2027 -> stopped (true)", stop("2027-07-31", 2027, 5), true);
check("TEST 3: Salary Jun-2027 -> stopped (true)", stop("2027-07-31", 2027, 6), true);
check("TEST 4: Salary Jul-2027 -> stopped (true)", stop("2027-07-31", 2027, 7), true);
check("TEST 5: Salary Aug-2027 -> normal (false)", stop("2027-07-31", 2027, 8), false);

section("TESTS 6-10 — Retirement 30-09-2027");
check("TEST 6: Salary Jun-2027 -> normal (false)", stop("2027-09-30", 2027, 6), false);
check("TEST 7: Salary Jul-2027 -> stopped (true)", stop("2027-09-30", 2027, 7), true);
check("TEST 8: Salary Aug-2027 -> stopped (true)", stop("2027-09-30", 2027, 8), true);
check("TEST 9: Salary Sep-2027 -> stopped (true)", stop("2027-09-30", 2027, 9), true);
check("TEST 10: Salary Oct-2027 -> normal (false)", stop("2027-09-30", 2027, 10), false);

/* A year boundary, because the formula must work in calendar-month
   arithmetic, not naive "month - 2" that could go negative. */
section("Extra — year-boundary sanity (retirement 31-01-2028)");
check("Nov-2027 -> stopped", stop("2028-01-31", 2027, 11), true);
check("Dec-2027 -> stopped", stop("2028-01-31", 2027, 12), true);
check("Jan-2028 -> stopped", stop("2028-01-31", 2028, 1), true);
check("Oct-2027 -> normal", stop("2028-01-31", 2027, 10), false);
check("Feb-2028 -> normal", stop("2028-01-31", 2028, 2), false);

/* ===================== TEST 11 — null retirement date ===================== */

section("TEST 11 — DateOfRetirement NULL/empty");
check("null -> never stopped", stop(null, 2027, 5), false);
check("undefined -> never stopped", stop(undefined, 2027, 5), false);
check("empty string -> never stopped", stop("", 2027, 5), false);

/* finalizeSnapshotAmounts with no retirementStop flag (the default) must
   behave exactly as before this feature existed — untouched calculation. */
function gpfRow(over = {}) {
  return {
    employeeId: 3001,
    employeeName: "Test Employee",
    designation: "Clerk",
    employeeType: "REGULAR",
    basicPay: 40000,
    fixBasic: 0,
    da: 22000,
    hra: 3600,
    ma: 500,
    ta: 3600,
    cla: 0,
    specialAllowance: 0,
    washingAllowance: 0,
    otherEarnings: 0,
    nppa: 0,
    gpfSubscription: 5000,
    gpfAdvance: 1200,
    nps: 0,
    incomeTax: 1000,
    professionalTax: 200,
    otherDeduction: 50,
    daRate: 55,
    hraRate: 9,
    basicDriven: false,
    recalcFromBasic: false,
    fromSnapshot: true,
    ...over,
  };
}
function npsRow(over = {}) {
  return gpfRow({ gpfSubscription: 0, gpfAdvance: 0, nps: 4000, ...over });
}

const unaffected = finalizeSnapshotAmounts(gpfRow(), { pension: "GPF", hraForcedZero: false });
check("TEST 11: existing GPF calculation unchanged when retirementStop absent",
  unaffected.row.gpfSubscription, 5000);
check("TEST 11b: GPF Advance also unaffected", unaffected.row.gpfAdvance, 1200);

/* ===================== TEST 12 — NPS employee, final 3 months ===================== */

section("TEST 12 — NPS employee, final 3 months -> NPS = 0");
const npsStopped = finalizeSnapshotAmounts(npsRow(), {
  pension: "NPS", hraForcedZero: false, retirementStop: true,
});
check("TEST 12: NPS forced to 0", npsStopped.row.nps, 0);
check("TEST 12b: no GPF invented for an NPS employee", npsStopped.row.gpfSubscription, 0);
check("TEST 12c: GPF Advance untouched (already 0 for NPS by the pre-existing rule)",
  npsStopped.row.gpfAdvance, 0);
check("TEST 12d: gpfNpsRetirementStop flag surfaced on the row",
  npsStopped.row.gpfNpsRetirementStop, true);

const npsNotStopped = finalizeSnapshotAmounts(npsRow(), {
  pension: "NPS", hraForcedZero: false, retirementStop: false,
});
check("TEST 12e: NPS calculates normally outside the window",
  npsNotStopped.row.nps > 0, true);

/* ===================== TEST 13 — GPF employee, final 3 months ===================== */

section("TEST 13 — GPF employee, final 3 months -> GPF Subscription = 0");
const gpfStopped = finalizeSnapshotAmounts(gpfRow(), {
  pension: "GPF", hraForcedZero: false, retirementStop: true,
});
check("TEST 13: GPF Subscription forced to 0", gpfStopped.row.gpfSubscription, 0);
check("TEST 13b: no NPS invented for a GPF employee", gpfStopped.row.nps, 0);
check("TEST 13c: GPF Advance (recovery) is NOT stopped", gpfStopped.row.gpfAdvance, 1200);
check("TEST 13d: Income Tax untouched", gpfStopped.row.incomeTax, 1000);
check("TEST 13e: Professional Tax untouched", gpfStopped.row.professionalTax, 200);
check("TEST 13f: Other Deduction untouched", gpfStopped.row.otherDeduction, 50);

const gpfNotStopped = finalizeSnapshotAmounts(gpfRow(), {
  pension: "GPF", hraForcedZero: false, retirementStop: false,
});
check("TEST 13g: GPF Subscription calculates normally outside the window",
  gpfNotStopped.row.gpfSubscription, 5000);

section("TEST 13h — Cheque Amount formula untouched by the rule");
/* Cheque Amount = Net Salary + Income Tax + Professional Tax. Zeroing GPF
   raises Net Salary (fewer deductions), which must flow through normally —
   the formula itself must not special-case GPF/NPS. */
const expectedCheque = Number(
  (gpfStopped.row.netSalary + gpfStopped.row.incomeTax + gpfStopped.row.professionalTax).toFixed(2)
);
check("TEST 13h: chequeAmount = netSalary + incomeTax + professionalTax",
  gpfStopped.row.chequeAmount, expectedCheque);
check("TEST 13i: chequeAmount rose because GPF dropped out of the deduction total (net salary increased)",
  gpfStopped.row.chequeAmount > gpfNotStopped.row.chequeAmount, true);

/* ===================== TEST 14 / 15 — Salary Month vs Bill Month ===================== */

section("TEST 14/15 — comparison MUST use Salary Month, never Bill Month");

/* asOfFromBill() is the REAL production function both calculateForEmployee
   (fresh calc) and upsertEmployeeSalary (save) feed into
   salaryYearMonthFromAsOfDate() -> isGpfNpsStoppedForRetirement(). It is
   exercised here unmocked, with two bills that share the same Salary
   Month/Year but have deliberately DIFFERENT (and irrelevant) Bill Month
   fields, to prove Bill Month plays no part in the as-of date it produces. */
const billSalaryMayBillMonthAug = {
  SalaryMonth: "MAY-2027", SalaryYear: "2027", SalaryMonthNumber: "05",
  BillMonth: "AUG-2027", /* Bill Month says August — must be ignored */
};
const billSalaryMayBillMonthMay = {
  SalaryMonth: "MAY-2027", SalaryYear: "2027", SalaryMonthNumber: "05",
  BillMonth: "MAY-2027",
};
const asOf1 = asOfFromBill(billSalaryMayBillMonthAug);
const asOf2 = asOfFromBill(billSalaryMayBillMonthMay);
check("TEST 14a: asOfFromBill ignores Bill Month (same result regardless of BillMonth)",
  asOf1, asOf2);
check("TEST 14b: asOfFromBill reflects the Salary Month (May 2027)", asOf1.slice(0, 7), "2027-05");

const ym14 = salaryYearMonthFromAsOfDate(asOf1);
check("TEST 14: Salary Month=May-2027 / Bill Month=Aug-2027, Retirement=31-07-2027 -> GPF/NPS = 0",
  stop("2027-07-31", ym14.salaryYear, ym14.salaryMonth), true);

const billSalaryAprBillMonthJul = {
  SalaryMonth: "APR-2027", SalaryYear: "2027", SalaryMonthNumber: "04",
  BillMonth: "JUL-2027", /* Bill Month says July — must be ignored */
};
const asOf3 = asOfFromBill(billSalaryAprBillMonthJul);
const ym15 = salaryYearMonthFromAsOfDate(asOf3);
check("TEST 15a: asOfFromBill reflects the Salary Month (April 2027), not Bill Month (July)",
  asOf3.slice(0, 7), "2027-04");
check("TEST 15: Salary Month=Apr-2027 / Bill Month=Jul-2027, Retirement=31-07-2027 -> normal GPF/NPS",
  stop("2027-07-31", ym15.salaryYear, ym15.salaryMonth), false);

/* ===================== Integration wiring checks (source-level) ===================== */

section("Wiring — the real calculation paths actually call the helper");

check("salaryCalculate.js imports isGpfNpsStoppedForRetirement",
  /require\(["']\.\.\/utils\/retirementRules["']\)/.test(salaryCalculateSrc), true);
check("calculateForEmployee derives salaryYear/salaryMonth from onDate (the Salary Month), not billMonth",
  /salaryYearMonthFromAsOfDate\(onDate\)/.test(salaryCalculateSrc), true);
check("calculateForEmployee reads DateOfRetirement from the already-loaded EmployeeMaster row (e.*), no extra query",
  /employee\.DateOfRetirement/.test(salaryCalculateSrc), true);
check("mapCalcToGridRow enforces the stop AFTER both the default derivation and any manual override",
  /if \(calc\.gpfNpsRetirementStop\) \{\s*\n\s*if \(pension === "GPF"\) gpfSubscription = 0;\s*\n\s*if \(pension === "NPS"\) nps = 0;/.test(salaryCalculateSrc),
  true);

check("salaryEntry.js imports the same retirement rule helpers",
  /require\(["']\.\.\/utils\/retirementRules["']\)/.test(salaryEntrySrc), true);
check("finalizeSnapshotAmounts takes retirementStop as an explicit opt-in parameter (default false)",
  /retirementStop = false/.test(salaryEntrySrc), true);
check("upsertEmployeeSalary passes retirementStop from the freshly-computed taCalc (not the client payload)",
  /retirementStop: Boolean\(taCalc\.gpfNpsRetirementStop\)/.test(salaryEntrySrc), true);
/*
   2026-09-25 LIVE-BUG FIX: a saved-but-still-DRAFT row is NOT the same
   thing as a genuinely historical APPROVED/LOCKED row. The live report was
   that Employee 2109 (retirement 31-08-2026) still showed NPS 7,392 on
   Get Data for an AUG-2026 DRAFT bill whose row had already been saved
   once — buildEmployeeRows() took the "existing saved snapshot" branch and
   never re-checked the rule at all, in ANY status. mapSavedDetailToGridRow
   itself stays a pure mapper (no hidden recalculation): it now takes an
   explicit, opt-in `retirementStop` parameter (default false, so every
   pre-existing caller — offline tests included — is unaffected), and
   buildEmployeeRows is the ONLY caller that computes and passes it, and
   only after confirming the bill instance is NOT APPROVED/LOCKED. A truly
   historical (APPROVED/LOCKED) row is therefore still never recalculated. */
check("mapSavedDetailToGridRow takes an explicit, opt-in retirementStop parameter (default false)",
  (() => {
    const fn = salaryEntrySrc.slice(
      salaryEntrySrc.indexOf("function mapSavedDetailToGridRow"),
      salaryEntrySrc.indexOf("function loadSavedRows")
    );
    return /function mapSavedDetailToGridRow\(dbRow, \{ retirementStop = false/.test(fn)
      && /retirementStop,\s*\n\s*\}\s*\n\s*\)\.row;/.test(fn);
  })(),
  true
);
check("buildEmployeeRows only re-applies the rule to a saved row when the instance is NOT APPROVED/LOCKED",
  /instanceEditableForRetirementStop = !APPROVED_WORKFLOW_STATUSES\.has\(status\)/.test(salaryEntrySrc),
  true
);
check("buildEmployeeRows re-derives retirementStop from the CURRENT EmployeeMaster.DateOfRetirement (Salary Month, never Bill Month) for a saved row, not the stale saved snapshot",
  /isGpfNpsStoppedForRetirement\(\{\s*\n\s*dateOfRetirement: retirementDateByEmployeeId\.get\(employeeId\),\s*\n\s*salaryYear: retirementSalaryYm\.salaryYear,\s*\n\s*salaryMonth: retirementSalaryYm\.salaryMonth,/.test(salaryEntrySrc),
  true
);
check("the saved-row branch actually forwards the recomputed flag into mapSavedDetailToGridRow",
  /mapSavedDetailToGridRow\(\s*\n\s*\{\s*\n\s*\.\.\.existing,\s*\n\s*HraForcedZero: hraForcedZero \? 1 : 0,\s*\n\s*HRA: hraForcedZero \? 0 : existing\.HRA,\s*\n\s*\},\s*\n\s*\{ retirementStop: retirementStopForRow, applyFixPayRule \}\s*\n\s*\);/.test(salaryEntrySrc),
  true
);

section("Wiring — frontend mirrors the same rule for live grid feedback");
check("SalaryEntry.jsx imports the frontend retirement rule helper",
  /from "\.\.\/utils\/retirementRules"/.test(pageSrc), true);
check("calculateEmployee computes gpfNpsRetirementStop from employee.dateOfRetirement + salaryMonth",
  /isGpfNpsStoppedForRetirement\(\{\s*\n\s*dateOfRetirement: employee\.dateOfRetirement,\s*\n\s*salaryMonth,/.test(pageSrc),
  true);
check("calculatedEmployees recomputes when salaryMonth changes (not just employees)",
  /\[employees, salaryMonth, salaryReadOnly\]/.test(pageSrc), true);
check("GPF Subscription input is disabled when the rule applies",
  /employee\.gpfNpsRetirementStop\s*\n\s*\}\s*\n\s*value=\{\s*\n\s*employee\.gpfSubscription/.test(pageSrc),
  true);
check("NPS input is disabled when the rule applies",
  /employee\.gpfNpsRetirementStop\s*\n\s*\}\s*\n\s*value=\{\s*\n\s*employee\.nps/.test(pageSrc),
  true);
check("updateEmployeeValue blocks manual gpfSubscription/nps edits during the stop window",
  /\(field === "gpfSubscription" \|\| field === "nps"\) &&\s*\n\s*isGpfNpsStoppedForRetirement/.test(pageSrc),
  true);
check("frontend retirementRules.js exports isGpfNpsStoppedForRetirement",
  /export function isGpfNpsStoppedForRetirement/.test(frontendRuleSrc), true);

section("Regression — no new database column or schema change");
const retirementUtilSrc = fs.readFileSync(
  path.join(__dirname, "..", "utils", "retirementRules.js"), "utf8");
check("backend retirementRules.js has no SQL / ALTER TABLE / CREATE TABLE",
  /(ALTER TABLE|CREATE TABLE|sql\.query)/i.test(retirementUtilSrc), false);
check("no new migration file was added for this feature",
  !fs.existsSync(path.join(__dirname, "..", "sql", "schema", "53_RetirementGpfNpsStop.sql")), true);

console.log(`\n${"=".repeat(72)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log("=".repeat(72));
process.exit(failed ? 1 : 0);
