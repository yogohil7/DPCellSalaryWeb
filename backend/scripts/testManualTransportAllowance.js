/**
 * A manually entered TA must reach Salary Bill Approval unchanged (cases A-F).
 *
 * Regression for: Salary Entry saved TA 7,200 for CPD-06 / JUN-2026-BM-MAY,
 * but Salary Bill Approval displayed the master amount 3,600, because the
 * save path overwrote every TA with the master-derived value.
 *
 * Runs offline. Usage: cd backend && npm run test:manual-ta
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ===================== FIXTURE ===================== */

const MASTER_TA = 3600;   /* what the TA master derives for this employee */
const MANUAL_TA = 7200;   /* what the operator typed in Salary Entry      */

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

const salaryEntry = require("../routes/salaryEntry");
const { finalizeSnapshotAmounts, mapSavedDetailToGridRow, isManualTa } = salaryEntry;
const approval = require("../routes/salaryBillApproval");

const entrySrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryEntry.js"), "utf8");
const approvalSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryBillApproval.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryEntry.jsx"), "utf8");
const gridSrc = fs.readFileSync(path.join(FRONT, "components", "DataGrid.jsx"), "utf8");

/* A Salary Entry grid row as the frontend posts it. */
function entryRow(ta, extra = {}) {
  return {
    employeeId: 5501,
    employeeName: "Ramanbhai D. Damor",
    designation: "Lecturer",
    employeeType: "REGULAR",
    pension: "NPS",
    basicPay: 44900,
    fixBasic: 0,
    gradePay: 0,
    da: 24695,
    hra: 4041,
    ma: 500,
    ta,
    cla: 0,
    specialAllowance: 0,
    washingAllowance: 0,
    otherEarnings: 0,
    nppa: 0,
    gpfSubscription: 0,
    gpfAdvance: 0,
    nps: 6960,
    npsManual: true,
    incomeTax: 0,
    professionalTax: 200,
    otherDeduction: 0,
    daRate: 55,
    hraRate: 9,
    basicDriven: false,
    recalcFromBasic: false,
    fromSnapshot: true,
    ...extra,
  };
}

/*
   Mirrors the shipped decision in upsertEmployeeSalary: the TA written to
   the database is the master amount UNLESS the row is flagged manual.
*/
function taWrittenToDatabase(row) {
  const manual = isManualTa(row);
  return finalizeSnapshotAmounts(
    { ...row, ta: manual ? row.ta : MASTER_TA, taManual: manual },
    { pension: row.pension, hraForcedZero: false }
  ).row;
}

