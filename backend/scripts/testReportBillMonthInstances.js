/**
 * ALL REPORTS - one row per approved Bill Month INSTANCE (2026-09-24).
 *
 * Bank Copy is the one exception, updated 2026-09-25: it prints one row per
 * BENEFICIARY (institute/account or employee), summed across however many
 * Bill Month instances contributed to it — see the BANK COPY section below.
 * Salary Register, Cheque Register and the Employee-wise loader are
 * unaffected and still show one row per instance, unchanged.
 *
 * BillCodeId 1018 (AUG-2026, Salary Month August 2026) has two approved
 * instances for DDRS-16, shaped exactly like the live data:
 *   WorkflowId 52  Bill Month AUG-2026  LOCKED  Bill No. 849 / 03-09-2026 on
 *                  its own workflow row (saved before migration 49), no
 *                  dbo.SalaryEntryBillHeader row; employees in
 *                  dbo.SalaryEmployeeDetails (Basic 38,100 each).
 *   WorkflowId 62  Bill Month JUL-2026  LOCKED  no Bill No. on its workflow
 *                  row; dbo.SalaryEntryBillHeader 701 / 11-08-2026;
 *                  employees in dbo.SalaryEntryBillEmployeeDetails
 *                  (Basic 11,111 each, so JUL can never be mistaken for AUG).
 *
 * Runs the REAL report builders (Salary Register, Cheque Register, Bank
 * Copy, Employee-wise loader used by IT/PT, NPS/GPF, Pay Slip, NPS Schedule)
 * against a stubbed database returning what the instance-keyed SQL returns.
 *
 * Usage: cd backend && npm run test:report-bill-month-instances
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ROOT = path.join(__dirname, "..");
process.env.SALARY_ENTRY_TRACE_FILE = "0";
process.env.SALARY_APPROVAL_TRACE_FILE = "0";

const MASTER = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August", SalaryMonth: "August",
  SalaryMonthNumber: "08", SalaryYear: "2026", BillCategory: "Salary", BillType: "Regular Salary",
};
const INST = {
  InstituteCode: "DDRS-16", InstituteId: 16, InstituteName: "SPECIAL CARE CENTER FOR SLOW LEARNERS",
  Place: "Surat", SectionId: 7, SectionSrNo: 7, SectionName: "DDRS SECTION", InstituteBankAccount: "INST-AC",
};
const AUG = { WorkflowId: 52, WorkflowBillMonth: "AUG-2026", WorkflowStatus: "LOCKED", BillNo: "849", BillDate: "2026-09-03", NPSScheduleNo: null, basic: 38100 };
const JUL = { WorkflowId: 62, WorkflowBillMonth: "JUL-2026", WorkflowStatus: "LOCKED", BillNo: null, BillDate: null, NPSScheduleNo: null, basic: 11111 };
const HEADERS = [{ SalaryBillCodeId: 1018, InstituteCode: "DDRS-16", BillMonth: "JUL-2026", BillNo: "701", BillDate: "2026-08-11", NPSScheduleNo: "SCH/JUL" }];

const empRows = (inst) => [1, 2, 3].map((n) => ({
  ...MASTER, ...INST, WorkflowId: inst.WorkflowId, ReportWorkflowId: inst.WorkflowId,
  WorkflowBillMonth: inst.WorkflowBillMonth, WorkflowStatus: inst.WorkflowStatus,
  /* what instanceBillMonthSelectSql() yields: BillMonth = instance, master kept aside */
  MasterBillMonth: MASTER.BillMonth, BillMonth: inst.WorkflowBillMonth,
  BillNo: inst.BillNo, BillDate: inst.BillDate, NPSScheduleNo: inst.NPSScheduleNo,
  DetailId: inst.WorkflowId * 10 + n, SalaryEmployeeDetailId: inst.WorkflowId * 10 + n,
  EmployeeId: 2000 + n, EmployeeName: `EMP ${n}`, DisplayOrder: n, EmployeeCode: `E${n}`, EmployeeBankAccount: `AC${n}`,
  BasicPay: inst.basic, GradePay: 0, TotalBasic: inst.basic, DA: 0, HRA: 0, MA: 0, TA: 0, CLA: 0,
  SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: inst.basic, GPFSubscription: 0, GPFAdvance: 0,
  NPS: 0, IncomeTax: 10, ProfessionalTax: 20, OtherDeduction: 0, TotalDeduction: 30,
  NetSalary: inst.basic - 30, ChequeAmount: inst.basic, PensionType: "GPF",
}));
const agg = (inst) => ({
  ...MASTER, ...INST, WorkflowId: inst.WorkflowId, WorkflowBillMonth: inst.WorkflowBillMonth,
  WorkflowStatus: inst.WorkflowStatus, BillNo: inst.BillNo, BillDate: inst.BillDate, NPSScheduleNo: inst.NPSScheduleNo,
  EmployeeCount: 3, EmpCount: 3, GrossAmount: inst.basic * 3, GrossSalary: inst.basic * 3, TotalDeduction: 90,
  NetSalary: inst.basic * 3 - 90, ChequeAmount: inst.basic * 3 - 30, BasicPay: inst.basic * 3, TotalBasic: inst.basic * 3,
  GradePay: 0, DA: 0, HRA: 0, CLA: 0, MA: 0, TA: 0, SpecialAllowance: 0, NPS: 0, GPFSubscription: 0,
  IncomeTax: 30, ProfessionalTax: 60, OtherDeduction: 0, ApprovedBy: "AO",
});

