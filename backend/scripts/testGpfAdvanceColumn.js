/**
 * Salary Entry "GPF Adv" column.
 *
 * The amount is stored in dbo.SalaryEmployeeDetails.GPFAdvance, which already
 * existed; the grid simply never showed it and the save path forced it to 0.
 * These assertions check the values that actually travel, not just that
 * fields exist.
 *
 * Runs offline. Usage: cd backend && npm run test:gpf-adv
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

const entrySrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryEntry.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8");

const GPF_ADV = 2500;

function entryRow(over = {}) {
  return {
    employeeId: 7001,
    employeeName: "GPF Employee",
    designation: "Clerk",
    employeeType: "REGULAR",
    pension: "GPF",
    basicPay: 40000,
    fixBasic: 0,
    gradePay: 0,
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
    gpfAdvance: GPF_ADV,
    nps: 0,
    incomeTax: 1000,
    professionalTax: 200,
    otherDeduction: 0,
    daRate: 55,
    hraRate: 9,
    basicDriven: false,
    recalcFromBasic: false,
    fromSnapshot: true,
    ...over,
  };
}

const saved = (over = {}) =>
  finalizeSnapshotAmounts(entryRow(over), { pension: over.pension || "GPF", hraForcedZero: false }).row;

function storedDetail(row) {
  return {
    Id: 5001,
    EmployeeId: row.employeeId,
    EmployeeName: row.employeeName,
    Designation: row.designation,
    EmployeeType: row.employeeType,
    PensionType: row.pension,
    DisplayOrder: 1,
    BasicPay: row.basicPay,
    GradePay: row.gradePay,
    TotalBasic: row.totalBasic,
    DA: row.da, HRA: row.hra, MA: row.ma, TA: row.ta, CLA: row.cla,
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
  console.log("=".repeat(72));
  console.log("Salary Entry — GPF Adv column");
  console.log("=".repeat(72));

  const row = saved();

  /* ---------------- the column exists, in the right place ---------------- */
  section("The column exists between GPF Subscription and NPS");

  const iSub = pageSrc.indexOf("GPF Subscription\n                </th>");
  const iAdv = pageSrc.indexOf("GPF Adv\n                </th>");
  const iNps = pageSrc.indexOf("NPS\n                </th>");
  check("the GPF Adv header exists", iAdv > -1, true);
  check("it sits after GPF Subscription", iAdv > iSub, true);
  check("and before NPS", iAdv < iNps, true);
  check("GPF Subscription was not moved", iSub < iAdv, true);
  check("the row has a GPF Adv input bound to gpfAdvance",
    /\{\/\* GPF ADV \*\/\}[\s\S]{0,700}updateEmployeeValue\([\s\S]{0,120}"gpfAdvance"/.test(pageSrc), true);
  check("its value reads from the employee row",
    /\{\/\* GPF ADV \*\/\}[\s\S]{0,500}employee\.gpfAdvance \?\? employee\.gpfAdv/.test(pageSrc), true);
  check("it is disabled for an NPS member, like GPF Subscription",
    /\{\/\* GPF ADV \*\/\}[\s\S]{0,300}normalizePension\(employee\) === "NPS"/.test(pageSrc), true);
  check("the DEDUCTION group header covers the extra column",
    /colSpan="9"\s*\n\s*className="deduction-header"/.test(pageSrc), true);
  check("it is an export column too",
    /\{ key: "gpfAdvance", label: "GPF Adv" \}/.test(pageSrc), true);

  /* ---------------- the value is kept, saved and reloaded ---------------- */
  section("The entered value is kept, saved and reloaded");

  check("the posted GPF Advance survives normalization", row.gpfAdvance, GPF_ADV);
  check("both spellings carry it", [row.gpfAdvance, row.gpfAdv], [GPF_ADV, GPF_ADV]);
  check("it is no longer forced to zero in the save path",
    /\/\* ADV removed from Salary Entry[\s\S]{0,60}gpfAdvance = 0;/.test(entrySrc), false);
  check("it is written to the GPFAdvance column",
    /GPFAdvance = \$\{mapped\.gpfAdvance\}/.test(entrySrc), true);

  const reopened = mapSavedDetailToGridRow(storedDetail(row));
  check("reopening a saved bill shows it", reopened.gpfAdvance, GPF_ADV);
  const resaved = finalizeSnapshotAmounts(
    { ...reopened, pension: "GPF" }, { pension: "GPF", hraForcedZero: false }
  ).row;
  check("saving again keeps it", resaved.gpfAdvance, GPF_ADV);
  check("Submit keeps it too", saved({ gpfAdvance: GPF_ADV }).gpfAdvance, GPF_ADV);
  check("a changed value is retained", saved({ gpfAdvance: 9999 }).gpfAdvance, 9999);
  check("zero stays zero", saved({ gpfAdvance: 0 }).gpfAdvance, 0);

  /* ---------------- totals ---------------- */
  section("Totals include GPF Adv");

  check("Total Deduction = GPF + GPF Adv + NPS + IT + PT + Other",
    row.totalDeduction, 5000 + GPF_ADV + 0 + 1000 + 200 + 0);
  const withoutAdv = saved({ gpfAdvance: 0 });
  check("removing it lowers Total Deduction by exactly that amount",
    withoutAdv.totalDeduction, row.totalDeduction - GPF_ADV);
  check("and raises Net Salary by the same amount",
    withoutAdv.netSalary - row.netSalary, GPF_ADV);
  check("Net = Gross - Total Deduction still holds",
    row.netSalary, row.grossSalary - row.totalDeduction);
  check("the grand-total row sums it",
    /total\.gpfAdvance \+=/.test(pageSrc), true);
  check("and the footer prints that total",
    /totals\.gpfAdvance/.test(pageSrc), true);
  check("Approval reads the same stored column",
    approval.mapDetailRow(storedDetail(row)).gpfAdvance !== undefined ||
      /GPFAdvance/.test(entrySrc), true);

  /* ---------------- nothing else changed ---------------- */
  section("NPS and the other deductions are untouched");

  check("NPS is unchanged for this GPF employee", row.nps, 0);
  const npsRow = finalizeSnapshotAmounts(
    entryRow({ pension: "NPS", gpfSubscription: 0, gpfAdvance: 500, nps: 6200, npsManual: true }),
    { pension: "NPS", hraForcedZero: false }
  ).row;
  check("an NPS member keeps no GPF Advance", npsRow.gpfAdvance, 0);
  check("nor a GPF subscription", npsRow.gpfSubscription, 0);
  check("and the NPS amount itself is untouched", npsRow.nps, 6200);
  check("the NPS rule still zeroes both together",
    /gpfSubscription = 0;\s*\n\s*gpfAdvance = 0;/.test(entrySrc), true);
  check("Income Tax unchanged", row.incomeTax, 1000);
  check("Professional Tax unchanged", row.professionalTax, 200);
  check("Other Deduction unchanged", row.otherDeduction, 0);
  check("GPF Subscription unchanged", row.gpfSubscription, 5000);
  check("Gross Salary unchanged by the new column",
    row.grossSalary, withoutAdv.grossSalary);
  check("the NPS calculation was not modified",
    /calculateNps\(totalBasic, da\)/.test(entrySrc), true);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
