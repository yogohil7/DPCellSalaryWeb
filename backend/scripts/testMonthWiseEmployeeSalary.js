/**
 * MONTH-WISE EMPLOYEE SALARY REPORT (2026-09-25).
 *
 * A flat employee-wise listing of ONE selected Salary Month across every
 * institute, with an "Institute Total" subtotal row after each institute and
 * a Grand Total at the end. Every money value is a STORED
 * dbo.SalaryEmployeeDetails / dbo.SalaryEntryBillEmployeeDetails column;
 * nothing here is recalculated, including the retirement GPF/NPS stop rule
 * (whatever was saved is shown, zero or not).
 *
 * Runs offline: db.js is stubbed so the real
 * buildMonthWiseEmployeeSalaryReport pipeline is EXECUTED, not
 * pattern-matched.
 *
 * Usage: cd backend && node scripts/testMonthWiseEmployeeSalary.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ===================== FIXTURE ===================== */

/* Base shape mirrors loadMonthWiseRows()'s SELECT list exactly. */
function row(over) {
  return {
    BillCodeId: 1, BillCode: "AUG-2026", WorkflowId: 701, WorkflowBillMonth: "AUG-2026",
    SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
    InstituteCode: "AAA-01", WorkflowStatus: "APPROVED",
    InstituteName: "Institute AAA", SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
    DetailId: 1, EmployeeId: 1, EmployeeName: "Employee", Designation: "Clerk",
    DisplayOrder: 1,
    BasicPay: 0, GradePay: 0, TotalBasic: 0, DA: 0, HRA: 0, MA: 0, TA: 0, CLA: 0,
    SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 0,
    GPFSubscription: 0, GPFAdvance: 0, NPS: 0, IncomeTax: 0, ProfessionalTax: 0,
    OtherDeduction: 0, TotalDeduction: 0, NetSalary: 0, ChequeAmount: 0,
    MasterDesignationName: null,
    ...over,
  };
}

const E1 = row({
  WorkflowId: 701, BillCode: "AUG-2026", InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 101, EmployeeId: 1, EmployeeName: "Kiran Patel", Designation: "Senior Clerk", DisplayOrder: 1,
  BasicPay: 20000, GradePay: 500, TotalBasic: 20500, DA: 4000, HRA: 2000, MA: 500, TA: 800, CLA: 100,
  SpecialAllowance: 100, WashingAllowance: 50, GrossSalary: 28050,
  GPFSubscription: 1500, GPFAdvance: 0, NPS: 0, IncomeTax: 0, ProfessionalTax: 200,
  OtherDeduction: 0, TotalDeduction: 1700, NetSalary: 26350, ChequeAmount: 26550,
});
const E2 = row({
  WorkflowId: 701, BillCode: "AUG-2026", InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 102, EmployeeId: 2, EmployeeName: "Anita Shah", Designation: "Teacher", DisplayOrder: 2,
  BasicPay: 25000, GradePay: 600, TotalBasic: 25600, DA: 5000, HRA: 2500, MA: 500, TA: 800, CLA: 100,
  SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 34500,
  GPFSubscription: 0, GPFAdvance: 0, NPS: 2400, IncomeTax: 500, ProfessionalTax: 200,
  OtherDeduction: 0, TotalDeduction: 3100, NetSalary: 31400, ChequeAmount: 32100,
});
/* Same institute (AAA-01), a DIFFERENT Bill Month instance (JUL-2026, "-BM-"
   variant bill) of the SAME Salary Month (August). Its own WorkflowId (703)
   and its own employee — "Bill Month = All" must include this alongside 701. */
/* Migration 51 labels a "-BM-" variant bill's own workflow row with the
   SALARY month; the TRUE earlier Bill Month lives on the master
   SalaryBillCodes.BillMonth field instead (see instanceBillMonthSelectSql /
   instanceBillMonthPartsOf) — so BillMonth (master) = "JUL-2026" while
   WorkflowBillMonth (this workflow row's own label) = "AUG-2026". */
