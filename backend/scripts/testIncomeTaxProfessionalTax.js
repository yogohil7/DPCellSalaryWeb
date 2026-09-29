/*
  INCOME TAX & PROFESSIONAL TAX.

  Both figures must be the STORED dbo.SalaryEmployeeDetails columns, never
  recalculated and never taken from TotalDeduction. DA Difference must produce
  no row at all, because that schema has no IT/PT columns.

  Runs offline: the db module is stubbed and the shared loader's query is
  replaced by a fixture, so the real mapping / filtering / totalling pipeline
  is EXECUTED rather than pattern-matched.

  Usage: cd backend && npm run test:income-tax-professional-tax
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

const itp = require("../routes/incomeTaxProfessionalTax");
const {
  toTaxRow, hasTax, parseDeductionType, filterByDeductionType,
  filterByInstitute, filterByBillMonth, compareTaxRows,
  XLSX_COLUMNS, SCOPE_NOTE,
} = itp;
const { filterSalaryRows } = require("../routes/employeeWiseSalary");

const routeSrc = fs.readFileSync(
  path.join(ROOT, "routes", "incomeTaxProfessionalTax.js"), "utf8");
const routeCode = routeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const ewsSrc = fs.readFileSync(path.join(ROOT, "routes", "employeeWiseSalary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const FRONT = path.join(ROOT, "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "IncomeTaxProfessionalTax.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "incomeTaxProfessionalTax.css"), "utf8");
const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "incomeTaxProfessionalTaxApi.js"), "utf8");
const accessSrc = fs.readFileSync(path.join(FRONT, "utils", "accessControl.js"), "utf8");
const modulesSrc = fs.readFileSync(path.join(FRONT, "modules.js"), "utf8");
const daSchema =
  fs.readFileSync(path.join(ROOT, "sql", "schema", "33_DADifferenceAndEmployeeIncrement.sql"), "utf8") +
  fs.readFileSync(path.join(ROOT, "sql", "schema", "34_DADifferenceNPSDeduction.sql"), "utf8");

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

/* ---- fixture: a raw row shaped as loadEmployeeSalaryRows() returns it ---- */
function raw(over) {
  return {
    BillCodeId: 11, BillCode: "JUN-2026",
    BillMonth: "JUN-2026", SalaryMonth: "June",
    SalaryMonthNumber: "06", SalaryYear: "2026",
    BillCategory: "Salary", BillType: "Regular Salary",
    WorkflowStatus: "APPROVED", BillNo: "598", BillDate: "2026-07-22",
    InstituteCode: "CPD-06", InstituteName: "CPD Six",
    SectionId: 1, SectionSrNo: 1, SectionName: "CPD",
    DetailId: 1, EmployeeId: 2002, EmployeeName: "Alpha",
    EmployeeCode: "E2002", Designation: "Peon", EmployeeType: "REGULAR",
    MasterDesignationName: "Peon", DisplayOrder: 1,
    BasicPay: 34400, GradePay: 0, TotalBasic: 34400,
    DA: 20640, HRA: 0, MA: 0, TA: 0, CLA: 0,
    SpecialAllowance: 0, WashingAllowance: 0, GrossSalary: 55040,
    GPFSubscription: 2000, GPFAdvance: 1200, NPS: 0,
    IncomeTax: 500, ProfessionalTax: 200, OtherDeduction: 100,
    /* Deliberately unequal to IT+PT so any use of it is visible. */
    TotalDeduction: 4000,
    NetSalary: 51040, ChequeAmount: 51040,
    ...over,
  };
}
const P = { month: 6, year: 2026 };

