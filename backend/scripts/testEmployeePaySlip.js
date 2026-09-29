/*
  EMPLOYEE PAY SLIP.

  Every amount on the slip must be the STORED value from
  dbo.SalaryEmployeeDetails — nothing recomputed, nothing invented, and no
  field outside the Salary Entry grid.

  Runs offline: the db module is stubbed and the shared loader's SQL is
  replaced with a fixture, so the real buildPaySlip / filterRows pipeline is
  executed rather than pattern-matched.

  Usage: cd backend && npm run test:employee-pay-slip
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ---- db stub ---- */
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const paySlip = require("../routes/employeePaySlip");
const {
  buildPaySlip, filterRows, buildOptions,
  EARNING_LINES, DEDUCTION_LINES,
} = paySlip;

const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "employeePaySlip.js"), "utf8");
const ewsSrc = fs.readFileSync(path.join(ROOT, "routes", "employeeWiseSalary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
/*
   Executable route source with comments removed. The route's docblocks name
   the excluded fields (GPFNPS, NPPA, ChequeAmount, NPSAdvance, OtherEarnings)
   in order to explain WHY they are excluded, so a raw text search would match
   the prose rather than the code. These assertions test the code.
*/
const routeCode = routeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const FRONT = path.join(ROOT, "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "EmployeePaySlip.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "employeePaySlip.css"), "utf8");
const { amountInWordsIndian } = require("../utils/amountInWords");

/* ---- runner ---- */
let passed = 0, failed = 0;
const failures = [];
function section(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }
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

/* ---- fixture: a stored SalaryEmployeeDetails row as the loader returns it ---- */
function dbRow(over) {
  return {
    BillCodeId: 11, BillCode: "JUN-2026",
    BillMonth: "JUN-2026", SalaryMonth: "June",
    SalaryMonthNumber: "06", SalaryYear: "2026",
    BillCategory: "Salary", BillType: "Regular Salary",
    WorkflowStatus: "APPROVED", BillNo: "598", BillDate: "2026-07-22",
    NPSScheduleNo: "SCH/2026/06/001",
    InstituteCode: "CPD-06", InstituteName: "Gujarat State Probation",
    SectionId: 1, SectionName: "CPD",
    EmployeeId: 2002, EmployeeName: "Rambanbhai D. Damor",
    Designation: "Peon", EmployeeType: "REGULAR", PensionType: "GPF",
    DisplayOrder: 1,
    BankAccountNumber: "30129652277",
    BasicPay: 34400, GradePay: 1500, TotalBasic: 35900,
    DA: 20640, HRA: 0, MA: 1000, TA: 800, CLA: 0,
    SpecialAllowance: 0, WashingAllowance: 0,
    GrossSalary: 58740,
    GPFSubscription: 2000, GPFAdvance: 1200, NPS: 0,
    IncomeTax: 500, ProfessionalTax: 200, OtherDeduction: 100,
    TotalDeduction: 4000, NetSalary: 54740,
    /* Present in the table but NOT Salary Entry grid columns. */
    ChequeAmount: 54740, OtherEarnings: 999, NPPA: 888, NPSAdvance: 777,
    ...over,
  };
}

(function main() {
  console.log("=".repeat(76));
  console.log("EMPLOYEE PAY SLIP");
  console.log("=".repeat(76));

  const slip = buildPaySlip(dbRow());

  section("1-6. employee information");
  check("1. Employee ID", slip.employee.employeeId, 2002);
  check("2. Employee Name", slip.employee.employeeName, "Rambanbhai D. Damor");
  check("3. Designation", slip.employee.designation, "Peon");
  check("4. Employee Type", slip.employee.employeeType, "REGULAR");
  check("5. Pension comes from the PensionType snapshot",
    slip.employee.pension, "GPF");
  check("5. the current EmployeeMaster GPFNPS is NOT used",
    buildPaySlip(dbRow({ PensionType: "NPS", GPFNPS: "GPF" })).employee.pension, "NPS");
  check("5. the route never reads GPFNPS", /GPFNPS/.test(routeCode), false);
  check("6. Bank Account Number", slip.employee.bankAccountNumber, "30129652277");

  section("7-17. earnings come from their stored columns");
  const e = Object.fromEntries(slip.earnings.map((r) => [r.key, r.amount]));
  check("7. Basic <- BasicPay", e.basic, 34400);
  check("8. FixPay / Grade Pay <- GradePay", e.fixPay, 1500);
  check("10. Total Basic Pay <- TotalBasic", e.totalBasicPay, 35900);
  check("11. DA <- DA", e.da, 20640);
  check("12. HRA <- HRA", e.hra, 0);
  check("13. MA <- MA", e.ma, 1000);
  check("14. TA <- stored TA", e.ta, 800);
  check("15. CLA <- CLA", e.cla, 0);
  check("16. Special Allowance <- SpecialAllowance", e.specialAllowance, 0);
  check("17. Washing Allowance <- WashingAllowance", e.washingAllowance, 0);
  check("48. a manual TA override is preserved verbatim",
    Object.fromEntries(
      buildPaySlip(dbRow({ TA: 1234.56 })).earnings.map((r) => [r.key, r.amount])
    ).ta, 1234.56);

  section("18-26. totals and deductions are stored values");
  const d = Object.fromEntries(slip.deductions.map((r) => [r.key, r.amount]));
  check("18. Gross Salary <- GrossSalary, not a re-sum of the lines",
    [slip.grossSalary, slip.earnings.reduce((s, r) => s + r.amount, 0)],
    /* The line sum double-counts Basic and FixPay inside Total Basic Pay, so
       it deliberately differs from the stored Gross — which is the point. */
    [58740, 94240]);
  check("18. the two genuinely differ, proving no re-sum happened",
    slip.grossSalary === slip.earnings.reduce((s, r) => s + r.amount, 0), false);
  check("19. GPF Subscription <- GPFSubscription", d.gpfSubscription, 2000);
  check("20. GPF Advance <- GPFAdvance, never hard-coded 0", d.gpfAdvance, 1200);
  check("20. a non-zero GPF Advance survives", 
    Object.fromEntries(
      buildPaySlip(dbRow({ GPFAdvance: 5555 })).deductions.map((r) => [r.key, r.amount])
    ).gpfAdvance, 5555);
  check("21. NPS <- NPS", d.nps, 0);
  check("21. a non-zero NPS survives",
    Object.fromEntries(
      buildPaySlip(dbRow({ NPS: 3590 })).deductions.map((r) => [r.key, r.amount])
    ).nps, 3590);
  check("22. Income Tax <- IncomeTax", d.incomeTax, 500);
  check("23. Professional Tax <- ProfessionalTax", d.professionalTax, 200);
  check("24. Other Deduction <- OtherDeduction", d.otherDeduction, 100);
  check("25. Total Deduction <- TotalDeduction, not a re-sum",
    [slip.totalDeduction, slip.deductions.reduce((s, r) => s + r.amount, 0)],
    [4000, 4000]);
  check("26. Net Salary <- NetSalary", slip.netSalary, 54740);
  check("47. the stored totals win even when they disagree with the lines",
    (() => {
      const odd = buildPaySlip(dbRow({ GrossSalary: 1, TotalDeduction: 2, NetSalary: 3 }));
      return [odd.grossSalary, odd.totalDeduction, odd.netSalary];
    })(), [1, 2, 3]);
  check("47. no arithmetic derives the totals",
    /grossSalary[\s\S]{0,120}reduce|netSalary\s*=\s*[^;]*grossSalary\s*-/.test(routeCode), false);

  section("27. amount in words");
  check("27. words are of the NET salary",
    slip.netSalaryInWords, amountInWordsIndian(54740));
  check("27. not of the gross",
    slip.netSalaryInWords === amountInWordsIndian(58740), false);
  check("27. the shared utility is required",
    /require\("\.\.\/utils\/amountInWords"\)/.test(routeCode), true);
  check("27. and no second words utility is defined here",
    /function amountInWords|function .*InWords/.test(routeCode), false);

  section("28-31. REGULAR / OLD and month independence");
  check("28. a REGULAR bill is supported", slip.bill.salaryType, "REGULAR");
  check("28. its months agree",
    [slip.bill.salaryMonth, slip.bill.billMonth], ["JUNE 2026", "JUNE 2026"]);
  {
    const old = buildPaySlip(dbRow({
      BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
    }));
    check("29. an OLD bill is supported", old.bill.salaryType, "OLD");
    check("30-31. Salary Month JUNE, Bill Month MAY, both correct",
      [old.bill.salaryMonth, old.bill.billMonth], ["JUNE 2026", "MAY 2026"]);
    check("31. Bill Month is never substituted for Salary Month",
      old.bill.salaryMonth === old.bill.billMonth, false);
  }
  check("30. Bill Month is resolved by its own parser",
    /billMonthPartsOf\(/.test(routeSrc), true);

  section("32, 50. one employee, one bill, one slip — never merged");
  {
    const rows = [
      dbRow({ BillCodeId: 11, BillCode: "JUN-2026", BillMonth: "JUN-2026", NetSalary: 54740 }),
      dbRow({ BillCodeId: 12, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", NetSalary: 9000 }),
    ];
    const kept = filterRows(rows, { month: 6, year: 2026 });
    check("32. both bills of the salary month are returned", kept.length, 2);
    const slips = kept.map(buildPaySlip);
    check("32. as two separate slips, not one merged document",
      slips.map((s) => s.netSalary), [54740, 9000]);
    check("32. the amounts are never added together",
      slips.some((s) => s.netSalary === 63740), false);
    check("50. each slip names its own bill",
      slips.map((s) => s.bill.billCode), ["JUN-2026", "JUN-2026-BM-MAY"]);
    check("50. and its own Bill Month",
      slips.map((s) => s.bill.billMonth), ["JUNE 2026", "MAY 2026"]);
    check("32. selecting one bill yields exactly one slip",
      filterRows(rows, { billCodeId: 12 }).length, 1);
  }

  section("33-40. eligibility is enforced in SQL by the shared loader");
  check("37-38. only APPROVED and LOCKED are loaded",
    /IN \(N'APPROVED', N'LOCKED'\)/.test(ewsSrc), true);
  check("33-36. DRAFT, SUBMITTED, RETURNED and REJECTED are therefore excluded",
    /N'DRAFT'|N'SUBMITTED'|N'RETURNED'|N'REJECTED'/.test(ewsSrc), false);
  check("39. archived bills are excluded",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(ewsSrc), true);
  check("40. DA Difference bills are excluded from the normal Pay Slip",
    /<> N'DIFFERENCE'/.test(ewsSrc) && /<> N'DA DIFFERENCE'/.test(ewsSrc), true);
  check("40. the slip never reads a DA Difference field",
    /TotalDifferenceAmount|TotalNPSDeduction|TotalNetDifferenceAmount/.test(routeSrc),
    false);
  check("33-39. the route adds no status logic of its own that could relax this",
    /WorkflowStatus\s*===|Status\s*===\s*["']DRAFT/.test(routeCode), false);
  check("the slip reuses the shared loader rather than a second query",
    /loadEmployeeSalaryRows\(\)/.test(routeCode) && !/FROM dbo\./.test(routeCode), true);

  section("41-45. no field outside the Salary Entry grid");
  {
    const allKeys = [...slip.earnings, ...slip.deductions].map((r) => r.key);
    const allLabels = [...slip.earnings, ...slip.deductions].map((r) => r.label);
    check("41. the earning lines are exactly the grid's earning columns",
      slip.earnings.map((r) => r.label),
      ["Basic", "FixPay / Grade Pay", "Total Basic Pay", "DA", "HRA", "MA",
       "TA", "CLA", "Special Allow.", "Washing Allow."]);
    check("41. the deduction lines are exactly the grid's deduction columns",
      slip.deductions.map((r) => r.label),
      ["GPF Subscription", "GPF Adv", "NPS", "Income Tax",
       "Professional Tax", "Other Deduction"]);
    check("42. Other Earnings does not appear",
      allKeys.includes("otherEarnings") || /OtherEarnings/.test(routeCode), false);
    check("43. NPPA does not appear",
      allKeys.some((k) => /nppa/i.test(k)) || /NPPA/.test(routeCode), false);
    check("44. Cheque Amount does not appear",
      allKeys.some((k) => /cheque/i.test(k)) || /ChequeAmount/.test(routeCode), false);
    check("44. nor NPS Advance",
      allKeys.some((k) => /npsAdvance/i.test(k)) || /NPSAdvance/.test(routeCode), false);
    check("42-44. and none of their values reach the document",
      [999, 888, 777].some((v) => JSON.stringify(slip).includes(String(v))), false);
    check("45. the Pay Slip label is exactly \"FixPay / Grade Pay\"",
      allLabels.filter((l) => l === "FixPay / Grade Pay").length, 1);
    check("9. it is not a separate \"Grade Pay\" line",
      allLabels.includes("Grade Pay"), false);
    check("9. nor is FIX Basic shown twice",
      allLabels.filter((l) => /Fix/i.test(l)).length, 1);
    check("41. the fixture's non-grid columns are ignored",
      JSON.stringify(slip).includes("999") ||
        JSON.stringify(slip).includes("888") ||
        JSON.stringify(slip).includes("777"), false);
  }

  section("46. the database column is untouched");
  check("46. GradePay is only READ, never written",
    /GradePay\s*=\s*\$\{|UPDATE|INSERT INTO/.test(routeCode), false);
  check("46. the Pay Slip maps FixPay from the GradePay column",
    /key: "fixPay", label: "FixPay \/ Grade Pay", column: "GradePay"/.test(routeSrc), true);
  check("46. no schema statement was introduced",
    /ALTER TABLE|CREATE TABLE/.test(routeCode), false);
  check("the shared loader change is additive only",
    /d\.PensionType,\s*\n\s*w\.NPSScheduleNo,/.test(ewsSrc), true);

  section("zero values are printed, never hidden");
  check("every grid column appears even at 0.00",
    [slip.earnings.length, slip.deductions.length],
    [EARNING_LINES.length, DEDUCTION_LINES.length]);
  check("a zero line is present, not filtered away",
    slip.earnings.some((r) => r.key === "hra" && r.amount === 0), true);
  check("no line is dropped for being zero",
    /\.filter\(\([a-z]+\) => [a-z.]*amount\s*[!>]/.test(routeCode), false);

  section("bill and institute information");
  check("Bill Code / No. / Date",
    [slip.bill.billCode, slip.bill.billNo, slip.bill.billDate],
    ["JUN-2026", "598", "22-07-2026"]);
  /* 2026-09-24: NPS Schedule No. removed from the Pay Slip (user request). */
  check("NPS Schedule No. is not part of the Pay Slip", Object.prototype.hasOwnProperty.call(slip.bill, "npsScheduleNo"), false);
  {
    const ps = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "pages", "EmployeePaySlip.jsx"), "utf8");
    check("Pay Slip page shows no NPS Schedule No.", /NPS Schedule|npsScheduleNo/.test(ps), false);
    check("header rows are exactly the eight required",
      [...ps.slice(ps.indexOf('<div className="eps-meta">'), ps.indexOf("EMPLOYEE INFORMATION")).matchAll(/<Row label="([^"]+)"/g)].map((m) => m[1]),
      ["Salary Month", "Bill Month", "Salary Type", "Bill Code", "Bill No.", "Bill Date", "Institute Code", "Institute Name"]);
    check("signature reads Account Officer", /<div>Account Officer<\/div>/.test(ps) && !/Authorized Officer/.test(ps), true);
    check("NPS deduction line still on the Pay Slip", slip.deductions.some((r) => /nps/i.test(r.key || r.label || "")), true);
  }
  check("Institute Code and Name",
    [slip.institute.instituteCode, slip.institute.instituteName],
    ["CPD-06", "Gujarat State Probation"]);
  check("the official heading",
    [slip.heading[0], slip.heading[1], slip.title],
    ["GOVERNMENT OF GUJARAT", "DIRECTORATE OF SOCIAL DEFENCE", "PAY SLIP"]);

  section("51-52. print behaviour");
  check("51. bulk print emits one slip per employee",
    (() => {
      const rows = [
        dbRow({ EmployeeId: 1, EmployeeName: "A", DisplayOrder: 1 }),
        dbRow({ EmployeeId: 2, EmployeeName: "B", DisplayOrder: 2 }),
        dbRow({ EmployeeId: 3, EmployeeName: "C", DisplayOrder: 3 }),
      ];
      return filterRows(rows, { billCodeId: 11 }).map(buildPaySlip).length;
    })(), 3);
  check("51. each slip starts a new printed page",
    /page-break-after:\s*always|break-after:\s*page/.test(cssSrc), true);
  check("51. and the last one does not add a blank page",
    /:last-child[\s\S]{0,120}(page-break-after|break-after)\s*:\s*(auto|avoid)/.test(cssSrc), true);
  check("52. controls are marked no-print",
    /no-print/.test(pageSrc), true);
  check("52. the print CSS resets the shell containers",
    /\.app-shell[\s\S]{0,200}overflow:\s*visible/.test(cssSrc), true);
  check("52. an A4 portrait page box is declared (reportPdfConfig)",
    (new RegExp("employeePaySlip: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "EmployeePaySlip.jsx"), "utf8").includes('useReportPrintPage("employeePaySlip")')), true);
  check("52. print rules live in @media print",
    /@media print/.test(cssSrc), true);

  section("wiring and security");
  check("the route is registered behind the existing auth + permission gate",
    /\/api\/employee-pay-slip",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc),
    true);
  check("it reuses existing report permissions, inventing none",
    /"\/api\/employee-pay-slip"[^\n]*requirePermissionPrefix\("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"\)/
      .test(serverSrc), true);
  check("no credential or host literal in the route",
    /password|secret|jwt|https?:\/\//i.test(routeCode), false);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