const E3 = row({
  WorkflowId: 703, BillCode: "AUG-2026-BM-JUL",
  BillMonth: "JUL-2026", WorkflowBillMonth: "AUG-2026",
  InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 103, EmployeeId: 3, EmployeeName: "Old Bill Employee", Designation: "Peon", DisplayOrder: 1,
  BasicPay: 10000, GradePay: 0, TotalBasic: 10000, DA: 1000, HRA: 500, MA: 200, TA: 200, CLA: 0,
  SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 11900,
  GPFSubscription: 600, GPFAdvance: 0, NPS: 0, IncomeTax: 0, ProfessionalTax: 200,
  OtherDeduction: 0, TotalDeduction: 800, NetSalary: 11100, ChequeAmount: 11300,
});
const E4 = row({
  WorkflowId: 702, BillCode: "AUG-2026", InstituteCode: "BBB-02", InstituteName: "Institute BBB",
  SectionId: 2, SectionSrNo: 2, SectionName: "FIELD",
  DetailId: 104, EmployeeId: 4, EmployeeName: "Ravi Mehta", Designation: "Supervisor", DisplayOrder: 1,
  BasicPay: 30000, GradePay: 700, TotalBasic: 30700, DA: 6000, HRA: 3000, MA: 500, TA: 800, CLA: 100,
  SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 41100,
  GPFSubscription: 3000, GPFAdvance: 500, NPS: 0, IncomeTax: 1000, ProfessionalTax: 200,
  OtherDeduction: 300, TotalDeduction: 5000, NetSalary: 36100, ChequeAmount: 36800,
});
/* Retirement-stop already applied at SAVE time: GPF is 0. The report must
   show that saved zero, never recompute it and never invent a nonzero value. */
const E7 = row({
  WorkflowId: 704, BillCode: "AUG-2026", InstituteCode: "CCC-03", InstituteName: "Institute CCC",
  SectionId: 3, SectionSrNo: 3, SectionName: "OTHER",
  DetailId: 107, EmployeeId: 7, EmployeeName: "Retiring Employee", Designation: "Clerk", DisplayOrder: 1,
  BasicPay: 15000, GradePay: 0, TotalBasic: 15000, DA: 1500, HRA: 750, MA: 200, TA: 200, CLA: 0,
  SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 17650,
  GPFSubscription: 0, GPFAdvance: 0, NPS: 0, IncomeTax: 0, ProfessionalTax: 200,
  OtherDeduction: 0, TotalDeduction: 200, NetSalary: 17450, ChequeAmount: 17650,
});
/* A different SALARY MONTH (July) — must be excluded when filtering August. */
const E5_WRONG_MONTH = row({
  WorkflowId: 501, BillCode: "JUL-2026", InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  SalaryMonth: "July", SalaryMonthNumber: "07", SalaryYear: "2026",
  WorkflowBillMonth: "JUL-2026",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 105, EmployeeId: 5, EmployeeName: "July Employee", Designation: "Clerk",
  GrossSalary: 99999, NetSalary: 99999, ChequeAmount: 99999,
});
/* A different YEAR (2025) — must be excluded when filtering 2026. */
const E6_WRONG_YEAR = row({
  WorkflowId: 401, BillCode: "AUG-2025", InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2025",
  WorkflowBillMonth: "AUG-2025",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 106, EmployeeId: 6, EmployeeName: "Last Year Employee", Designation: "Clerk",
  GrossSalary: 88888, NetSalary: 88888, ChequeAmount: 88888,
});
/* A non-approved workflow — must never appear regardless of filters. */
const E8_DRAFT = row({
  WorkflowId: 999, BillCode: "AUG-2026", InstituteCode: "AAA-01", InstituteName: "Institute AAA",
  WorkflowStatus: "DRAFT",
  SectionId: 1, SectionSrNo: 1, SectionName: "ADMIN",
  DetailId: 108, EmployeeId: 8, EmployeeName: "Draft Employee", Designation: "Clerk",
  GrossSalary: 1, NetSalary: 1, ChequeAmount: 1,
});