(function main() {
  console.log("=".repeat(76));
  console.log("INCOME TAX & PROFESSIONAL TAX");
  console.log("=".repeat(76));

  section("1-3. route, auth and permission");
  check("1. the route is registered",
    /\/api\/income-tax-professional-tax"/.test(serverSrc), true);
  check("2-3. behind the shared auth + permission gate",
    /\/api\/income-tax-professional-tax",\s*\.\.\.authed,\s*requirePermissionPrefix\(/
      .test(serverSrc), true);
  check("3. reusing REPORT_SALARY, inventing no permission",
    /"\/api\/income-tax-professional-tax"[^\n]*requirePermissionPrefix\("REPORT_BILL", "REPORT_SALARY", "SALARY_APPROVAL"\)/
      .test(serverSrc), true);
  check("3. the module maps to REPORT_SALARY",
    /"income-tax-professional-tax": "REPORT_SALARY"/.test(accessSrc), true);
  check("the menu entry exists",
    /id: "income-tax-professional-tax"/.test(modulesSrc), true);
  check("1. the shared builder is exported",
    typeof itp.buildIncomeTaxProfessionalTaxReport, "function");

  section("4-10. the stored columns are the source");
  {
    const row = toTaxRow(raw());
    check("4. Income Tax comes from IncomeTax", row.incomeTax, 500);
    check("5. Professional Tax comes from ProfessionalTax", row.professionalTax, 200);
    check("6-7. the stored values pass through unchanged",
      [toTaxRow(raw({ IncomeTax: 1234.56, ProfessionalTax: 78.9 })).incomeTax,
       toTaxRow(raw({ IncomeTax: 1234.56, ProfessionalTax: 78.9 })).professionalTax],
      [1234.56, 78.9]);
    check("8. TotalDeduction is NOT the tax source",
      [row.incomeTax === 4000, row.professionalTax === 4000, row.total === 4000],
      [false, false, false]);
    check("8. the route never reads TotalDeduction for a tax figure",
      /incomeTax:\s*round2\(base\.totalDeduction\)|professionalTax:\s*round2\(base\.totalDeduction\)|total:\s*round2\(base\.totalDeduction\)/
        .test(routeCode), false);
    check("9-10. no tax is recalculated from salary components",
      /basic|totalBasic|grossSalary|GrossSalary|\* 0\.|Math\.ceil/.test(routeCode), false);
    check("35. Total is exactly IT + PT", row.total, 700);
    check("35. and follows the stored pair, not TotalDeduction",
      toTaxRow(raw({ IncomeTax: 10, ProfessionalTax: 5, TotalDeduction: 9999 })).total, 15);
  }

  section("11-16. filters");
  {
    const rows = [
      toTaxRow(raw({ DetailId: 1, EmployeeId: 1, EmployeeName: "Alpha" })),
      toTaxRow(raw({ DetailId: 2, EmployeeId: 2, EmployeeName: "Bravo",
                     InstituteCode: "CPD-17", InstituteName: "CPD Seventeen" })),
      toTaxRow(raw({ DetailId: 3, EmployeeId: 3, EmployeeName: "Cara",
                     InstituteCode: "OGE-05", SectionId: 2, SectionSrNo: 2,
                     SectionName: "OGE" })),
      toTaxRow(raw({ DetailId: 4, EmployeeId: 4, EmployeeName: "Delta",
                     BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026" })),
    ];
    check("11-12. the selected salary month/year keeps them all",
      filterSalaryRows(rows, P).length, 4);
    check("11-12. a different salary month returns nothing",
      filterSalaryRows(rows, { month: 1, year: 2026 }).length, 0);
    check("13. the Bill Month filter narrows independently",
      filterByBillMonth(rows, 5, 2026).map((r) => r.employeeName), ["Delta"]);
    check("13. Bill Month June returns the other three",
      filterByBillMonth(rows, 6, 2026).length, 3);
    check("13. a blank Bill Month keeps every row",
      filterByBillMonth(rows, "", "").length, 4);
    check("14. Section filtering",
      filterSalaryRows(rows, { ...P, sectionId: 2 }).map((r) => r.employeeName),
      ["Cara"]);
    check("15. Institute filtering",
      filterByInstitute(rows, "CPD-17").map((r) => r.employeeName), ["Bravo"]);
    check("15. ALL keeps every institute", filterByInstitute(rows, "ALL").length, 4);
    check("16. Salary Type OLD",
      filterSalaryRows(rows, { ...P, salaryType: "OLD" }).map((r) => r.employeeName),
      ["Delta"]);
    /*
       UPDATED with the Regular-includes-Old requirement. Delta's bill is an
       ordinary salary bill of the SAME selected Salary Month carrying an
       earlier Bill Month, so it belongs in that month's Regular Salary
       report. Excluding it under-reported the period. "OLD" above is still a
       genuine narrowing option. See utils/salaryMonthKey.js.
    */
    check("16. Salary Type REGULAR includes the OLD bill of the same Salary Month",
      filterSalaryRows(rows, { ...P, salaryType: "REGULAR" })
        .some((r) => r.employeeName === "Delta"), true);
  }

  section("17-19. deduction type");
  {
    const rows = [
      toTaxRow(raw({ DetailId: 1, EmployeeId: 1, EmployeeName: "BothTax",
                     IncomeTax: 500, ProfessionalTax: 200 })),
      toTaxRow(raw({ DetailId: 2, EmployeeId: 2, EmployeeName: "ItOnly",
                     IncomeTax: 700, ProfessionalTax: 0 })),
      toTaxRow(raw({ DetailId: 3, EmployeeId: 3, EmployeeName: "PtOnly",
                     IncomeTax: 0, ProfessionalTax: 300 })),
    ];
    check("17. ALL keeps every taxed row",
      filterByDeductionType(rows, "ALL").length, 3);
    check("18. Income Tax keeps only rows with IT",
      filterByDeductionType(rows, "INCOME_TAX").map((r) => r.employeeName),
      ["BothTax", "ItOnly"]);
    check("19. Professional Tax keeps only rows with PT",
      filterByDeductionType(rows, "PROFESSIONAL_TAX").map((r) => r.employeeName),
      ["BothTax", "PtOnly"]);
    check("17-19. the parser accepts short and long forms",
      [parseDeductionType(""), parseDeductionType("IT"), parseDeductionType("PT"),
       parseDeductionType("income tax"), parseDeductionType("nonsense")],
      ["ALL", "INCOME_TAX", "PROFESSIONAL_TAX", "INCOME_TAX", "ALL"]);
    check("17-19. selecting a type never alters a stored amount",
      filterByDeductionType(rows, "INCOME_TAX").map((r) => r.incomeTax), [500, 700]);
  }

  section("20-26. eligibility is enforced in SQL by the shared loader");
  check("20-21. only APPROVED and LOCKED are loaded",
    /IN \(N'APPROVED', N'LOCKED'\)/.test(ewsSrc), true);
  check("22-25. DRAFT, SUBMITTED, RETURNED and REJECTED are therefore excluded",
    /N'DRAFT'|N'SUBMITTED'|N'RETURNED'|N'REJECTED'/.test(ewsSrc), false);
  check("26. archived bills are excluded",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(ewsSrc), true);
  check("20-26. the route adds no status logic that could relax this",
    /WorkflowStatus\s*===|IsArchived/.test(routeCode), false);
  check("the report runs no second query of its own",
    /FROM dbo\.|sql\.query/.test(routeCode), false);

  section("27-29. REGULAR / OLD");
  {
    const reg = toTaxRow(raw());
    const old = toTaxRow(raw({ DetailId: 2, BillCode: "JUN-2026-BM-MAY",
                               BillMonth: "MAY-2026" }));
    check("27. a REGULAR bill is identified", reg.billType, "REGULAR");
    check("28. an OLD bill is identified", old.billType, "OLD");
    check("27-28. via the shared resolver, not a new algorithm",
      /resolveChequeSalaryType/.test(routeCode), false);
    check("27-28. it inherits the type mapSalaryRow already resolved",
      /billType: base\.type/.test(routeCode), true);
    check("29. both months stay distinguishable",
      [old.salaryMonth, old.billMonth], ["JUN-2026", "MAY-2026"]);
    check("29. REGULAR and OLD remain two rows, never merged",
      filterSalaryRows([reg, old], P).length, 2);
    check("29. and their taxes are never combined into one row",
      filterSalaryRows([reg, old], P).map((r) => r.total), [700, 700]);
    check("29. Bill Month is resolved by its own parser",
      /billMonthPartsOf\(/.test(routeCode), true);
  }

  section("30-31. DA Difference");
  check("30. the DA loader is never called",
    /loadDaDifferenceRows/.test(routeCode), false);
  check("30. DA bills are excluded by the shared query",
    /<> N'DIFFERENCE'/.test(ewsSrc) && /<> N'DA DIFFERENCE'/.test(ewsSrc), true);
  check("31. no DA field is read",
    /TotalDifferenceAmount|TotalNPSDeduction|TotalNetDifferenceAmount/.test(routeCode),
    false);
  check("31. the DA schema genuinely has no IT/PT column to read",
    /IncomeTax|ProfessionalTax/.test(daSchema), false);
  check("30. the exclusion is stated on the report, not left implied",
    /DA Difference bills are excluded because Income Tax and Professional Tax are not stored for DA Difference\./
      .test(SCOPE_NOTE), true);
  check("30. and the screen prints that note",
    /report\.scopeNote/.test(pageSrc), true);

  section("32-34. the zero-row rule");
  {
    const both0 = toTaxRow(raw({ IncomeTax: 0, ProfessionalTax: 0 }));
    const itOnly = toTaxRow(raw({ IncomeTax: 700, ProfessionalTax: 0 }));
    const ptOnly = toTaxRow(raw({ IncomeTax: 0, ProfessionalTax: 300 }));
    check("32. a row with no tax at all is excluded", hasTax(both0), false);
    check("33. IT non-zero, PT zero is included", hasTax(itOnly), true);
    check("34. IT zero, PT non-zero is included", hasTax(ptOnly), true);
    check("32-34. across a set",
      [both0, itOnly, ptOnly].filter(hasTax).map((r) => r.total), [700, 300]);
    check("32. a zero row is dropped, never shown as 0.00",
      [both0, itOnly].filter(hasTax).some((r) => r.total === 0), false);
  }

  section("36. totals follow the displayed rows");
  {
    const rows = [
      toTaxRow(raw({ DetailId: 1, EmployeeId: 1, IncomeTax: 500, ProfessionalTax: 200 })),
      toTaxRow(raw({ DetailId: 2, EmployeeId: 2, IncomeTax: 300, ProfessionalTax: 100,
                     InstituteCode: "CPD-17" })),
      toTaxRow(raw({ DetailId: 3, EmployeeId: 3, IncomeTax: 0, ProfessionalTax: 0 })),
    ];
    const shown = filterByInstitute(rows.filter(hasTax), "CPD-06");
    const totals = shown.reduce(
      (a, r) => ({
        incomeTax: a.incomeTax + r.incomeTax,
        professionalTax: a.professionalTax + r.professionalTax,
        total: a.total + r.total,
      }),
      { incomeTax: 0, professionalTax: 0, total: 0 }
    );
    check("36. the filtered-out institute does not reach the totals",
      [totals.incomeTax, totals.professionalTax, totals.total], [500, 200, 700]);
    check("36. nor does the dropped zero row", shown.length, 1);
    check("36. the builder totals the displayed rows array",
      /const totals = numbered\.reduce\(/.test(routeCode), true);
    check("36. and never sums TotalDeduction",
      /reduce[\s\S]{0,300}totalDeduction/.test(routeCode), false);
    check("36. employee count is distinct over displayed rows",
      /new Set\(numbered\.map\(\(row\) => row\.employeeId\)\)\.size/.test(routeCode), true);
  }

  section("37-38. Excel");
  check("37. the export reuses the same builder",
    (routeCode.match(/await buildIncomeTaxProfessionalTaxReport\(req\.query \|\| \{\}\)/g) || []).length, 2);
  check("37. and runs no calculation of its own",
    /reduce\(/.test(routeCode.slice(routeCode.indexOf('router.get("/export.xlsx"'))), false);
  check("38. the export totals row reads the report's totals",
    /Number\(data\.totals\.incomeTax\)/.test(routeCode) &&
      /Number\(data\.totals\.professionalTax\)/.test(routeCode) &&
      /Number\(data\.totals\.total\)/.test(routeCode), true);
  check("37. one shared param builder serves screen and export",
    (apiSrc.match(/buildFilterParams\(filters\)/g) || []).length, 2);
  check("the fourteen columns, in order",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "Employee ID", "Employee Name", "Designation", "Section",
     "Institute Code", "Institute Name", "Salary Month", "Bill Month",
     "Bill Type", "Salary Type", "Income Tax", "Professional Tax", "Total"]);
  check("the screen declares the same fourteen",
    (pageSrc.match(/\{ key: "/g) || []).length, XLSX_COLUMNS.length);

  section("39-40. print");
  /* 2026-09-24: every report except Cheque Register prints A4 PORTRAIT. */
  check("39. A4 portrait is declared (reportPdfConfig)",
    (new RegExp("incomeTaxProfessionalTax: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "IncomeTaxProfessionalTax.jsx"), "utf8").includes('useReportPrintPage("incomeTaxProfessionalTax")')), true);
  check("39. the table header repeats on every page",
    /thead\s*\{\s*display:\s*table-header-group/.test(cssSrc), true);
  check("39. the scoped shell reset is present",
    /\.app-shell[\s\S]{0,200}overflow:\s*visible/.test(cssSrc), true);
  check("39. controls are marked no-print", /no-print/.test(pageSrc), true);
  check("39. the horizontal scroller is released for print",
    /\.itp-table-wrap[\s\S]{0,80}overflow:\s*visible/.test(cssSrc), true);
  check("40. the global visibility-hidden hack is NOT used",
    /body \*\s*\{[^}]*visibility:\s*hidden/.test(cssSrc), false);

  section("nothing is fabricated, nothing is written");
  check("the report writes nothing",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeCode), false);
  check("no schema statement was introduced",
    /ALTER TABLE|CREATE TABLE/.test(routeCode), false);
  check("no credential or host literal",
    /password|secret|jwt|https?:\/\//i.test(routeCode), false);
  check("sorting reuses the shared natural comparator",
    /compareGroupCodes\(/.test(routeCode), true);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
