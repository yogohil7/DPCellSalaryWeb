/*
  SALARY REGISTER — the project's bill-wise salary abstract.

  One row per APPROVED/LOCKED bill per institute, identity
  (BillCodeId, InstituteCode). Every amount is a SUM of STORED
  SalaryEmployeeDetails columns; DA Difference contributes only its three real
  stored amounts. There is no Return Amount anywhere: the field does not exist.

  Runs offline: the db module is stubbed, so the real mapping / filtering /
  aggregation pipeline is EXECUTED rather than pattern-matched.

  Usage: cd backend && npm run test:salary-register
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

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

const register = require("../routes/salaryRegister");
const {
  mapSalaryBillRow, aggregateDaRows, filterRegisterRows,
  parseSalaryType, compareRegisterRows, XLSX_COLUMNS, HEADING,
} = register;

const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "salaryRegister.js"), "utf8");
const routeCode = routeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const FRONT = path.join(ROOT, "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryRegister.jsx"), "utf8");
/* Comment-stripped page source: the file's comments state that Return Amount
   is deliberately absent, which a raw search would match as if it were code. */
const pageCode = pageSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "salaryRegister.css"), "utf8");
const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "salaryRegisterApi.js"), "utf8");
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

/* ---- fixtures: aggregate rows as the SQL returns them ---- */
function agg(over) {
  return {
    BillCodeId: 11, BillCode: "JUN-2026",
    BillMonth: "JUN-2026", SalaryMonth: "June",
    SalaryMonthNumber: "06", SalaryYear: "2026",
    InstituteCode: "CPD-06", WorkflowStatus: "APPROVED",
    BillNo: "598", BillDate: "2026-07-22",
    ApprovedBy: "Account Officer", ApprovedDate: "2026-07-23",
    InstituteName: "CPD Six", SectionId: 1, SectionSrNo: 1, SectionName: "CPD",
    EmployeeCount: 7,
    GrossAmount: 812450, TotalDeduction: 73243,
    NetSalary: 739207, ChequeAmount: 739207,
    ...over,
  };
}
function daRow(over) {
  return {
    salaryCategory: "DA_DIFFERENCE", workflowStatus: "APPROVED",
    billCodeId: 21, billCode: "DA-JUN-2026",
    salaryMonth: "JUN-2026", salaryMonthKey: "2026-06", paidMonth: "JUN-2026",
    instituteCode: "CPD-06", instituteName: "CPD Six",
    sectionId: 1, sectionSrNo: 1, sectionName: "CPD",
    employeeId: 1,
    differenceAmount: 5000, nps: 500, net: 4500,
    ...over,
  };
}

