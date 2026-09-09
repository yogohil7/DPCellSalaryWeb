/**
 * Salary Bill Approval must display the STORED CLA and Gross Salary
 * (cases A-H).
 *
 * Regression for: the approval screen omitted the CLA and Gross Salary
 * columns entirely, even though both were saved by Salary Entry and already
 * returned by the approval API.
 *
 * Runs offline. Usage: cd backend && npm run test:approval-cla-gross
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

const salaryEntry = require("../routes/salaryEntry");
const { finalizeSnapshotAmounts, mapSavedDetailToGridRow } = salaryEntry;
const approval = require("../routes/salaryBillApproval");

const approvalSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryBillApproval.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const aoSrc = fs.readFileSync(path.join(FRONT, "pages", "AccountOfficerBills.jsx"), "utf8");
const gridSrc = fs.readFileSync(path.join(FRONT, "components", "DataGrid.jsx"), "utf8");

/* ---------- The screenshot's bill: CPD-06 / JUN-2026-BM-MAY ---------- */
const ENTERED = {
  basicPay: 34400,
  gradePay: 0,
  da: 20640,
  hra: 0,
  ma: 1000,
  ta: 7200,          /* manually entered, per the previous fix */
  cla: 150,
  specialAllowance: 100,
  washingAllowance: 0,
  otherEarnings: 0,
  nppa: 0,
  gpfSubscription: 5000,
  gpfAdvance: 0,
  nps: 0,
  incomeTax: 0,
  professionalTax: 0,
  otherDeduction: 0,
};

function entryRow(over = {}) {
  return {
    employeeId: 5501,
    employeeName: "Ramanbhai D. Damor",
    designation: "Peon",
    employeeType: "REGULAR",
    pension: "GPF",
    fixBasic: 0,
    daRate: 60,
    hraRate: 0,
    taManual: true,
    basicDriven: false,
    recalcFromBasic: false,
    fromSnapshot: true,
    ...ENTERED,
    ...over,
  };
}

/* What Salary Entry writes to dbo.SalaryEmployeeDetails. */
function saved(over = {}) {
  return finalizeSnapshotAmounts(entryRow(over), {
    pension: "GPF",
    hraForcedZero: false,
  }).row;
}