const queries = [];
function run(strings, values) {
  const text = (typeof strings === "string" ? strings : strings.join("?")).replace(/\s+/g, " ");
  queries.push(text);
  if (/FROM dbo\.SalaryEntryBillHeader/i.test(text)) return { recordset: HEADERS };
  if (/OBJECT_ID\(N'dbo\.DADifference/i.test(text)) return { recordset: [{ Bill: 0, Detail: 0 }] };
  if (/DADifference/i.test(text)) return { recordset: [] };
  if (/COUNT\(DISTINCT d\.EmployeeId\)/.test(text)) return { recordset: [agg(AUG), agg(JUL)] };            // Salary Register
  if (/InstituteBankAccount/.test(text)) return { recordset: [...empRows(AUG), ...empRows(JUL)] };         // Bank Copy
  if (/MasterDesignationName/.test(text)) return { recordset: [...empRows(AUG), ...empRows(JUL)] };       // Employee-wise
  if (/JOIN dbo\.SalaryEntryBillEmployeeDetails d /.test(text)) return { recordset: [agg(JUL)] };         // Cheque (instance)
  if (/JOIN dbo\.SalaryEmployeeDetails d /.test(text)) return { recordset: [agg(AUG)] };                  // Cheque (canonical)
  return { recordset: [] };
}
const query = (s, ...v) => Promise.resolve(run(s, v));
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath; stub.loaded = true;
stub.exports = { sql: { query, Request: function R() { return { query, input() { return this; } }; } }, connectDB: async () => true };
require.cache[dbPath] = stub;

const salaryRegister = require("../routes/salaryRegister");
const chequeRegister = require("../routes/chequeRegister");
const bankCopy = require("../routes/bankCopy");
const employeeWise = require("../routes/employeeWiseSalary");
const shared = require("../utils/reportBillInstance");

let passed = 0; let failed = 0;
function section(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`); }
}

(async () => {
  console.log("=".repeat(78));
  console.log("All reports: AUG-2026 salary as a JUL-2026 bill and as an AUG-2026 bill");
  console.log("=".repeat(78));

  section("SALARY REGISTER (TEST 1-7, 9, 18)");
  const sr = await salaryRegister.buildSalaryRegisterReport({ month: 8, year: 2026 });
  const srRows = sr.rows.filter((r) => r.instituteCode === "DDRS-16");
  const srJul = srRows.find((r) => r.workflowId === 62);
  const srAug = srRows.find((r) => r.workflowId === 52);
  check("3/18. two separate DDRS-16 rows", srRows.length, 2);
  check("9. JUL row: Bill Month JULY 2026, Salary Month AUGUST 2026, OLD", [srJul.billCode, srJul.billMonth, srJul.salaryMonth, srJul.salaryType], ["AUG-2026", "JULY 2026", "AUGUST 2026", "OLD"]);
  check("9. AUG row: Bill Month AUGUST 2026, REGULAR", [srAug.billCode, srAug.billMonth, srAug.salaryMonth, srAug.salaryType], ["AUG-2026", "AUGUST 2026", "AUGUST 2026", "REGULAR"]);
  check("4/5. JUL row: its own Bill No. 701 / 11-08-2026, not 849 / 03-09-2026", [srJul.billNo, srJul.billDate], ["701", "11-08-2026"]);
  check("6/7. AUG row keeps 849 / 03-09-2026", [srAug.billNo, srAug.billDate], ["849", "03-09-2026"]);
  check("JUL amounts are JUL's own employees (3 x 11,111)", [srJul.employees, srJul.grossAmount], [3, 33333]);
  check("AUG amounts unchanged (3 x 38,100)", [srAug.employees, srAug.grossAmount], [3, 114300]);

  section("CHEQUE REGISTER (TEST 8)");
  const cr = await chequeRegister.buildChequeRegisterReport({ month: "8", year: "2026" });
  const crRows = cr.rows.filter((r) => r.instituteCode === "DDRS-16").sort((a, b) => a.workflowId - b.workflowId);
  check("8. AUG-2026 | REGULAR | 849 ; JUL-2026 | OLD | 701",
    crRows.map((r) => [r.billMonthQueried, r.type, r.billNo]), [["AUG-2026", "REGULAR", "849"], ["JUL-2026", "OLD", "701"]]);
  check("Cheque and Salary Register agree on Bill No. per instance",
    [crRows[0].billNo, crRows[1].billNo], [srAug.billNo, srJul.billNo]);

  section("BANK COPY (TEST 10, 18) - same institute/account merged across Bill Month instances (2026-09-25)");
  /*
     2026-09-25: superseded the 2026-09-24 "separate block per Bill Month
     instance" decision above (Salary Register and Cheque Register keep that
     behaviour deliberately — a bank credit is not a bill-workflow record).
     DDRS-16 is paid AUG-2026's salary via a JUL-2026 bill AND an AUG-2026
     bill, to the SAME bank account (INST-AC / employees AC1-AC3): that is one
     beneficiary paid twice, not two beneficiaries, so Bank Copy now prints
     ONE row per beneficiary with both instances' amounts summed.
  */
  const bc = await bankCopy.buildBankCopyReport({ month: "8", year: "2026" });
  const bcRows = bc.rows.filter((r) => r.code === "DDRS-16");
  check("10. one merged Bill Month label per beneficiary, not one row per instance",
    [...new Set(bcRows.map((r) => r.billMonth))], ["JUL-2026 + AUG-2026"]);
  check("18. one merged block: institute line + 3 employee credits (not two blocks of four)",
    bcRows.map((r) => `${r.billMonth}:${r.type}`),
    ["JUL-2026 + AUG-2026:INSTITUTE", "JUL-2026 + AUG-2026:EMPLOYEE",
     "JUL-2026 + AUG-2026:EMPLOYEE", "JUL-2026 + AUG-2026:EMPLOYEE"]);
  check("each employee's credit is JUL's net (11,081) + AUG's net (38,070) = 49,151, summed not duplicated",
    bcRows.filter((r) => r.type === "EMPLOYEE").map((r) => r.amount),
    [49151, 49151, 49151]);
  check("the institute's tax credit sums both instances (90 + 90 = 180) into one row", bcRows.filter((r) => r.type === "INSTITUTE").map((r) => r.amount), [180]);
  check("Bank Copy Excel has no BILL MONTH column", bankCopy.XLSX_COLUMNS.map((c) => c.key).includes("billMonth"), false);

  section("EMPLOYEE-WISE LOADER (IT/PT, NPS/GPF Deduction, Pay Slip, NPS Schedule)");
  const ew = await employeeWise.loadEmployeeSalaryRows();
  const ewJul = ew.filter((r) => r.ReportWorkflowId === 62);
  const ewAug = ew.filter((r) => r.ReportWorkflowId === 52);
  check("JUL employees carry Bill Month JUL-2026, header 701 / 11-08-2026 / SCH/JUL",
    [...new Set(ewJul.map((r) => `${r.BillMonth}|${r.BillNo}|${r.BillDate}|${r.NPSScheduleNo}`))], ["JUL-2026|701|2026-08-11|SCH/JUL"]);
  check("AUG employees carry AUG-2026 and 849 / 03-09-2026",
    [...new Set(ewAug.map((r) => `${r.BillMonth}|${r.BillNo}|${r.BillDate}`))], ["AUG-2026|849|2026-09-03"]);
  const mapped = ew.map(employeeWise.mapSalaryRow);
  check("mapped rows: JUL -> OLD, AUG -> REGULAR",
    [...new Set(mapped.map((m) => `${m.billNo}:${m.type || m.salaryType}`))].sort(), ["701:OLD", "849:REGULAR"]);

  section("SHARED SQL (instance-keyed) + READ-ONLY (TEST 17)");
  const derived = shared.instanceEmployeeRowsSql().replace(/\s+/g, " ");
  check("canonical instance reads SalaryEmployeeDetails", /JOIN dbo\.SalaryEmployeeDetails ed0[^)]*iw0\.BillMonth = UPPER\(LEFT/.test(derived), true);
  check("earlier Bill Month reads SalaryEntryBillEmployeeDetails for exactly that Bill Month", /JOIN dbo\.SalaryEntryBillEmployeeDetails ed1 .*ed1\.BillMonth = iw1\.BillMonth/.test(derived), true);
  const reportQueries = queries.filter((q) => /InstanceWorkflowId/.test(q));
  check("Salary Register, Bank Copy and Employee-wise all join d.InstanceWorkflowId = w.WorkflowId",
    reportQueries.filter((q) => /d\.InstanceWorkflowId = w\.WorkflowId/.test(q)).length >= 3, true);
  check("17. no report query writes anything", queries.some((q) => /^\s*(INSERT|UPDATE|DELETE|MERGE)\b|\bINSERT INTO\b/i.test(q)), false);
  for (const f of ["salaryRegister", "bankCopy", "employeeWiseSalary", "gpfSummary", "npsSummary", "instituteWiseSalary"]) {
    const src = fs.readFileSync(path.join(ROOT, "routes", `${f}.js`), "utf8");
    check(`${f}: no bill+institute-only join to SalaryEmployeeDetails left`,
      /INNER JOIN dbo\.SalaryEmployeeDetails d\s+ON d\.SalaryBillCodeId = w\.SalaryBillCodeId\s+AND d\.InstituteCode = w\.InstituteCode/.test(src), false);
  }

  section("EXPORTS MATCH SCREEN (TEST 13-16)");
  const srCols = salaryRegister.XLSX_COLUMNS.map((c) => c.key);
  check("13. Salary Register Excel: Bill Month, Salary Month, Bill No., Bill Date from the same rows", ["billMonth", "salaryMonth", "billNo", "billDate"].every((k) => srCols.includes(k)), true);
  const srPage = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "SalaryRegister.jsx"), "utf8");
  check("14-16. Salary Register screen columns (used by CSV/PDF/Copy/Print) show the same fields",
    ["billMonth", "salaryMonth", "billNo", "billDate"].every((k) => srPage.includes(`key: "${k}"`)), true);
  const bcPage = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "BankCopy.jsx"), "utf8");
  check("14-16. Bank Copy screen/CSV/PDF have no BILL MONTH column", /BILL MONTH/.test(bcPage) || />\{row\.billMonth/.test(bcPage), false);

  console.log(`\n${"=".repeat(78)}\nPassed: ${passed}    Failed: ${failed}\n${"=".repeat(78)}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
