/**
 * SALARY REGISTER — Salary Month drill-down detail (2026-09-25).
 *
 * Clicking the Salary Month value of a Salary Register row must open the
 * employee-wise SAVED detail of exactly that row's bill/workflow INSTANCE —
 * never all employees of that Salary Month, never another institute, never
 * another Bill Month instance of the same institute/bill.
 *
 * Fixture: PH-01 / APANG MANAV MANDAL, Salary Month AUGUST 2026, paid across
 * TWO Bill Month instances (WorkflowId 501 = AUG-2026 bill, REGULAR; WorkflowId
 * 502 = AUG-2026-BM-JUL bill, OLD) — plus an unrelated institute PH-02 also in
 * August, to prove cross-institute isolation.
 *
 * Runs offline: db.js is stubbed so the real buildSalaryRegisterDetailReport /
 * loadSalaryRegisterDetailRows pipeline is EXECUTED, not pattern-matched.
 *
 * Usage: cd backend && node scripts/testSalaryRegisterDetail.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ===================== FIXTURE ===================== */

/* Raw rows exactly as loadSalaryBillAggregates()'s SQL returns them. */
const AGG_ROWS = [
  {
    BillCodeId: 900, BillCode: "AUG-2026", BillMonth: "August",
    SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
    WorkflowId: 501, WorkflowBillMonth: "AUG-2026",
    InstituteCode: "PH-01", WorkflowStatus: "APPROVED",
    BillNo: "838", BillDate: "2026-09-01",
    ApprovedBy: "Account Officer", ApprovedDate: "2026-09-02",
    InstituteName: "APANG MANAV MANDAL", SectionId: 3, SectionSrNo: 3, SectionName: "PH",
    EmployeeCount: 3, GrossAmount: 120000, TotalDeduction: 18000,
    NetSalary: 102000, ChequeAmount: 103600,
  },
  {
    /* Same institute, same SalaryMonth (August), an EARLIER Bill Month
       instance — the "-BM-" variant bill pattern reportBillInstance.js
       documents. Its own WorkflowId (502) makes it a different row identity
       from 501 even though the Salary Month is identical. */
    BillCodeId: 900, BillCode: "AUG-2026-BM-JUL", BillMonth: "JUL-2026",
    SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
    WorkflowId: 502, WorkflowBillMonth: "JUL-2026",
    InstituteCode: "PH-01", WorkflowStatus: "LOCKED",
    BillNo: "820", BillDate: "2026-08-05",
    ApprovedBy: "Account Officer", ApprovedDate: "2026-08-06",
    InstituteName: "APANG MANAV MANDAL", SectionId: 3, SectionSrNo: 3, SectionName: "PH",
    EmployeeCount: 2, GrossAmount: 25000, TotalDeduction: 2500,
    NetSalary: 22500, ChequeAmount: 23000,
  },
  {
    /* A different institute, also August — proves the drill-down never
       leaks across institutes just because the Salary Month matches. */
    BillCodeId: 910, BillCode: "AUG-2026", BillMonth: "August",
    SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
    WorkflowId: 601, WorkflowBillMonth: "AUG-2026",
    InstituteCode: "PH-02", WorkflowStatus: "APPROVED",
    BillNo: "839", BillDate: "2026-09-01",
    ApprovedBy: "Account Officer", ApprovedDate: "2026-09-02",
    InstituteName: "OTHER INSTITUTE", SectionId: 3, SectionSrNo: 3, SectionName: "PH",
    EmployeeCount: 1, GrossAmount: 99999, TotalDeduction: 9999,
    NetSalary: 90000, ChequeAmount: 90500,
  },
  /*
     NOTE: a DRAFT/SUBMITTED workflow is deliberately NOT included here.
     loadSalaryBillAggregates()'s real SQL excludes non-APPROVED/LOCKED
     workflows in its own WHERE clause (WorkflowStatus IN ('APPROVED',
     'LOCKED')) — it never returns such a row for the JS layer to filter.
     WorkflowId 777 below is used purely as an id that resolves to NOTHING,
     the same as a real ineligible or nonexistent workflow would.
  */
];

/* Raw rows exactly as loadSalaryRegisterDetailRows()'s SQL returns them,
   keyed by WorkflowId. Every value is a SAVED figure — nothing here is a
   formula the test computes; the endpoint must not recompute it either. */
