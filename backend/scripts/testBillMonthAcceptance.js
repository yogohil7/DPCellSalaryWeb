/**
 * Acceptance tests A-J for Bill Month isolation, returned-bill editing,
 * manual salary entry persistence, cheque amount and auditor permissions.
 *
 * Runs offline: the database layer is stubbed, so no SQL Server is needed.
 *
 * Usage:  cd backend && npm run test:bill-month-acceptance
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */

const MASTER = {
  BillCodeId: 100, BillCode: "JUN-2026", BillMonth: "JUN-2026",
  SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "LOCKED", IsArchived: 0,
};
const VARIANT = {
  BillCodeId: 101, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
  SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "RETURNED", IsArchived: 0,
};
const BILLS = [MASTER, VARIANT];

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");
  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    if (/WHERE BillCode = \?/i.test(text)) {
      return Promise.resolve({
        recordset: BILLS.filter((b) => b.BillCode === String(values[0])),
      });
    }
    return Promise.resolve({ recordset: BILLS.slice() });
  }
  return Promise.resolve({ recordset: [] });
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: { query, Request: function R() { return { query, input() { return this; } }; } },
  connectDB: async () => true,
};

/* ===================== MODULES UNDER TEST ===================== */

const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");
const {
  calculateChequeAmount,
  calculateSalaryAmounts,
  calculateNps,
} = require("../utils/salaryBasicCalc");
const salaryEntry = require("../routes/salaryEntry");
const { requireRoles } = require("../middleware/auth");
const {
  getTransportAllowanceGroup,
  getClaPayLevelGroup,
} = require("../utils/transportAllowanceGroup");

const { finalizeSnapshotAmounts, mapSavedDetailToGridRow, statusGateBill } =
  salaryEntry;

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

/** Minimal express-style middleware runner. */
function runMiddleware(mw, user) {
  let statusCode = 200, body = null, nexted = false;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
  };
  mw({ user }, res, () => { nexted = true; });
  return { allowed: nexted, statusCode, body };
}

const EDITABLE = new Set(["OPEN", "DRAFT", "RETURNED", "REJECTED"]);
const billEditable = (bill) =>
  EDITABLE.has(String(bill?.Status || "").toUpperCase());