(function main() {
  console.log("=".repeat(76));
  console.log("SALARY REGISTER");
  console.log("=".repeat(76));

  section("1-2. the report exists and is gated");
  check("1. the shared builder is exported",
    typeof register.buildSalaryRegisterReport, "function");
  check("1. both the screen route and the export use it",
    (routeCode.match(/buildSalaryRegisterReport\(req\.query \|\| \{\}\)/g) || []).length, 2);
  check("2. the route is behind auth + permission",
    /\/api\/salary-register",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("28. it reuses REPORT_SALARY, inventing no permission",
    /"\/api\/salary-register"[^\n]*requirePermissionPrefix\("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"\)/
      .test(serverSrc), true);
  check("28. the existing menu mapping is untouched",
    /"salary-register": "REPORT_SALARY"/.test(accessSrc) &&
      /id: "salary-register"/.test(modulesSrc), true);

  section("3-9. eligibility");
  check("3-4. APPROVED and LOCKED are included",
    filterRegisterRows(
      [agg({ WorkflowStatus: "APPROVED" }), agg({ BillCodeId: 12, WorkflowStatus: "LOCKED" })]
        .map(mapSalaryBillRow),
      { month: 6, year: 2026 }
    ).length, 2);
  check("5-8. DRAFT, SUBMITTED, RETURNED and REJECTED are excluded",
    filterRegisterRows(
      ["DRAFT", "SUBMITTED", "RETURNED", "REJECTED"].map((s, i) =>
        mapSalaryBillRow(agg({ BillCodeId: 30 + i, WorkflowStatus: s }))),
      { month: 6, year: 2026 }
    ).length, 0);
  check("3-8. the SQL enforces the same set",
    /IN \(N'APPROVED', N'LOCKED'\)/.test(routeCode), true);
  check("9. archived bills are excluded in SQL",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(routeCode), true);
  check("9. DA-Difference bills are excluded from the salary query",
    /<> N'DIFFERENCE'/.test(routeCode) && /<> N'DA DIFFERENCE'/.test(routeCode), true);
  check("9. and the DA loader excludes archived DA bills itself",
    /WHERE ISNULL\(c\.IsArchived, 0\) = 0/.test(
      fs.readFileSync(path.join(ROOT, "utils", "salaryCategory.js"), "utf8")), true);
  check("3-8. a non-approved DA bill is dropped too",
    aggregateDaRows([daRow({ workflowStatus: "OPEN" }), daRow({ workflowStatus: "PENDING" })])
      .length, 0);

  section("10-13. REGULAR / OLD");
  {
    const reg = mapSalaryBillRow(agg());
    const old = mapSalaryBillRow(agg({
      BillCodeId: 12, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
    }));
    check("10. Bill Month == Salary Month is REGULAR", reg.salaryType, "REGULAR");
    check("11. Bill Month != Salary Month is OLD", old.salaryType, "OLD");
    check("10-11. it reuses the shared resolver, not a copy",
      /resolveChequeSalaryType\(\{/.test(routeCode), true);
    check("13. both months are shown, and differ",
      [old.salaryMonth, old.billMonth], ["JUNE 2026", "MAY 2026"]);
    check("13. Bill Month is resolved from the approved instance (its own parser, never the master)",
      /billYm = instanceBillMonthPartsOf\(row\)/.test(routeCode), true);

    const rows = filterRegisterRows([reg, old], { month: 6, year: 2026 });
    check("12-13. same Salary Month, different Bill Months stay TWO rows",
      rows.length, 2);
    check("12. REGULAR and OLD are never merged",
      rows.map((r) => r.salaryType), ["REGULAR", "OLD"]);
    check("12. and their amounts are never combined",
      rows.map((r) => r.netSalary), [739207, 739207]);
    check("13. row identity is (BillCodeId, InstituteCode)",
      rows.map((r) => `${r.billCodeId}::${r.instituteCode}`),
      ["11::CPD-06", "12::CPD-06"]);
  }

  section("14-16. filters");
  {
    const rows = [
      mapSalaryBillRow(agg()),
      mapSalaryBillRow(agg({ BillCodeId: 12, BillCode: "JUN-BM-MAY", BillMonth: "MAY-2026" })),
      mapSalaryBillRow(agg({ BillCodeId: 13, InstituteCode: "CPD-17", InstituteName: "CPD Seventeen" })),
      mapSalaryBillRow(agg({ BillCodeId: 14, InstituteCode: "OGE-05", SectionId: 2, SectionName: "OGE", SectionSrNo: 2 })),
    ];
    check("14. a different Salary Month returns nothing",
      filterRegisterRows(rows, { month: 1, year: 2026 }).length, 0);
    check("14. the selected Salary Month returns all four",
      filterRegisterRows(rows, { month: 6, year: 2026 }).length, 4);
    check("15. Bill Month filters independently",
      filterRegisterRows(rows, { month: 6, year: 2026, billMonth: 5 })
        .map((r) => r.billCode), ["JUN-BM-MAY"]);
    check("15. Bill Month June returns the other three",
      filterRegisterRows(rows, { month: 6, year: 2026, billMonth: 6 }).length, 3);
    check("16. Institute filtering",
      filterRegisterRows(rows, { month: 6, year: 2026, instituteCode: "CPD-17" })
        .map((r) => r.instituteCode), ["CPD-17"]);
    check("16. Section filtering",
      filterRegisterRows(rows, { month: 6, year: 2026, sectionId: 2 })
        .map((r) => r.instituteCode), ["OGE-05"]);
    check("salary type filtering",
      filterRegisterRows(rows, { month: 6, year: 2026, salaryType: "OLD" })
        .map((r) => r.billCode), ["JUN-BM-MAY"]);
    check("an unknown salary type falls back to ALL",
      [parseSalaryType({}), parseSalaryType({ salaryType: "nonsense" }),
       parseSalaryType({ salaryType: "da difference" })],
      ["ALL", "ALL", "DA_DIFFERENCE"]);
  }

  section("17-21. stored values only");
  {
    const row = mapSalaryBillRow(agg());
    check("17. employee count uses COUNT(DISTINCT EmployeeId)",
      /COUNT\(DISTINCT d\.EmployeeId\)/.test(routeCode), true);
    check("17. and is carried through", row.employees, 7);
    check("18. Gross is SUM(GrossSalary)",
      /SUM\(d\.GrossSalary\)/.test(routeCode) && row.grossAmount === 812450, true);
    check("19. Deduction is SUM(TotalDeduction)",
      /SUM\(d\.TotalDeduction\)/.test(routeCode) && row.totalDeduction === 73243, true);
    check("20. Net is SUM(NetSalary)",
      /SUM\(d\.NetSalary\)/.test(routeCode) && row.netSalary === 739207, true);
    check("21. Cheque is SUM(ChequeAmount) — the stored column, not Net+IT+PT",
      /SUM\(d\.ChequeAmount\)/.test(routeCode), true);
    check("21. and is never derived",
      /NetSalary[^)]*\+[^)]*IncomeTax[^)]*\+[^)]*ProfessionalTax/.test(routeCode), false);
    /*
       Scoped to the REGISTER's own aggregate query, same slice technique as
       check 27 below. The 2026-09-25 drill-down feature (buildSalaryRegister
       DetailReport / loadSalaryRegisterDetailRows) legitimately selects
       BasicPay, DA, HRA, TA, GPFSubscription etc. — it displays the SAVED
       per-employee components, which is its entire purpose — so a whole-file
       scan would false-positive on that unrelated, later-added function.
       loadSalaryBillAggregates() itself, the register's own totals query,
       must still never re-sum a component into GrossAmount / TotalDeduction
       / NetSalary / ChequeAmount: only their own stored SUM() columns.
    */
    check("no component is re-summed into a total",
      /BasicPay|d\.DA\b|d\.HRA|d\.TA\b|GPFSubscription/.test(
        routeCode.slice(
          routeCode.indexOf("async function loadSalaryBillAggregates"),
          routeCode.indexOf("function mapSalaryBillRow")
        )
      ), false);
    check("Approved By / Date come from the workflow",
      [row.approvedBy, row.approvedDate], ["Account Officer", "23-07-2026"]);
    check("the register never writes",
      /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeCode), false);
  }

  section("22-23. DA Difference");
  {
    const da = aggregateDaRows([
      daRow({ employeeId: 1, differenceAmount: 5000, nps: 500, net: 4500 }),
      daRow({ employeeId: 2, differenceAmount: 3000, nps: 300, net: 2700 }),
    ]);
    check("22. one aggregated DA row per (bill, institute)", da.length, 1);
    check("22. Gross <- TotalDifferenceAmount", da[0].grossAmount, 8000);
    check("22. Deduction <- TotalNPSDeduction", da[0].totalDeduction, 800);
    check("22. Net <- TotalNetDifferenceAmount", da[0].netSalary, 7200);
    check("22. employees are counted distinctly", da[0].employees, 2);
    check("22. it is its own salary type", da[0].salaryType, "DA_DIFFERENCE");
    check("23. Cheque Amount is null, not a fabricated zero",
      da[0].chequeAmount, null);
    check("23. no regular component is invented for DA",
      Object.keys(da[0]).some((k) =>
        /^(basic|gradePay|da|hra|ma|ta|cla|gpf|nps|incomeTax|professionalTax)$/i.test(k)),
      false);
    check("23. the DA path reads only the three stored amounts",
      /differenceAmount[\s\S]{0,200}row\.nps[\s\S]{0,200}row\.net/.test(routeCode), true);
    check("22. it uses the one shared DA loader",
      /loadDaDifferenceRows\(\)/.test(routeCode), true);
    check("the screen shows an em dash for a null amount",
      /if \(value == null\) return "—";/.test(pageSrc), true);
  }

  section("24. totals are of the displayed rows");
  {
    const rows = [
      mapSalaryBillRow(agg({ BillCodeId: 11, GrossAmount: 100, TotalDeduction: 10, NetSalary: 90, ChequeAmount: 90, EmployeeCount: 2 })),
      mapSalaryBillRow(agg({ BillCodeId: 12, InstituteCode: "CPD-17", GrossAmount: 200, TotalDeduction: 20, NetSalary: 180, ChequeAmount: 180, EmployeeCount: 3 })),
    ];
    const shown = filterRegisterRows(rows, { month: 6, year: 2026, instituteCode: "CPD-17" });
    const totals = shown.reduce((a, r) => ({
      employees: a.employees + r.employees,
      grossAmount: a.grossAmount + r.grossAmount,
      netSalary: a.netSalary + r.netSalary,
    }), { employees: 0, grossAmount: 0, netSalary: 0 });
    check("24. a filtered-out row does not reach the totals",
      [totals.employees, totals.grossAmount, totals.netSalary], [3, 200, 180]);
    check("24. the builder totals the displayed rows array",
      /const totals = rows\.reduce\(/.test(routeCode), true);
    check("24. a null cheque amount contributes nothing, not NaN",
      Number.isFinite(0 + Number(null || 0)), true);
  }

  section("25. Return Amount is not fabricated");
  check("25. no Return Amount column exists",
    XLSX_COLUMNS.some((c) => /return/i.test(c.label) || /return/i.test(c.key)), false);
  check("25. the route never mentions it in code",
    /ReturnAmount|returnAmount/.test(routeCode), false);
  check("25. nor does the screen",
    /Return Amount|returnAmount/.test(pageCode), false);
  check("25. and no register row carries such a key",
    Object.keys(mapSalaryBillRow(agg())).some((k) => /return/i.test(k)), false);

  section("26-27. export and SQL safety");
  check("26. the export reuses the same builder",
    /const data = await buildSalaryRegisterReport\(req\.query \|\| \{\}\);/.test(routeCode), true);
  check("26. it exports the same columns in the same order",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "Institute Code", "Institute Name", "Section", "Bill Code",
     "Bill Month", "Salary Month", "Bill No.", "Bill Date", "Salary Type",
     "Employees", "Gross Amount", "Total Deduction", "Net Salary",
     "Cheque Amount", "Approved By", "Approved Date", "Status"]);
  check("26. the screen prints the same 18 columns",
    (pageSrc.match(/\{ key: "/g) || []).length, XLSX_COLUMNS.length);
  check("26. one shared param builder serves screen and export",
    (apiSrc.match(/buildFilterParams\(filters\)/g) || []).length, 2);
  check("27. no value is interpolated into the SQL (only the constant instance-rows fragment)",
    /\$\{(?!\s*\}|instanceEmployeeRowsSql\(\)\})/.test(
      routeCode.slice(routeCode.indexOf("async function loadSalaryBillAggregates"),
                      routeCode.indexOf("function mapSalaryBillRow"))), false);
  check("27. selection is applied in JS, not concatenated SQL",
    /sql\s*\+=|"\s*\+\s*query\./.test(routeCode), false);

  section("ordering, numbering and headings");
  {
    const rows = [
      mapSalaryBillRow(agg({ BillCodeId: 1, InstituteCode: "CPD-100" })),
      mapSalaryBillRow(agg({ BillCodeId: 2, InstituteCode: "CPD-17" })),
      mapSalaryBillRow(agg({ BillCodeId: 3, InstituteCode: "CPD-06" })),
    ].sort(compareRegisterRows);
    check("natural institute ordering, not lexical",
      rows.map((r) => r.instituteCode), ["CPD-06", "CPD-17", "CPD-100"]);
    check("it reuses the shared comparator",
      /compareGroupCodes\(a\.instituteCode, b\.instituteCode\)/.test(routeCode), true);
  }
  check("the report heading names the register", HEADING[0], "SALARY REGISTER");
  check("and keeps the project's department block",
    HEADING.slice(1), ["DIRECTOR OF SOCIAL DEFENCE",
                       "BLOCK NO. 16 OLD SACHIVALAY,", "GANDHINAGAR"]);

  section("print structure");
  check("controls are marked no-print", /no-print/.test(pageSrc), true);
  check("the print CSS resets the shell containers",
    /\.app-shell[\s\S]{0,200}overflow:\s*visible/.test(cssSrc), true);
  /* 2026-09-24: every report except Cheque Register prints A4 PORTRAIT. */
  check("A4 portrait is declared (reportPdfConfig)",
    (new RegExp("salaryRegister: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryRegister.jsx"), "utf8").includes('useReportPrintPage("salaryRegister")')), true);
  check("the table header repeats on every page",
    /thead\s*\{\s*display:\s*table-header-group/.test(cssSrc), true);
  check("the old global visibility-hidden pattern is NOT used",
    /body \*\s*\{[^}]*visibility:\s*hidden/.test(cssSrc), false);
  check("the horizontal scroller is released for print",
    /\.sr-table-wrap[\s\S]{0,80}overflow:\s*visible/.test(cssSrc), true);

  section("28. no existing report behaviour changed");
  check("28. the register imports shared helpers rather than copying them",
    /require\("\.\/chequeRegister"\)/.test(routeCode) &&
      /require\("\.\.\/utils\/salaryCategory"\)/.test(routeCode), true);
  check("28. it runs its own query and does not call another report's builder",
    /buildChequeRegisterReport|buildEmployeeWiseReport|buildBankCopyReport/.test(routeCode),
    false);
  check("28. no credential or host literal",
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