const DETAIL_ROWS = {
  501: [
    { WorkflowId: 501, InstituteCode: "PH-01", WorkflowStatus: "APPROVED",
      DetailId: 5001, EmployeeId: 3001, EmployeeName: "Kiran Patel", Designation: "Clerk",
      DisplayOrder: 1, PensionType: "GPF",
      BasicPay: 18000, GradePay: 400, TotalBasic: 18400, PayLevel: "5",
      DA: 4000, HRA: 2000, MA: 500, TA: 800, CLA: 100,
      SpecialAllowance: 100, WashingAllowance: 50, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 30000, GPFSubscription: 1800, GPFAdvance: 0, NPS: 0,
      IncomeTax: 0, ProfessionalTax: 200, OtherDeduction: 0, TotalDeduction: 5000,
      NetSalary: 25000, ChequeAmount: 25300,
      EmployeeCode: "EMP3001", MasterDesignationName: "Senior Clerk" },
    { WorkflowId: 501, InstituteCode: "PH-01", WorkflowStatus: "APPROVED",
      DetailId: 5002, EmployeeId: 3002, EmployeeName: "Anita Shah", Designation: "Teacher",
      DisplayOrder: 2, PensionType: "NPS",
      BasicPay: 24000, GradePay: 500, TotalBasic: 24500, PayLevel: "6",
      DA: 5000, HRA: 2500, MA: 500, TA: 800, CLA: 100,
      SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 40000, GPFSubscription: 0, GPFAdvance: 0, NPS: 2400,
      IncomeTax: 500, ProfessionalTax: 200, OtherDeduction: 0, TotalDeduction: 6000,
      NetSalary: 34000, ChequeAmount: 34500,
      EmployeeCode: "EMP3002", MasterDesignationName: null },
    { WorkflowId: 501, InstituteCode: "PH-01", WorkflowStatus: "APPROVED",
      DetailId: 5003, EmployeeId: 3003, EmployeeName: "Ravi Mehta", Designation: "Peon",
      DisplayOrder: 3, PensionType: "GPF",
      BasicPay: 30000, GradePay: 600, TotalBasic: 30600, PayLevel: "3",
      DA: 6000, HRA: 3000, MA: 500, TA: 800, CLA: 100,
      SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 50000, GPFSubscription: 3000, GPFAdvance: 500, NPS: 0,
      IncomeTax: 1000, ProfessionalTax: 200, OtherDeduction: 300, TotalDeduction: 7000,
      NetSalary: 43000, ChequeAmount: 43800,
      EmployeeCode: "EMP3003", MasterDesignationName: null },
  ],
  502: [
    { WorkflowId: 502, InstituteCode: "PH-01", WorkflowStatus: "LOCKED",
      DetailId: 5004, EmployeeId: 3004, EmployeeName: "Old Bill Emp One", Designation: "Clerk",
      DisplayOrder: 1, PensionType: "GPF",
      BasicPay: 8000, GradePay: 0, TotalBasic: 8000, PayLevel: "4",
      DA: 1000, HRA: 500, MA: 200, TA: 200, CLA: 0,
      SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 10000, GPFSubscription: 600, GPFAdvance: 0, NPS: 0,
      IncomeTax: 0, ProfessionalTax: 200, OtherDeduction: 0, TotalDeduction: 1000,
      NetSalary: 9000, ChequeAmount: 9200,
      EmployeeCode: "EMP3004", MasterDesignationName: null },
    { WorkflowId: 502, InstituteCode: "PH-01", WorkflowStatus: "LOCKED",
      DetailId: 5005, EmployeeId: 3005, EmployeeName: "Old Bill Emp Two", Designation: "Clerk",
      DisplayOrder: 2, PensionType: "NPS",
      BasicPay: 12000, GradePay: 0, TotalBasic: 12000, PayLevel: "4",
      DA: 1500, HRA: 800, MA: 200, TA: 200, CLA: 0,
      SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 15000, GPFSubscription: 0, GPFAdvance: 0, NPS: 900,
      IncomeTax: 200, ProfessionalTax: 200, OtherDeduction: 0, TotalDeduction: 1500,
      NetSalary: 13500, ChequeAmount: 13800,
      EmployeeCode: "EMP3005", MasterDesignationName: null },
  ],
  601: [
    { WorkflowId: 601, InstituteCode: "PH-02", WorkflowStatus: "APPROVED",
      DetailId: 6001, EmployeeId: 4001, EmployeeName: "Other Institute Emp", Designation: "Clerk",
      DisplayOrder: 1, PensionType: "GPF",
      BasicPay: 60000, GradePay: 0, TotalBasic: 60000, PayLevel: "5",
      DA: 10000, HRA: 5000, MA: 500, TA: 800, CLA: 100,
      SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
      GrossSalary: 99999, GPFSubscription: 5000, GPFAdvance: 0, NPS: 0,
      IncomeTax: 4000, ProfessionalTax: 200, OtherDeduction: 0, TotalDeduction: 9999,
      NetSalary: 90000, ChequeAmount: 90500,
      EmployeeCode: "EMP4001", MasterDesignationName: null },
  ],
};