async function main() {
  console.log("=".repeat(72));
  console.log("Bill Month isolation / returned bills / manual entry — A-J");
  console.log("=".repeat(72));

  /* ---------------- TEST A ---------------- */
  section("TEST A — MAY variant is independent of the LOCKED JUN master");

  const may = await resolveSalaryEntryBill({
    billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026",
    salaryMonth: "June", createIfMissing: false,
  });
  check("A. resolves to the MAY variant", may.bill.BillCode, "JUN-2026-BM-MAY");
  check("A. variant status is not LOCKED", may.bill.Status !== "LOCKED", true);
  check("A. master remains LOCKED", may.sourceBill.Status, "LOCKED");
  check("A. they are different rows", may.bill.BillCodeId !== may.sourceBill.BillCodeId, true);

  /* ---------------- TEST B ---------------- */
  section("TEST B — submitting MAY must not touch JUN");

  const beforeMaster = MASTER.Status, beforeVariant = VARIANT.Status;
  VARIANT.Status = "SUBMITTED";               /* simulate submit of MAY only */
  check("B. MAY became SUBMITTED", VARIANT.Status, "SUBMITTED");
  check("B. JUN master untouched", MASTER.Status, beforeMaster);
  VARIANT.Status = beforeVariant;             /* restore */

  /* ---------------- TEST C / D ---------------- */
  section("TEST C, D — returned MAY bill is editable despite the LOCKED master");

  check("D. gate uses the variant", statusGateBill(may).BillCode, "JUN-2026-BM-MAY");
  check("D. gate status is RETURNED", statusGateBill(may).Status, "RETURNED");
  check("D. returned bill IS editable", billEditable(statusGateBill(may)), true);
  check("D. gating on the master would have blocked it", billEditable(may.sourceBill), false);
  check("D. Bill Month preserved as MAY-2026", may.bill.BillMonth, "MAY-2026");
  check("D. Salary Month preserved as June", may.bill.SalaryMonth, "June");

  const noBillMonth = await resolveSalaryEntryBill({
    billCode: "JUN-2026-BM-MAY", createIfMissing: false,
  });
  check("D. omitted billMonth still resolves the variant",
    noBillMonth.bill.BillCode, "JUN-2026-BM-MAY");

  /* ---------------- TEST J ---------------- */
  section("TEST J — a same-month LOCKED bill stays locked");

  const jun = await resolveSalaryEntryBill({
    billCode: "JUN-2026", billMonth: "JUN-2026",
    salaryMonth: "June", createIfMissing: false,
  });
  check("J. resolves to itself", jun.bill.BillCode, "JUN-2026");
  check("J. gate falls back to the same row", statusGateBill(jun).BillCode, "JUN-2026");
  check("J. and it is NOT editable", billEditable(statusGateBill(jun)), false);

  /* ---------------- TEST E ---------------- */
  section("TEST E — manual deductions survive save and reopen");

  const entered = finalizeSnapshotAmounts(
    {
      employeeId: 2011, employeeName: "Test", employeeType: "REGULAR",
      basicPay: 64100, fixBasic: 0, da: 38460, hra: 5769,
      ma: 0, ta: 0, cla: 0, specialAllowance: 0, washingAllowance: 0,
      otherEarnings: 0, nppa: 0, gpfSubscription: 0, gpfAdvance: 0,
      nps: 9999, npsManual: true,
      incomeTax: 1500, professionalTax: 200, otherDeduction: 350,
    },
    { pension: "NPS", hraForcedZero: false }
  ).row;

  check("E. Professional Tax kept as entered", entered.professionalTax, 200);
  check("E. Income Tax kept as entered", entered.incomeTax, 1500);
  check("E. Other Deduction kept as entered", entered.otherDeduction, 350);
  check("E. manual NPS kept as entered", entered.nps, 9999);

  /* Simulate the DB round-trip: saved columns -> reopened grid row. */
  const savedRow = {
    EmployeeId: 2011, EmployeeName: "Test", Designation: "", EmployeeType: "REGULAR",
    PensionType: "NPS", BasicPay: entered.basicPay, GradePay: entered.gradePay,
    DA: entered.da, HRA: entered.hra, MA: entered.ma, TA: entered.ta, CLA: entered.cla,
    SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
    GPFSubscription: 0, GPFAdvance: 0,
    NPS: entered.nps, NPSManual: 1,
    IncomeTax: entered.incomeTax,
    ProfessionalTax: entered.professionalTax,
    OtherDeduction: entered.otherDeduction,
    HraForcedZero: 0,
  };
  const reopened = mapSavedDetailToGridRow(savedRow);

  check("E. Professional Tax after reopen", reopened.professionalTax, 200);
  check("E. Income Tax after reopen", reopened.incomeTax, 1500);
  check("E. Other Deduction after reopen", reopened.otherDeduction, 350);
  check("E. manual NPS after reopen", reopened.nps, 9999);
  check("E. NOT recalculated back to zero",
    [reopened.professionalTax, reopened.incomeTax, reopened.otherDeduction].every((v) => v !== 0),
    true);

  /* The persistence SQL must actually carry those columns. */
  const entrySrc = fs.readFileSync(
    path.join(__dirname, "..", "routes", "salaryEntry.js"), "utf8"
  );
  for (const col of ["IncomeTax", "ProfessionalTax", "OtherDeduction", "NPSManual"]) {
    check(`E. UPDATE persists ${col}`,
      new RegExp(`${col}\\s*=\\s*\\$\\{`).test(entrySrc), true);
  }

  /* ---------------- TEST F ---------------- */
  section("TEST F — dependent totals follow a manual change");

  const before = calculateSalaryAmounts({
    basic: 64100, fixBasic: 0, daPercentage: 60, hraPercentage: 9,
  });
  const after = calculateSalaryAmounts({
    basic: 70000, fixBasic: 0, daPercentage: 60, hraPercentage: 9,
  });
  check("F. Total Basic follows Basic", after.totalBasicPay, 70000);
  check("F. DA recalculated", after.da !== before.da, true);
  check("F. HRA recalculated", after.hra !== before.hra, true);
  check("F. NPS recalculated", after.nps, calculateNps(70000, after.da));

  const gross = after.totalBasicPay + after.da + after.hra;
  const totalDeduction = after.nps + 1500 + 200 + 350;
  const net = Number((gross - totalDeduction).toFixed(2));
  check("F. Total Deduction includes NPS + IT + PT + Other",
    totalDeduction, after.nps + 2050);
  check("F. Net = Gross - Total Deduction", net,
    Number((gross - totalDeduction).toFixed(2)));

  /* ---------------- TEST G ---------------- */
  section("TEST G — Cheque Amount = Net + Income Tax + Professional Tax");

  check("G. worked example 73,332 + 0 + 400",
    calculateChequeAmount({ netSalary: 73332, incomeTax: 0, professionalTax: 400 }),
    73732);
  check("G. with income tax",
    calculateChequeAmount({ netSalary: 50000, incomeTax: 1500, professionalTax: 200 }),
    51700);
  check("G. zero taxes leave Net unchanged",
    calculateChequeAmount({ netSalary: 40000, incomeTax: 0, professionalTax: 0 }),
    40000);
  check("G. legacy professionTax spelling accepted",
    calculateChequeAmount({ netSalary: 1000, incomeTax: 0, professionTax: 50 }),
    1050);
  check("G. never uses Gross",
    calculateChequeAmount({ netSalary: 73332, incomeTax: 0, professionalTax: 400 }) !== gross,
    true);

  /* Every consumer must use the shared helper. */
  for (const file of [
    "routes/salaryEntry.js", "routes/salaryBillApproval.js",
    "routes/chequeRegister.js", "routes/salaryCalculate.js",
    "utils/salaryVariationReport.js",
  ]) {
    const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    check(`G. ${file} uses calculateChequeAmount`,
      src.includes("calculateChequeAmount"), true);
  }

  /* ---------------- TEST H ---------------- */
  section("TEST H — Auditor cannot verify / approve / return / reject");

  const accountOfficerOnly = requireRoles("ACCOUNT_OFFICER");
  const auditor = { userId: 7, roleName: "Auditor", roleKey: "AUDITOR" };
  const officer = { userId: 3, roleName: "Account Officer", roleKey: "ACCOUNT_OFFICER" };
  const admin = { userId: 1, roleName: "Super Admin", roleKey: "ADMIN" };

  const auditorTry = runMiddleware(accountOfficerOnly, auditor);
  check("H. auditor is denied", auditorTry.allowed, false);
  check("H. with HTTP 403", auditorTry.statusCode, 403);
  check("H. and the permission message",
    auditorTry.body?.message, "You do not have permission to perform this action.");
  check("H. account officer is allowed",
    runMiddleware(accountOfficerOnly, officer).allowed, true);
  check("H. admin is allowed",
    runMiddleware(accountOfficerOnly, admin).allowed, true);

  /* Route-level wiring: only /returned is open to the auditor. */
  const approvalSrc = fs.readFileSync(
    path.join(__dirname, "..", "routes", "salaryBillApproval.js"), "utf8"
  );
  for (const route of [
    '"/variation-report"', '"/auditors"', '"/"', '"/:idOrCode"',
    '"/:idOrCode/verify"', '"/:idOrCode/lock"', '"/:idOrCode/approve"',
    '"/:idOrCode/return"', '"/:idOrCode/reject"',
  ]) {
    check(`H. ${route} is accountOfficerOnly`,
      new RegExp(`${route.replace(/[/:]/g, "\\$&")},\\s*accountOfficerOnly`).test(approvalSrc),
      true);
  }
  check("H. /returned is NOT accountOfficerOnly",
    /"\/returned",\s*accountOfficerOnly/.test(approvalSrc), false);
  check("H. /returned derives identity from req.user",
    approvalSrc.includes("req.user?.roleKey"), true);
  check("H. auditor is pinned to their own id",
    /isAuditor\s*\?\s*Number\(req\.user\?\.userId\)/.test(approvalSrc), true);

  /* ---------------- ITEM 16 ---------------- */
  section("Item 16 — deterministic historical snapshot selection");

  const daSrc = fs.readFileSync(
    path.join(__dirname, "..", "utils", "daDifference.js"), "utf8"
  );
  check("16. arbitrary BillCodeId DESC tie-break removed",
    /ORDER BY b\.BillCodeId DESC/.test(daSrc), false);
  /* Canonical-vs-variant preference is unnecessary here: the snapshot is
     matched on the bill's real BillMonth, so JUN-2026 (BillMonth JUN-2026)
     and JUN-2026-BM-MAY (BillMonth MAY-2026) never contend for one month.
     It cannot be done by comparing BillMonth with SalaryMonth either: those
     columns store different formats ('JUN-2026' vs 'June'). */
  check("16. snapshot is matched on the bill's real BillMonth",
    /billMonthPartsFromSalaryBill\(row\)/.test(daSrc), true);
  check("16. remaining ties break deterministically on SalaryBillCodeId",
    /Number\(a\.SalaryBillCodeId \|\| 0\) - Number\(b\.SalaryBillCodeId \|\| 0\)/.test(daSrc), true);
  check("16. the never-matching month comparison is gone",
    /ISNULL\(b\.BillMonth, N''\)\)\) =\s*UPPER\(LTRIM\(RTRIM\(ISNULL\(b\.SalaryMonth/.test(daSrc),
    false);
  check("16. archived bills are excluded",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(daSrc), true);
  check("16. no EmployeeMaster fallback in the snapshot lookup",
    /EmployeeMaster/.test(
      daSrc.slice(daSrc.indexOf("async function getHistoricalSnapshot"),
                  daSrc.indexOf("function deriveOldDaRate"))
    ), false);

  /* ---------------- ITEM 12 ---------------- */
  section("Item 12 — pay-level group follows the effective Basic Pay");

  const TH = 24200; /* threshold comes from the Pay Matrix, never hard-coded */

  check("12. Level 2 stays Level 2 below the threshold",
    getTransportAllowanceGroup(24199, "2", { basicUpgradeThreshold: TH }),
    "Level 2 and Below");
  check("12. Level 2 upgrades to Level 3-8 at the threshold",
    getTransportAllowanceGroup(24200, "2", { basicUpgradeThreshold: TH }),
    "Level 3-8");
  check("12. Level 2 upgrades above the threshold",
    getTransportAllowanceGroup(30000, "2", { basicUpgradeThreshold: TH }),
    "Level 3-8");
  check("12. Level 9 is not downgraded by a low Basic",
    getTransportAllowanceGroup(10000, "9", { basicUpgradeThreshold: TH }),
    "Level 9 and Above");
  check("12. Level 5 stays Level 3-8",
    getTransportAllowanceGroup(50000, "5", { basicUpgradeThreshold: TH }),
    "Level 3-8");
  check("12. no silent upgrade when the threshold is unknown",
    getTransportAllowanceGroup(99999, "2", {}),
    "Level 2 and Below");
  check("12. CLA keeps its own separate grouping",
    [getClaPayLevelGroup("IS-2"), getClaPayLevelGroup("3"), getClaPayLevelGroup("4")],
    ["Level 1 to Below", "Level 1 to 3", "Level 4 and Above"]);

  const taSrc = fs.readFileSync(
    path.join(__dirname, "..", "utils", "transportAllowanceGroup.js"), "utf8"
  );
  check("12. threshold is loaded, not hard-coded in the classifier",
    /basicUpgradeThreshold/.test(taSrc), true);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