/* The stored row, as Salary Bill Approval reads it back. */
function storedDetail(saved) {
  return {
    Id: 91001,
    EmployeeId: saved.employeeId,
    EmployeeName: saved.employeeName,
    Designation: saved.designation,
    EmployeeType: saved.employeeType,
    PensionType: saved.pension,
    DisplayOrder: 1,
    BasicPay: saved.basicPay,
    GradePay: saved.gradePay,
    TotalBasic: saved.totalBasic,
    DA: saved.da,
    HRA: saved.hra,
    MA: saved.ma,
    TA: saved.ta,
    TAManual: saved.taManual ? 1 : 0,
    CLA: saved.cla,
    SpecialAllowance: saved.specialAllowance,
    WashingAllowance: saved.washingAllowance,
    OtherEarnings: saved.otherEarnings,
    NPPA: saved.nppa,
    GrossSalary: saved.grossSalary,
    GPFSubscription: saved.gpfSubscription,
    GPFAdvance: saved.gpfAdvance,
    NPS: saved.nps,
    NPSManual: saved.npsManual ? 1 : 0,
    IncomeTax: saved.incomeTax,
    ProfessionalTax: saved.professionalTax,
    OtherDeduction: saved.otherDeduction,
    TotalDeduction: saved.totalDeduction,
    NetSalary: saved.netSalary,
    DAPercentage: saved.daRate,
    HRAPercentage: saved.hraRate,
    InstituteCode: "CPD-06",
  };
}

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
  console.log("=".repeat(74));
  console.log("Manual TA survives Salary Entry -> Save/Submit -> Approval (A-F)");
  console.log("=".repeat(74));

  /* ---------------- A ---------------- */
  section("A — TA 7,200 entered manually stays 7,200 all the way to Approval");

  const manualRow = entryRow(MANUAL_TA, { taManual: true });
  check("A. the row is recognised as a manual TA", isManualTa(manualRow), true);

  const savedA = taWrittenToDatabase(manualRow);
  check("A. Salary Entry saves 7,200", savedA.ta, MANUAL_TA);
  check("A. NOT the master 3,600", savedA.ta === MASTER_TA, false);
  check("A. the manual flag is stored with it", savedA.taManual, true);

  const submittedA = taWrittenToDatabase({ ...savedA, taManual: savedA.taManual });
  check("A. Submit keeps 7,200", submittedA.ta, MANUAL_TA);

  const approvalA = approval.mapDetailRow(storedDetail(savedA));
  check("A. Approval displays 7,200", approvalA.ta, MANUAL_TA);
  check("A. Approval did not fall back to the master", approvalA.ta === MASTER_TA, false);

  /* ---------------- B ---------------- */
  section("B — TA 3,600 entered manually stays 3,600");

  const savedB = taWrittenToDatabase(entryRow(3600, { taManual: true }));
  check("B. saved as 3,600", savedB.ta, 3600);
  check("B. Approval shows 3,600", approval.mapDetailRow(storedDetail(savedB)).ta, 3600);

  /* ---------------- C ---------------- */
  section("C — manual TA differs from the master TA: the manual one wins");

  check("C. master and manual genuinely differ", MANUAL_TA !== MASTER_TA, true);
  check("C. Approval uses the stored employee TA, not the master",
    approval.mapDetailRow(storedDetail(savedA)).ta, MANUAL_TA);

  /* An UNflagged row still follows the master — the Basic Pay rule is intact. */
  const autoRow = entryRow(9999);
  check("C. an un-flagged TA is not treated as manual", isManualTa(autoRow), false);
  const savedAuto = taWrittenToDatabase(autoRow);
  check("C. and is replaced by the master amount", savedAuto.ta, MASTER_TA);
  check("C. so a stale grid TA can never be persisted", savedAuto.ta === 9999, false);

  /* A Basic Pay edit releases TA back to the master, as before. */
  const basicEdited = entryRow(MANUAL_TA, { taManual: true, basicDriven: true, recalcFromBasic: true });
  check("C. a Basic-Pay-driven row is not manual", isManualTa(basicEdited), false);
  check("C. and takes the master TA", taWrittenToDatabase(basicEdited).ta, MASTER_TA);

  /* ---------------- D ---------------- */
  section("D — Edit/Correct a RETURNED bill: 7,200 survives the round trip");

  const reopened = mapSavedDetailToGridRow(storedDetail(savedA));
  check("D. reopening the returned bill shows 7,200", reopened.ta, MANUAL_TA);
  check("D. and remembers that it was manual", reopened.taManual, true);

  const resaved = taWrittenToDatabase({ ...reopened, pension: "NPS" });
  check("D. saving it again keeps 7,200", resaved.ta, MANUAL_TA);
  check("D. Approval still shows 7,200 after resubmit",
    approval.mapDetailRow(storedDetail(resaved)).ta, MANUAL_TA);

  /* Without the stored flag the value would be lost on the second save. */
  const reopenedNoFlag = mapSavedDetailToGridRow({ ...storedDetail(savedA), TAManual: 0 });
  check("D. (control) an unflagged reopen reverts to the master",
    taWrittenToDatabase({ ...reopenedNoFlag, pension: "NPS" }).ta, MASTER_TA);

  /* ---------------- E ---------------- */
  section("E — Gross and Net use the same final TA");

  const grossWithManual = savedA.grossSalary;
  const grossWithMaster = taWrittenToDatabase(entryRow(MANUAL_TA)).grossSalary;
  check("E. Gross is higher by exactly the TA difference",
    grossWithManual - grossWithMaster, MANUAL_TA - MASTER_TA);
  check("E. Gross includes the manual TA",
    grossWithManual,
    savedA.totalBasic + savedA.da + savedA.hra + savedA.ma + MANUAL_TA +
      savedA.cla + savedA.specialAllowance + savedA.washingAllowance +
      savedA.otherEarnings + savedA.nppa);
  check("E. Net = Gross - deductions, on the same TA",
    savedA.netSalary, savedA.grossSalary - savedA.totalDeduction);
  check("E. Approval's Gross matches the stored Gross",
    approval.mapDetailRow(storedDetail(savedA)).grossSalary, savedA.grossSalary);
  check("E. Approval's Net matches the stored Net",
    approval.mapDetailRow(storedDetail(savedA)).netSalary, savedA.netSalary);

  /* ---------------- F ---------------- */
  section("F — CSV / Excel / PDF / Print show the same TA as the screen");

  check("F. the grid exports read the row's own value, never a recalculation",
    /const value = row\?\.\[column\.key\];/.test(gridSrc), true);
  check("F. CSV, Excel, PDF and Print share one row builder",
    /const \{ header, body \} = exportRows\(visible, rows\);/.test(gridSrc), true);
  check("F. Salary Entry exports the TA column from the same rows",
    /\{ key: "ta", label: "TA" \}/.test(pageSrc), true);
  check("F. Approval never recomputes TA for display",
    /ta: toNum\(row\.TA\)/.test(approvalSrc), true);
  check("F. Approval has no TA master lookup at all",
    /TransportAllowanceMaster/.test(approvalSrc), false);

  /* ---------------- Other allowances untouched ---------------- */
  section("Other allowances are unchanged by this fix");

  const before = entryRow(MANUAL_TA, { taManual: true });
  check("DA unchanged", savedA.da, before.da);
  check("HRA unchanged", savedA.hra, before.hra);
  check("MA unchanged", savedA.ma, before.ma);
  check("CLA unchanged", savedA.cla, before.cla);
  check("NPS unchanged", savedA.nps, before.nps);
  check("Basic unchanged", savedA.basicPay, before.basicPay);
  /* One definition + exactly two call sites (normalize, and the save path). */
  check("only TA is special-cased in the save path",
    (entrySrc.match(/isManualTa\(/g) || []).length, 3);
  check("no other allowance is overwritten from a master on save",
    /ma: \w+Calc\.earnings\.ma|cla: \w+Calc\.earnings\.cla/.test(entrySrc), false);

  /* ---------------- Wiring ---------------- */
  section("Wiring — the flag actually travels end to end");

  check("typing in the TA cell marks it manual",
    /if \(field === "ta"\) \{\s*next\.taManual = true;/.test(pageSrc), true);
  check("a Basic Pay edit clears it", /taManual: false,/.test(pageSrc), true);
  check("the master TA refresh clears it",
    /ta: toNumber\(result\?\.data\?\.ta\),[\s\S]{0,120}taManual: false/.test(pageSrc), true);
  check("the save payload carries it",
    /taManual: Boolean\(calculated\.taManual\)/.test(pageSrc), true);
  check("the save path stops overwriting a manual TA",
    /ta: taManual \? row\.ta : taCalc\.earnings\.ta/.test(entrySrc), true);
  check("the flag is written to the database",
    /SET TAManual = \$\{mapped\.taManual \? 1 : 0\}/.test(entrySrc), true);
  check("the write is skipped when migration 46 is not yet applied",
    /if \(await hasTaManualColumn\(\)\)/.test(entrySrc), true);
  check("the stored flag is read back into the grid",
    /taManual: Boolean\(dbRow\.TAManual\)/.test(entrySrc), true);

  console.log(`\n${"=".repeat(74)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(74));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