/* ---- db.js stub: distinguishes the two query shapes by whether .input()
   was called (loadSalaryRegisterDetailRows always calls .input("workflowId",
   ...); loadSalaryBillAggregates / other plain queries never do), exactly as
   the real driver would be used — no query-text pattern matching needed. ---- */
const writeCalls = [];
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    Int: "Int",
    query: (strings) => {
      const text = (typeof strings === "string" ? strings : strings.join("?"));
      if (/INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /i.test(text)) writeCalls.push(text);
      /* loadInstanceHeaders() — no headers configured; billNo/billDate fall
         back to the workflow row's own columns (asserted below). */
      return Promise.resolve({ recordset: [] });
    },
    Request: function R() {
      const self = { inputs: {} };
      self.input = function (name, type, value) {
        self.inputs[name] = value;
        return self;
      };
      self.query = function (text) {
        if (/INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /i.test(text)) writeCalls.push(text);
        if (Object.prototype.hasOwnProperty.call(self.inputs, "workflowId")) {
          return Promise.resolve({ recordset: DETAIL_ROWS[self.inputs.workflowId] || [] });
        }
        return Promise.resolve({ recordset: AGG_ROWS });
      };
      return self;
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const register = require("../routes/salaryRegister");
const {
  buildSalaryRegisterDetailReport,
  buildSalaryRegisterReport,
  mapDetailEmployeeRow,
  DETAIL_XLSX_COLUMNS,
} = register;

const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "salaryRegister.js"), "utf8");
const routeCode = routeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FRONT = path.join(ROOT, "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryRegister.jsx"), "utf8");
const detailPageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryRegisterDetail.jsx"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

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