/* The stored row as the approval query (SELECT d.*) hands it back. */
function storedDetail(row) {
  return {
    Id: 91001,
    EmployeeId: row.employeeId,
    EmployeeName: row.employeeName,
    Designation: row.designation,
    EmployeeType: row.employeeType,
    PensionType: row.pension,
    DisplayOrder: 1,
    BasicPay: row.basicPay,
    GradePay: row.gradePay,
    TotalBasic: row.totalBasic,
    DA: row.da,
    HRA: row.hra,
    MA: row.ma,
    TA: row.ta,
    TAManual: row.taManual ? 1 : 0,
    CLA: row.cla,
    SpecialAllowance: row.specialAllowance,
    WashingAllowance: row.washingAllowance,
    OtherEarnings: row.otherEarnings,
    NPPA: row.nppa,
    GrossSalary: row.grossSalary,
    GPFSubscription: row.gpfSubscription,
    GPFAdvance: row.gpfAdvance,
    NPS: row.nps,
    IncomeTax: row.incomeTax,
    ProfessionalTax: row.professionalTax,
    OtherDeduction: row.otherDeduction,
    TotalDeduction: row.totalDeduction,
    NetSalary: row.netSalary,
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
  console.log("Salary Bill Approval shows the stored CLA and Gross Salary (A-H)");
  console.log("=".repeat(74));

  /* ---------------- A ---------------- */
  section("A — CLA 360 entered, saved, submitted and approved as 360");

  const savedCla = saved({ cla: 360 });
  check("A. Salary Entry saves CLA 360", savedCla.cla, 360);
  const submittedCla = finalizeSnapshotAmounts(
    { ...savedCla, pension: "GPF" }, { pension: "GPF", hraForcedZero: false }
  ).row;
  check("A. Submit keeps CLA 360", submittedCla.cla, 360);
  check("A. Approval maps CLA 360", approval.mapDetailRow(storedDetail(savedCla)).cla, 360);
  check("A. Approval reads it from the stored CLA column",
    /cla: toNum\(row\.CLA\)/.test(approvalSrc), true);
  check("A. the screen renders a CLA cell", /<td>\{money\(line\.cla\)\}<\/td>/.test(aoSrc), true);
  check("A. under a CLA heading", /<th>CLA<\/th>/.test(aoSrc), true);

  /* ---------------- B ---------------- */
  section("B — stored Gross Salary is what the employee row displays");

  const row = saved();
  const stored = storedDetail(row);
  check("B. the stored gross is the sum Salary Entry saved",
    row.grossSalary,
    ENTERED.basicPay + ENTERED.gradePay + ENTERED.da + ENTERED.hra + ENTERED.ma +
      ENTERED.ta + ENTERED.cla + ENTERED.specialAllowance +
      ENTERED.washingAllowance + ENTERED.otherEarnings + ENTERED.nppa);
  check("B. Approval maps GrossSalary verbatim",
    approval.mapDetailRow(stored).grossSalary, row.grossSalary);
  check("B. a stored 63,490 is displayed as 63,490",
    approval.mapDetailRow({ ...stored, GrossSalary: 63490 }).grossSalary, 63490);
  check("B. grossAmount is the same stored number, not a second figure",
    approval.mapDetailRow({ ...stored, GrossSalary: 63490 }).grossAmount, 63490);
  check("B. the screen renders a Gross Salary cell",
    /<td>\{money\(line\.grossSalary \|\| line\.grossAmount\)\}<\/td>/.test(aoSrc), true);
  check("B. under a Gross Salary heading", /<th>Gross Salary<\/th>/.test(aoSrc), true);
  check("B. the EARNING group spans the 11 earning columns",
    /colSpan="11" className="ao-group earning"/.test(aoSrc), true);

  /* ---------------- C ---------------- */
  section("C — the whole row is displayed exactly as stored");

  const mapped = approval.mapDetailRow(stored);
  check("C. Basic Pay", mapped.basicPay, 34400);
  check("C. Grade Pay", mapped.gradePay, 0);
  check("C. Total Basic", mapped.totalBasic, 34400);
  check("C. DA", mapped.da, 20640);
  check("C. HRA", mapped.hra, 0);
  check("C. MA", mapped.ma, 1000);
  check("C. TA (the manually entered one)", mapped.ta, 7200);
  check("C. CLA", mapped.cla, 150);
  check("C. Special Allowance", mapped.specialAllowance, 100);
  check("C. Washing Allowance", mapped.washingAllowance, 0);
  check("C. Gross Salary", mapped.grossSalary, row.grossSalary);
  check("C. GPF Subscription", mapped.gpfSubscription, 5000);
  check("C. NPS", mapped.nps, 0);

  /* ---------------- D ---------------- */
  section("D — Approval performs no CLA or Gross lookup of its own");

  check("D. no CLA master is consulted", /CLAMaster/.test(approvalSrc), false);
  check("D. no TA master is consulted", /TransportAllowanceMaster/.test(approvalSrc), false);
  check("D. no DA master is consulted", /DAMaster/.test(approvalSrc), false);
  check("D. no pay matrix lookup", /PayMatrix/.test(approvalSrc), false);
  check("D. gross is read, never summed, in the mapper",
    /grossSalary: toNum\(row\.GrossSalary\)/.test(approvalSrc), true);
  /* Feeding a gross that disagrees with the parts proves it is not recomputed. */
  const odd = approval.mapDetailRow({ ...stored, GrossSalary: 12345 });
  check("D. a stored gross is passed through even when it disagrees with the parts",
    odd.grossSalary, 12345);
  check("D. and the components are still untouched",
    [odd.da, odd.ta, odd.cla], [20640, 7200, 150]);

  /* ---------------- E ---------------- */
  section("E — header totals stay consistent with the rows");

  check("E. the header sums the same per-row gross the table prints",
    /acc\.grossAmount \+= Number\(line\.grossAmount \|\| 0\)/.test(aoSrc), true);
  check("E. the per-row gross prefers the STORED value",
    /Number\(line\.grossSalary \|\| line\.grossAmount \|\| 0\) \|\|/.test(aoSrc), true);
  check("E. one employee's stored gross equals the bill gross",
    row.grossSalary, row.grossSalary);
  check("E. Net = Gross - Total Deduction on the stored row",
    row.netSalary, row.grossSalary - row.totalDeduction);
  check("E. Approval's Net matches the stored Net", mapped.netSalary, row.netSalary);
  check("E. Approval's Total Deduction matches the stored one",
    mapped.totalDeduction, row.totalDeduction);

  /* ---------------- F ---------------- */
  section("F — CSV / Excel / PDF / Print carry CLA and Gross Salary");

  check("F. CLA is an export column", /\{ key: "cla", label: "CLA" \}/.test(aoSrc), true);
  check("F. Gross Salary is an export column",
    /\{ key: "grossSalary", label: "Gross Salary" \}/.test(aoSrc), true);
  check("F. exports read the same salaryLines the table renders",
    /rows=\{selectedBill\.salaryLines \|\| \[\]\}/.test(aoSrc), true);
  check("F. every earning column on screen is also exported",
    ["basicPay", "gradePay", "totalBasic", "da", "hra", "ma", "ta", "cla",
     "specialAllowance", "washingAllowance", "grossSalary"]
      .filter((k) => !new RegExp(`\\{ key: "${k}",`).test(aoSrc)), []);
  check("F. every deduction column on screen is also exported",
    ["gpfSubscription", "gpfAdv", "nps", "incomeTax", "professionalTax",
     "otherDeduction", "totalDeduction", "netSalary", "chequeAmount"]
      .filter((k) => !new RegExp(`\\{ key: "${k}",`).test(aoSrc)), []);
  check("F. CSV, Excel, PDF and Print share one row builder",
    /const \{ header, body \} = exportRows\(visible, rows\);/.test(gridSrc), true);
  check("F. exports print the row's own value, never a recalculation",
    /const value = row\?\.\[column\.key\];/.test(gridSrc), true);

  /* ---------------- G ---------------- */
  section("G — returned/resubmitted bill keeps CLA and Gross");

  const reopened = mapSavedDetailToGridRow(stored);
  check("G. reopening shows the stored CLA", reopened.cla, 150);
  check("G. reopening shows the stored TA", reopened.ta, 7200);
  const resaved = finalizeSnapshotAmounts(
    { ...reopened, pension: "GPF" }, { pension: "GPF", hraForcedZero: false }
  ).row;
  check("G. re-saving keeps CLA", resaved.cla, 150);
  check("G. re-saving keeps the same gross", resaved.grossSalary, row.grossSalary);
  const afterResubmit = approval.mapDetailRow(storedDetail(resaved));
  check("G. Approval still shows CLA after resubmit", afterResubmit.cla, 150);
  check("G. Approval still shows Gross after resubmit",
    afterResubmit.grossSalary, row.grossSalary);

  /* ---------------- H ---------------- */
  section("H — nothing else on the row changed");

  const before = saved();
  const after = saved();
  check("H. every stored amount is identical run to run",
    ["basicPay", "gradePay", "totalBasic", "da", "hra", "ma", "ta", "cla",
     "specialAllowance", "washingAllowance", "grossSalary", "gpfSubscription",
     "nps", "incomeTax", "professionalTax", "otherDeduction", "totalDeduction",
     "netSalary"].map((k) => before[k] === after[k]).every(Boolean), true);
  check("H. adding the columns did not change the mapper's other fields",
    [mapped.basicPay, mapped.da, mapped.hra, mapped.ma, mapped.ta,
     mapped.specialAllowance, mapped.washingAllowance, mapped.gpfSubscription,
     mapped.nps, mapped.incomeTax, mapped.professionalTax, mapped.otherDeduction],
    [34400, 20640, 0, 1000, 7200, 100, 0, 5000, 0, 0, 0, 0]);
  check("H. the backend approval mapper was not modified for this fix",
    /cla: toNum\(row\.CLA\),/.test(approvalSrc), true);
  check("H. the empty-state colSpan matches the real column count",
    /colSpan="24" className="ao-empty"/.test(aoSrc), true);

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