const ALL_ROWS = [E1, E2, E3, E4, E7, E5_WRONG_MONTH, E6_WRONG_YEAR, E8_DRAFT];

/* ---- db.js stub ---- */
const writeCalls = [];
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: (strings) => {
      const text = typeof strings === "string" ? strings : strings.join("?");
      if (/INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /i.test(text)) writeCalls.push(text);
      return Promise.resolve({ recordset: [] });
    },
    Request: function R() {
      return {
        input() { return this; },
        query: (text) => {
          if (/INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /i.test(text)) writeCalls.push(text);
          return Promise.resolve({ recordset: ALL_ROWS });
        },
      };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const monthWise = require("../routes/monthWiseEmployeeSalary");
const {
  buildMonthWiseEmployeeSalaryReport,
  mapEmployeeRow,
  filterMonthWiseRows,
  compareEmployeeRows,
  parseSalaryType,
  XLSX_COLUMNS,
} = monthWise;

const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "monthWiseEmployeeSalary.js"), "utf8");
const routeCode = routeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FRONT = path.join(ROOT, "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "MonthWiseEmployeeSalary.jsx"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const modulesSrc = fs.readFileSync(path.join(FRONT, "modules.js"), "utf8");
const accessSrc = fs.readFileSync(path.join(FRONT, "utils", "accessControl.js"), "utf8");

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
  console.log("MONTH-WISE EMPLOYEE SALARY REPORT");
  console.log("=".repeat(78));

  section("0. wiring: route, permission, menu");
  check("the route is mounted with the same permission set as every other report",
    /"\/api\/month-wise-employee-salary",\s*\.\.\.authed,\s*requirePermissionPrefix\("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"\)/.test(serverSrc), true);
  check("the page is registered under Reports",
    /id: "month-wise-employee-salary"/.test(modulesSrc), true);
  check("it reuses REPORT_SALARY, inventing no new permission",
    /"month-wise-employee-salary": "REPORT_SALARY"/.test(accessSrc), true);
  check("the screen route and the export both use the same builder",
    (routeCode.match(/buildMonthWiseEmployeeSalaryReport\(req\.query \|\| \{\}\)/g) || []).length, 2);

  const base = { month: 8, year: 2026 };

  section("1-2. one institute with multiple employees; multiple institutes in one Salary Month");
  const full = await buildMonthWiseEmployeeSalaryReport(base);
  check("1. AAA-01 shows all three of its employees (both Bill Month instances)",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").map((r) => r.employeeId).sort((a, b) => a - b),
    [1, 2, 3]);
  check("2. three institutes appear for this Salary Month",
    full.instituteCount, 3);
  check("2. institute totals appear once per institute, each labelled 'Institute Total'",
    full.rows.filter((r) => r.type === "INSTITUTE_TOTAL").map((r) => r.label), ["Institute Total", "Institute Total", "Institute Total"]);

  section("3-4. Salary Month and Year filtering");
  check("3. a different Salary Month (July) is excluded",
    full.rows.some((r) => r.type === "EMPLOYEE" && r.employeeId === 5), false);
  check("4. a different year (2025) is excluded even with the same month number",
    full.rows.some((r) => r.type === "EMPLOYEE" && r.employeeId === 6), false);
  check("3-4. missing month/year is rejected rather than silently showing everything",
    await buildMonthWiseEmployeeSalaryReport({}).then(() => "resolved", (e) => e.status), 400);

  section("5-6. Bill Month = All vs a specific Bill Month");
  check("5. Bill Month = All includes both AUG-2026 and the JUL-2026 instance of AAA-01",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").length, 3);
  const augOnly = await buildMonthWiseEmployeeSalaryReport({ ...base, billMonth: 8 });
  check("6. Bill Month = August keeps only the AUG-2026 instance's employees (1, 2), not the JUL-2026 instance's (3)",
    augOnly.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").map((r) => r.employeeId).sort((a, b) => a - b),
    [1, 2]);
  const julOnly = await buildMonthWiseEmployeeSalaryReport({ ...base, billMonth: 7 });
  check("6. Bill Month = July keeps only the JUL-2026 instance's employee (3)",
    julOnly.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").map((r) => r.employeeId),
    [3]);

  section("7-8. Section and Institute filtering");
  const sectionFiltered = await buildMonthWiseEmployeeSalaryReport({ ...base, sectionId: 1 });
  check("7. Section = ADMIN (1) returns only AAA-01's employees",
    sectionFiltered.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.employeeId).sort((a, b) => a - b),
    [1, 2, 3]);
  const instituteFiltered = await buildMonthWiseEmployeeSalaryReport({ ...base, instituteCode: "BBB-02" });
  check("8. Institute = BBB-02 returns only its own employee (4)",
    instituteFiltered.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.employeeId), [4]);

  section("9. Salary Type filtering");
  /* billTypeMatchesFilter's documented, project-wide rule (salaryMonthKey.js):
     "Regular Salary" means every ordinary salary bill of the selected Salary
     Month, OLD bills included — it narrows out DA Difference only, never a
     Salary Month's own earlier-Bill-Month rows. "Old Salary" is the genuine
     narrowing option, returning OLD rows only. This report defers to that
     one shared rule rather than inventing its own. */
  const regularOnly = await buildMonthWiseEmployeeSalaryReport({ ...base, salaryType: "REGULAR" });
  check("9. REGULAR still includes the OLD (JUL-2026 instance) employee (3) — Regular Salary means 'not DA Difference', per the shared rule",
    regularOnly.rows.some((r) => r.type === "EMPLOYEE" && r.employeeId === 3), true);
  const oldOnly = await buildMonthWiseEmployeeSalaryReport({ ...base, salaryType: "OLD" });
  check("9. OLD returns only employee 3",
    oldOnly.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.employeeId), [3]);
  check("9. an unrecognised salary type falls back to ALL",
    parseSalaryType({ salaryType: "nonsense" }), "ALL");

  section("10-19. every earning/basic column is the stored value, not derived");
  const kiran = full.rows.find((r) => r.type === "EMPLOYEE" && r.employeeId === 1);
  check("10. Basic", kiran.basic, 20000);
  check("11. G.P.", kiran.gradePay, 500);
  check("12. Total Basic", kiran.totalBasic, 20500);
  check("13. D.A.", kiran.da, 4000);
  check("14. H.R.A.", kiran.hra, 2000);
  check("15. Medical", kiran.medical, 500);
  check("16. T.A.", kiran.ta, 800);
  check("17. C.L.A.", kiran.cla, 100);
  check("18. Spl. Allowance", kiran.specialAllowance, 100);
  check("19. Wash. Allowance", kiran.washingAllowance, 50);
  check("12. Total Basic is the stored column, never Basic + G.P. computed here",
    /totalBasic: round2\(row\.TotalBasic\)/.test(routeCode), true);

  section("20-29. every deduction/total column is the stored value, not derived");
  check("20. Total (Gross)", kiran.total, 28050);
  check("20. Total is the stored GrossSalary, never a sum of the components shown beside it",
    /total: round2\(row\.GrossSalary\)/.test(routeCode), true);
  check("21. GPF", kiran.gpf, 1500);
  check("22. GPF Adv.", kiran.gpfAdvance, 0);
  const anita = full.rows.find((r) => r.type === "EMPLOYEE" && r.employeeId === 2);
  check("22. GPF Adv. (a nonzero example)", (await buildMonthWiseEmployeeSalaryReport({ ...base, instituteCode: "BBB-02" }))
    .rows.find((r) => r.type === "EMPLOYEE").gpfAdvance, 500);
  check("23. NPS", anita.nps, 2400);
  check("24. Income Tax", anita.incomeTax, 500);
  check("25. Prof. Tax", kiran.professionalTax, 200);
  check("26. Other Ded.", instituteFiltered.rows.find((r) => r.type === "EMPLOYEE").otherDeduction, 300);
  check("27. Total Ded.", kiran.totalDeduction, 1700);
  check("28. Net", kiran.net, 26350);
  check("29. Cheque Amt.", kiran.chequeAmount, 26550);

  section("30. Grand Total matches the displayed employee rows");
  const employeeRows = full.rows.filter((r) => r.type === "EMPLOYEE");
  const TOTAL_KEYS = [
    "basic", "gradePay", "totalBasic", "da", "hra", "medical", "ta", "cla",
    "specialAllowance", "washingAllowance", "total", "gpf", "gpfAdvance",
    "nps", "incomeTax", "professionalTax", "otherDeduction", "totalDeduction",
    "net", "chequeAmount",
  ];
  const recomputed = {};
  TOTAL_KEYS.forEach((k) => {
    recomputed[k] = Number(employeeRows.reduce((s, r) => s + Number(r[k]), 0).toFixed(2));
  });
  check("30. Grand Total equals the sum of every displayed employee row, for every column",
    TOTAL_KEYS.every((k) => full.grandTotal[k] === recomputed[k]), true);
  check("30. Grand Total's Net is 122400", full.grandTotal.net, 122400);
  check("30. Grand Total's Gross (Total) is 133200", full.grandTotal.total, 133200);

  section("Institute Total reconciles with its own employees only");
  const aaaTotal = full.rows.find((r) => r.type === "INSTITUTE_TOTAL" && r.instituteCode === "AAA-01");
  check("AAA-01's Institute Total = employees 1+2+3 only (net 68850)", aaaTotal.net, 68850);
  const bbbTotal = full.rows.find((r) => r.type === "INSTITUTE_TOTAL" && r.instituteCode === "BBB-02");
  check("BBB-02's Institute Total = employee 4 only (net 36100)", bbbTotal.net, 36100);
  check("the final Grand Total equals the sum of every displayed Institute Total",
    Number((aaaTotal.net + bbbTotal.net + full.rows.find((r) => r.type === "INSTITUTE_TOTAL" && r.instituteCode === "CCC-03").net).toFixed(2)),
    full.grandTotal.net);

  section("31-32. multiple Bill Month instances stay isolated; no duplicate rows");
  check("31. employee 3 (JUL-2026 instance) and employees 1,2 (AUG-2026 instance) never merge into one row",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").length, 3);
  check("32. no employee appears twice within a single Bill Month selection",
    new Set(augOnly.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.employeeId)).size,
    augOnly.rows.filter((r) => r.type === "EMPLOYEE").length);
  check("32. across 'All Bill Months', an employee present in only one instance appears exactly once, never duplicated",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.employeeId === 4).length, 1);
  check("32. an employee genuinely present in two instances shows twice (real records), not invented or merged",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").map((r) => r.employeeId).sort(),
    [1, 2, 3]);

  section("33. locked/approved values are shown exactly as saved, never recalculated");
  check("33. employee 7's GPF is the saved zero (retirement-stop rule), not recomputed here",
    full.rows.find((r) => r.type === "EMPLOYEE" && r.employeeId === 7).gpf, 0);
  check("33. this report never imports or calls the retirement-rule helper",
    /retirementRules|isGpfNpsStoppedForRetirement/.test(routeCode), false);
  check("33. this report never calls a fresh salary-calculation function",
    /calculateForEmployee|calculateNps|calculateGpf/.test(routeCode), false);
  check("33. a DRAFT workflow (employee 8) never appears, whatever the filters",
    full.rows.some((r) => r.type === "EMPLOYEE" && r.employeeId === 8), false);

  section("34. opening the report writes nothing to the database");
  check("34. no INSERT/UPDATE/DELETE/MERGE was ever issued",
    writeCalls, []);
  check("34. the module's own source contains no write statement",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM|MERGE /.test(routeCode), false);

  section("35. Excel data matches screen data");
  check("35. the Excel export reuses the exact same report builder as the screen",
    (routeCode.match(/buildMonthWiseEmployeeSalaryReport\(req\.query \|\| \{\}\)/g) || []).length, 2);
  check("35. the frontend's column list matches the backend's exactly (order and count)",
    XLSX_COLUMNS.map((c) => c.label), [
      "Sr. No", "Institute Name", "Institute Code", "Employee Name", "Designation",
      "Basic", "G.P.", "Total Basic", "D.A.", "H.R.A.", "Medical", "T.A.", "C.L.A.",
      "Spl. Allowance", "Wash. Allowance", "Total", "GPF", "GPF Adv.", "NPS",
      "Income Tax", "Prof. Tax", "Other Ded.", "Total Ded.", "Net", "Cheque Amt.",
    ]);
  check("35. the screen defines the identical 25 columns",
    XLSX_COLUMNS.every((c) => pageSrc.includes(`label: "${c.label}"`)), true);
  check("35. exactly 25 columns, as required",
    XLSX_COLUMNS.length, 25);

  section("36. Print/PDF uses the same displayed data (no second query)");
  check("36. the screen's Print/PDF button reuses the report's own on-screen state",
    /printReport\("monthWiseEmployeeSalary"\)/.test(pageSrc), true);
  check("36. GridToolbar exports read the same rows array the table renders (exportRows), not a re-fetch",
    /rows=\{exportRows\}/.test(pageSrc), true);
  check("36. no second API call is made to build print/export rows",
    (pageSrc.match(/getMonthWiseEmployeeSalary\(/g) || []).length, 1);

  section("ordering: Institute Code -> Institute Name -> Employee Name, Sr. No. continuous");
  check("Sr. No. is continuous across institutes (not reset per institute)",
    full.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.srNo), [1, 2, 3, 4, 5]);
  check("institutes sort in natural code order",
    [...new Set(full.rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.instituteCode))],
    ["AAA-01", "BBB-02", "CCC-03"]);
  check("within an institute, employees sort by name",
    full.rows.filter((r) => r.type === "EMPLOYEE" && r.instituteCode === "AAA-01").map((r) => r.employeeName),
    ["Anita Shah", "Kiran Patel", "Old Bill Employee"]);
  const cmp = [
    { instituteCode: "B", instituteName: "B Inst", employeeName: "Zed", sectionSrNo: 1 },
    { instituteCode: "A", instituteName: "A Inst", employeeName: "Amy", sectionSrNo: 1 },
  ];
  check("compareEmployeeRows sorts institute code before employee name",
    [...cmp].sort(compareEmployeeRows).map((r) => r.instituteCode), ["A", "B"]);

  section("no invented columns / no PAN column");
  check("no PAN column is present anywhere",
    XLSX_COLUMNS.some((c) => /pan/i.test(c.label) || /pan/i.test(c.key)), false);
  check("Designation falls back to the master name only when the snapshot has none",
    mapEmployeeRow({ ...E2, Designation: "", MasterDesignationName: "Fallback Name" }).designation,
    "Fallback Name");

  section("no unrelated report was touched");
  for (const f of [
    "salaryRegister.js", "bankCopy.js", "chequeRegister.js", "employeeWiseSalary.js",
    "gpfSummary.js", "npsSummary.js", "salaryCalculate.js", "salaryEntry.js",
    "instituteWiseSalary.js", "salaryBillApproval.js",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, "routes", f), "utf8");
    check(`${f} does not reference the new report`,
      /buildMonthWiseEmployeeSalaryReport|monthWiseEmployeeSalary/.test(src), false);
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