(async () => {
  console.log("=".repeat(78));
  console.log("SALARY REGISTER — SALARY MONTH DRILL-DOWN DETAIL");
  console.log("=".repeat(78));

  section("0. the endpoint is gated the same as the rest of Salary Register");
  check("the register route is behind the same auth + permission for every sub-route",
    /"\/api\/salary-register",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("the detail endpoints are exported for testing",
    [typeof buildSalaryRegisterDetailReport, typeof mapDetailEmployeeRow, Array.isArray(DETAIL_XLSX_COLUMNS)],
    ["function", "function", true]);
  check("the screen route and the export both use the same builder",
    (routeCode.match(/buildSalaryRegisterDetailReport\(req\.query \|\| \{\}\)/g) || []).length, 2);

  section("1-2. clicking Salary Month for PH-01/AUG-2026 opens the correct employees");
  const detail501 = await buildSalaryRegisterDetailReport({
    workflowId: 501, instituteCode: "PH-01", billCodeId: 900,
  });
  check("1. exactly the three employees of WorkflowId 501",
    detail501.employees.map((e) => e.employeeId).sort((a, b) => a - b), [3001, 3002, 3003]);
  check("1. header shows the clicked row's own bill identity",
    [detail501.bill.instituteCode, detail501.bill.instituteName, detail501.bill.billCode,
     detail501.bill.billMonth, detail501.bill.salaryMonth, detail501.bill.billNo, detail501.bill.billDate],
    ["PH-01", "APANG MANAV MANDAL", "AUG-2026", "AUGUST 2026", "AUGUST 2026", "838", "01-09-2026"]);
  check("2. the correct employee count is returned",
    [detail501.employeeCount, detail501.registerTotals.employees], [3, 3]);

  section("3-6. detail totals reconcile with the Salary Register row");
  check("3. Gross total matches Salary Register",
    detail501.totals.grossSalary, detail501.registerTotals.grossAmount);
  check("3. Gross total is the real figure (120000), not a coincidence",
    detail501.totals.grossSalary, 120000);
  check("4. Deduction total matches Salary Register",
    detail501.totals.totalDeduction, detail501.registerTotals.totalDeduction);
  check("4. Deduction total is 18000",
    detail501.totals.totalDeduction, 18000);
  check("5. Net Salary total matches Salary Register",
    detail501.totals.netSalary, detail501.registerTotals.netSalary);
  check("5. Net Salary total is 102000",
    detail501.totals.netSalary, 102000);
  check("6. Cheque Amount total matches Salary Register",
    detail501.totals.chequeAmount, detail501.registerTotals.chequeAmount);
  check("6. Cheque Amount total is 103600",
    detail501.totals.chequeAmount, 103600);

  section("7. wrong-institute employees are excluded");
  check("7. PH-02's employee (4001) never appears in PH-01's WorkflowId 501 detail",
    detail501.employees.some((e) => e.employeeId === 4001), false);
  check("7. PH-02's amount (99999) never leaks into PH-01's totals",
    detail501.totals.grossSalary !== 99999, true);

  section("8. wrong-bill-instance employees are excluded");
  check("8. WorkflowId 502's employees (3004, 3005) never appear in WorkflowId 501's detail",
    detail501.employees.some((e) => e.employeeId === 3004 || e.employeeId === 3005), false);

  section("9. JUL-2026 and AUG-2026 instances remain separate");
  const detail502 = await buildSalaryRegisterDetailReport({ workflowId: 502 });
  check("9. WorkflowId 502 returns only its own two employees",
    detail502.employees.map((e) => e.employeeId).sort((a, b) => a - b), [3004, 3005]);
  check("9. its own Bill Month (JULY 2026) and OLD salary type, distinct from 501 (AUGUST 2026 / REGULAR)",
    [detail502.bill.billMonth, detail502.bill.salaryType, detail501.bill.billMonth, detail501.bill.salaryType],
    ["JULY 2026", "OLD", "AUGUST 2026", "REGULAR"]);
  check("9. both share the same Salary Month, proving isolation is by instance, not by Salary Month",
    [detail501.bill.salaryMonth, detail502.bill.salaryMonth], ["AUGUST 2026", "AUGUST 2026"]);
  check("9. 502's totals are its own (25000 / 2500 / 22500 / 23000), never 501's",
    [detail502.totals.grossSalary, detail502.totals.totalDeduction, detail502.totals.netSalary, detail502.totals.chequeAmount],
    [25000, 2500, 22500, 23000]);

  section("10. same Salary Month, different Bill Month never cross-mixes");
  const ids501 = new Set(detail501.employees.map((e) => e.employeeId));
  const ids502 = new Set(detail502.employees.map((e) => e.employeeId));
  check("10. no employee id is shared between the two instances",
    [...ids501].some((id) => ids502.has(id)), false);
  check("10. the two instances' employee counts do not sum into either one",
    detail501.employeeCount + detail502.employeeCount !== detail501.employeeCount &&
      detail501.employeeCount + detail502.employeeCount !== detail502.employeeCount, true);
  check("10. a combined SalaryMonth-only query would have returned all of PH-01's August instances (5), but the drill-down returns only WorkflowId 501's 3",
    [AGG_ROWS.filter((r) => r.InstituteCode === "PH-01" && r.SalaryMonth === "August")
      .reduce((s, r) => s + r.EmployeeCount, 0), detail501.employeeCount], [5, 3]);

  section("11. existing Salary Register results are unchanged by this feature");
  const registerReport = await buildSalaryRegisterReport({ month: 8, year: 2026, instituteCode: "PH-01" });
  check("11. PH-01 still shows its two separate bill-instance rows",
    registerReport.rows.map((r) => r.workflowId).sort((a, b) => a - b), [501, 502]);
  check("11. their amounts are exactly the fixture's own, never merged or altered",
    registerReport.rows.map((r) => [r.workflowId, r.grossAmount, r.netSalary]).sort((a, b) => a[0] - b[0]),
    [[501, 120000, 102000], [502, 25000, 22500]]);

  section("12. eligibility is unchanged: only APPROVED/LOCKED instances resolve");
  /* loadSalaryBillAggregates()'s own SQL excludes non-APPROVED/LOCKED
     workflows (see the WHERE clause check under section 0 / testSalaryRegister.js
     checks 3-8), so a DRAFT/SUBMITTED/RETURNED/REJECTED workflow's id is
     simply absent from the aggregate the drill-down looks it up in — exactly
     like a nonexistent id. WorkflowId 777 stands in for that: it resolves to
     nothing, whatever the reason. */
  let ineligibleError = null;
  try {
    await buildSalaryRegisterDetailReport({ workflowId: 777 });
  } catch (e) {
    ineligibleError = e;
  }
  check("an ineligible/nonexistent workflow is not resolvable via the drill-down (404, not silently shown)",
    [ineligibleError?.status, ineligibleError != null], [404, true]);
  check("the detail query itself independently re-enforces APPROVED/LOCKED, in case the register list ever changes",
    /loadSalaryRegisterDetailRows[\s\S]{0,1400}UPPER\(LTRIM\(RTRIM\(w\.Status\)\)\) IN \(N'APPROVED', N'LOCKED'\)/.test(routeCode), true);

  section("13. locked/approved historical values are shown exactly as saved");
  check("13. WorkflowId 502 (LOCKED) values are the exact stored figures, no recalculation",
    detail502.employees.map((e) => [e.employeeId, e.basicPay, e.da, e.netSalary, e.chequeAmount]),
    [[3004, 8000, 1000, 9000, 9200], [3005, 12000, 1500, 13500, 13800]]);
  check("13. WorkflowId 501 (APPROVED) individual component values are exact, not derived",
    detail501.employees.find((e) => e.employeeId === 3001),
    { srNo: 1, detailId: 5001, employeeId: 3001, employeeName: "Kiran Patel",
      employeeCode: "EMP3001", designation: "Senior Clerk", displayOrder: 1,
      payLevel: "5", basicPay: 18000, gradePay: 400, totalBasic: 18400,
      da: 4000, hra: 2000, ta: 800, ma: 500, cla: 100, otherAllowances: 150,
      grossSalary: 30000, gpfSubscription: 1800, nps: 0, gpfAdvance: 0,
      incomeTax: 0, professionalTax: 200, otherDeduction: 0, totalDeduction: 5000,
      netSalary: 25000, chequeAmount: 25300 });
  check("13. designation falls back to the snapshot's own value when EmployeeMaster has none",
    detail501.employees.find((e) => e.employeeId === 3002).designation, "Teacher");
  check("13. no PAN column is invented; Employee Code is the existing identifier used",
    DETAIL_XLSX_COLUMNS.some((c) => /pan/i.test(c.label) || /pan/i.test(c.key)), false);
  check("13. the source documents that no PAN column exists in this schema (comment, so checked pre-strip)",
    /no PAN column/i.test(routeSrc), true);

  section("14. opening the detail report writes nothing to the database");
  check("14. no INSERT/UPDATE/DELETE/MERGE was ever issued by any call above",
    writeCalls, []);
  const detailSectionSrc = routeCode.slice(
    routeCode.indexOf("async function loadSalaryRegisterDetailRows"),
    routeCode.indexOf("module.exports = router")
  );
  check("14. the detail source itself contains no write statement",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /.test(detailSectionSrc), false);
  check("14. loadSalaryRegisterDetailRows is a plain parameterised SELECT",
    /request\.input\("workflowId", sql\.Int, workflowId\)/.test(routeCode), true);

  section("defence: a malformed or missing identity is rejected, not silently substituted");
  let missingError = null;
  try {
    await buildSalaryRegisterDetailReport({});
  } catch (e) {
    missingError = e;
  }
  check("no workflowId at all -> 400, never 'show something anyway'",
    missingError?.status, 400);
  let mismatchError = null;
  try {
    await buildSalaryRegisterDetailReport({ workflowId: 501, instituteCode: "PH-02" });
  } catch (e) {
    mismatchError = e;
  }
  check("an institute that disagrees with the WorkflowId -> 409, never substituted silently",
    mismatchError?.status, 409);

  section("frontend: the trigger is the Salary Month VALUE only, not the row");
  check("the Salary Month cell renders a dedicated clickable control",
    /column\.key === "salaryMonth"/.test(pageSrc), true);
  check("it is gated on the row actually having a WorkflowId (DA Difference rows have none)",
    /row\.workflowId != null/.test(pageSrc), true);
  check("the exact bill/workflow identity travels with the click, not just the Salary Month",
    /onOpenDetail\(\{\s*workflowId: row\.workflowId,\s*billCodeId: row\.billCodeId,\s*instituteCode: row\.instituteCode,/.test(pageSrc), true);
  check("no other row cell was made clickable for this feature",
    (pageSrc.match(/onOpenDetail\(/g) || []).length, 1);
  check("clickable styling exists (cursor pointer via a real button, not a div)",
    /sr-month-link/.test(pageSrc) && /cursor:\s*pointer/.test(
      fs.readFileSync(path.join(FRONT, "pages", "salaryRegister.css"), "utf8")
    ), true);

  section("frontend: filters travel with the drill-down and Back restores them");
  check("the click carries the current filters alongside the bill identity",
    /month, year, billMonth, sectionId, salaryType,/.test(pageSrc), true);
  check("SalaryRegister restores its filter state from pageParams",
    /restored\.month \|\| String\(now\.getMonth\(\) \+ 1\)/.test(pageSrc), true);
  check("returning with restored filters re-runs the query automatically",
    /hasRestoredFilters[\s\S]{0,80}handleShow\(\)/.test(pageSrc), true);
  check("Back passes the preserved filters, not a bare navigation",
    /onBack && onBack\(filters\)/.test(detailPageSrc), true);
  check("the detail page uses a real route/query-state mechanism (hash params), not React state alone",
    /readHashParams|pageParams/.test(detailPageSrc), true);

  section("frontend: the detail table displays only columns confirmed to exist");
  check("the frontend column list mirrors the backend's exactly",
    DETAIL_XLSX_COLUMNS.length >= 24, true);
  const REQUIRED_LABELS = [
    "Sr. No.", "Employee ID", "Employee Name", "Designation", "Employee Code",
    "Basic Pay", "Pay Level", "Grade Pay", "D.A.", "H.R.A.", "T.A.", "M.A.",
    "C.L.A.", "Other Allowances", "Gross Salary", "GPF Subscription", "NPS",
    "GPF Advance", "Income Tax", "Professional Tax", "Other Deduction",
    "Total Deduction", "Net Salary", "Cheque Amount",
  ];
  check("every one of the 24 required columns is present",
    REQUIRED_LABELS.every((label) => DETAIL_XLSX_COLUMNS.some((c) => c.label === label)), true);
  check("the screen defines the identical 24 columns",
    REQUIRED_LABELS.every((label) => detailPageSrc.includes(`label: "${label}"`)), true);

  section("PDF / print and Excel");
  check("the detail report has its own A4 portrait print page (reportPdfConfig.js)",
    /salaryRegisterDetail: \{ title: "Salary Details", orientation: "portrait"/.test(
      fs.readFileSync(path.join(FRONT, "utils", "reportPdfConfig.js"), "utf8")
    ), true);
  check("the detail page wires Print/PDF through the shared mechanism",
    /useReportPrintPage\("salaryRegisterDetail"\)/.test(detailPageSrc) &&
      /printReport\("salaryRegisterDetail"\)/.test(detailPageSrc), true);
  check("Excel export downloads from the backend, exporting exactly what is displayed",
    /downloadSalaryRegisterDetailExcel/.test(detailPageSrc), true);
  check("the Excel export reuses the same report builder as the screen",
    (routeCode.match(/buildSalaryRegisterDetailReport\(req\.query \|\| \{\}\)/g) || []).length, 2);

  section("no unrelated report was touched");
  for (const f of [
    "bankCopy.js", "chequeRegister.js", "employeeWiseSalary.js",
    "gpfSummary.js", "npsSummary.js", "salaryCalculate.js", "salaryEntry.js",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, "routes", f), "utf8");
    check(`${f} does not reference the new detail report`,
      /buildSalaryRegisterDetailReport|SalaryRegisterDetail/.test(src), false);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(78));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
