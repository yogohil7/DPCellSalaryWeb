/**
 * NPS / GPF DEDUCTION REPORT — value-level offline tests.
 * Usage: cd backend && npm run test:nps-gpf-deduction
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

const rep = require("../routes/npsGpfDeduction");
const { toDeductionRow, hasDeduction, compareDeductionRows, filterByInstitute,
        filterByDeductionType, parseDeductionType,
        buildEmployeeTotals, sumTotals, XLSX_COLUMNS } = rep;
const { filterSalaryRows } = require("../routes/employeeWiseSalary");
const gpf = require("../routes/gpfSummary");
const nps = require("../routes/npsSummary");

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "npsGpfDeduction.js"), "utf8");
const ewsSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "employeeWiseSalary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "NpsGpfDeduction.jsx"), "utf8");
const cssSrc  = fs.readFileSync(path.join(FRONT, "pages", "npsGpfDeduction.css"), "utf8");
const modulesSrc = fs.readFileSync(path.join(FRONT, "modules.js"), "utf8");
const shellSrc = fs.readFileSync(path.join(FRONT, "components", "AppShell.jsx"), "utf8");
const accessSrc = fs.readFileSync(path.join(FRONT, "utils", "accessControl.js"), "utf8");

/* ===================== FIXTURE ===================== */
const JAN = { BillCode:"JAN-2026", BillMonth:"JAN-2026", SalaryMonth:"January", SalaryMonthNumber:"01", SalaryYear:"2026" };
const FEB = { BillCode:"FEB-2026", BillMonth:"FEB-2026", SalaryMonth:"February", SalaryMonthNumber:"02", SalaryYear:"2026" };
const JUN = { BillCode:"JUN-2026", BillMonth:"JUN-2026", SalaryMonth:"June", SalaryMonthNumber:"06", SalaryYear:"2026" };
/* Salary month JUNE, Bill Month MAY -> OLD */
const JUN_BM_MAY = { BillCode:"JUN-2026-BM-MAY", BillMonth:"MAY-2026", SalaryMonth:"June", SalaryMonthNumber:"06", SalaryYear:"2026" };
/* DA Difference bill — must never appear */
/* DA Difference bills are excluded by the loader's SQL (see the assertion
   below), which an offline fixture cannot exercise — so none is fed here. */

const row = (o) => ({
  BillCodeId: 1, WorkflowStatus: "APPROVED", BillCategory: "Salary", BillType: "Salary",
  InstituteCode: o.code, InstituteName: o.instName || o.code,
  SectionId: o.secId, SectionSrNo: o.secSr, SectionName: o.secName,
  EmployeeId: o.emp, EmployeeName: o.name, EmployeeCode: String(o.emp),
  Designation: o.desig || "Clerk", MasterDesignationName: o.desig || "Clerk",
  GPFSubscription: o.gpf || 0, GPFAdvance: o.adv || 0, NPS: o.nps || 0,
  BasicPay: 34400, GrossSalary: 50000, NetSalary: 40000,
  ...(o.bill || JUN),
});

const ROWS = [
  /* CPD-06, section sr 1 — employee 2002 with REGULAR and OLD for June */
  row({ code:"CPD-06", instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section",
        emp:2002, name:"Ramanbhai D. Damor", gpf:2000, adv:500, nps:0, bill:JUN }),
  row({ code:"CPD-06", instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section",
        emp:2002, name:"Ramanbhai D. Damor", gpf:2000, adv:0, nps:0, bill:JUN_BM_MAY }),
  /* same employee, earlier months */
  row({ code:"CPD-06", instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section",
        emp:2002, name:"Ramanbhai D. Damor", gpf:2000, nps:0, bill:JAN }),
  row({ code:"CPD-06", instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section",
        emp:2002, name:"Ramanbhai D. Damor", gpf:2000, nps:0, bill:FEB }),
  /* NPS employee, no GPF */
  row({ code:"CPD-17", instName:"Samarpan Kendra", secId:11, secSr:1, secName:"CPD Section",
        emp:2007, name:"Varshaba A. Chavda", gpf:0, adv:0, nps:1850, bill:JUN }),
  /* natural sort probes inside the same section */
  row({ code:"CPD-100", instName:"Late Code", secId:11, secSr:1, secName:"CPD Section",
        emp:2008, name:"Rinaben R. Mhatre", gpf:1000, nps:0, bill:JUN }),
  /* second section, must sort AFTER section sr 1 */
  row({ code:"OGE-05", instName:"Samanya Vruddhashram", secId:4, secSr:2, secName:"OGE Section",
        emp:2011, name:"Pradyuman N. Yadav", gpf:0, nps:1900, bill:JUN }),
  /* both zero -> must be dropped */
  row({ code:"CPD-06", instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section",
        emp:2009, name:"Zero Deduction Emp", gpf:0, adv:0, nps:0, bill:JUN }),
  /* not approved -> excluded */
  { ...row({ code:"CPD-06", secId:11, secSr:1, secName:"CPD Section",
        emp:2012, name:"Draft Emp", gpf:5555, nps:5555, bill:JUN }), WorkflowStatus:"DRAFT" },
];

let passed=0, failed=0; const failures=[];
function check(name, actual, expected) {
  const a=JSON.stringify(actual), e=JSON.stringify(expected);
  if (a===e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`); console.log(`        expected ${e}`); console.log(`        actual   ${a}`); }
}
const section = (t) => { console.log(`\n${t}`); console.log("-".repeat(t.length)); };

function build(query) {
  const mapped = ROWS.map(toDeductionRow);
  const scoped = filterSalaryRows(mapped, query);
  const inst = filterByInstitute(scoped, query.instituteCode);
  const any = inst.filter(hasDeduction);
  return filterByDeductionType(any, query.deductionType)
    .sort(compareDeductionRows)
    .map((r, i) => ({ ...r, srNo: i + 1 }));
}

function main() {
  console.log("=".repeat(76));
  console.log("NPS / GPF DEDUCTION REPORT");
  console.log("=".repeat(76));

  const all = build({ allMonths: "1" });
  const june = build({ month: 6, year: 2026 });

  section("Source of truth — stored values only");
  check("GPF Deduction is GPFSubscription + GPFAdvance (stored)",
    build({ allMonths:"1", employeeId:2002 })
      .filter(r => r.salaryMonth === "JUN-2026" && r.billType === "REGULAR")
      .map(r => [r.gpfSubscription, r.gpfAdvance, r.gpfDeduction]), [[2000,500,2500]]);
  check("NPS Deduction is the stored NPS column",
    june.filter(r => r.employeeId === 2007).map(r => r.npsDeduction), [1850]);
  check("Total Deduction is GPF + NPS per row",
    june.every(r => Number((r.gpfDeduction + r.npsDeduction).toFixed(2)) === r.totalDeduction), true);
  check("nothing is recalculated from Basic Pay",
    /BasicPay|GrossSalary\s*\*|\* *0\.1/.test(routeSrc), false);
  check("no second SQL query is issued by this route",
    /sql\.query|new sql\.Request/.test(routeSrc), false);
  check("it reuses the Employee Wise Salary loader",
    /loadEmployeeSalaryRows/.test(routeSrc), true);

  section("Bill status and DA Difference");
  check("DRAFT bills are excluded", all.some(r => r.employeeId === 2012), false);
  /* DA Difference is excluded in the shared loader's SQL, not in JS, so the
     assertion is against that WHERE clause rather than against fixture rows. */
  check("DA Difference bills are excluded by the shared loader's SQL",
    /BillCategory[^\n]*<>\s*N'DIFFERENCE'/.test(ewsSrc) &&
    /BillType[^\n]*<>\s*N'DA DIFFERENCE'/.test(ewsSrc), true);
  check("archived bills are excluded too", /IsArchived, 0\) = 0/.test(ewsSrc), true);
  check("the shared approved-status filter is reused",
    /filterSalaryRows/.test(routeSrc), true);

  section("Salary Month is the report period, Bill Month is shown");
  const jun2002 = june.filter(r => r.employeeId === 2002);
  check("a JUNE filter returns the JUNE salary-month rows", jun2002.length, 2);
  check("including the bill whose BILL month is MAY",
    jun2002.map(r => [r.salaryMonth, r.billMonth, r.billType]),
    [["JUN-2026","JUN-2026","REGULAR"], ["JUN-2026","MAY-2026","OLD"]]);
  check("Bill Month is a separate column from Salary Month",
    XLSX_COLUMNS.map(c => c.label).filter(l => /Month/.test(l)), ["Salary Month","Bill Month"]);
  check("a JANUARY filter does not return JUNE rows",
    build({ month:1, year:2026 }).map(r => r.salaryMonth), ["JAN-2026"]);

  section("REGULAR + OLD are separate rows, never merged");
  check("both survive for the same salary month", jun2002.map(r => r.billType), ["REGULAR","OLD"]);
  check("each keeps its own deduction", jun2002.map(r => r.gpfDeduction), [2500, 2000]);
  check("they are not summed into one row",
    jun2002[0].gpfDeduction + jun2002[1].gpfDeduction === 4500 && jun2002[0].gpfDeduction !== 4500, true);

  section("Zero-deduction rule");
  check("a row with GPF=0 and NPS=0 is dropped", all.some(r => r.employeeId === 2009), false);
  check("a GPF-only row is kept", all.some(r => r.employeeId === 2008 && r.npsDeduction === 0), true);
  check("an NPS-only row is kept", all.some(r => r.employeeId === 2007 && r.gpfDeduction === 0), true);

  section("Sorting — section, natural institute code, name, chronological month");
  check("section SrNo 1 sorts before SrNo 2",
    [...new Set(june.map(r => r.sectionName))], ["CPD Section","OGE Section"]);
  check("institute codes sort naturally (CPD-06 < CPD-17 < CPD-100)",
    [...new Set(june.filter(r => r.sectionName === "CPD Section").map(r => r.instituteCode))],
    ["CPD-06","CPD-17","CPD-100"]);
  check("months sort chronologically, not alphabetically",
    build({ allMonths:"1", employeeId:2002 }).map(r => r.salaryMonth),
    ["JAN-2026","FEB-2026","JUN-2026","JUN-2026"]);
  check("Sr. No. is assigned after sorting", june.map(r => r.srNo), june.map((_, i) => i + 1));

  section("Filters");
  check("employee filter narrows to that employee",
    [...new Set(build({ allMonths:"1", employeeId:2002 }).map(r => r.employeeId))], [2002]);
  check("section filter narrows to that section",
    [...new Set(build({ allMonths:"1", sectionId:4 }).map(r => r.sectionName))], ["OGE Section"]);
  check("institute filter narrows to that institute",
    [...new Set(build({ allMonths:"1", instituteCode:"CPD-17" }).map(r => r.instituteCode))], ["CPD-17"]);
  check("institute filter uses the exact code, not a prefix",
    /startsWith\(|LIKE '.*%'/.test(routeSrc), false);
  check("an ALL institute value does not filter",
    filterByInstitute(june, "ALL").length, june.length);

  section("Deduction selection (All / GPF / NPS)");
  const junGpf = build({ month:6, year:2026, deductionType:"GPF" });
  const junNps = build({ month:6, year:2026, deductionType:"NPS" });
  check("GPF only keeps rows that carry a GPF deduction",
    junGpf.every(r => r.gpfDeduction !== 0), true);
  check("GPF only drops the NPS-only employees",
    junGpf.some(r => r.employeeId === 2007 || r.employeeId === 2011), false);
  check("NPS only keeps rows that carry an NPS deduction",
    junNps.every(r => r.npsDeduction !== 0), true);
  check("NPS only drops the GPF-only employees",
    junNps.some(r => r.employeeId === 2002 || r.employeeId === 2008), false);
  check("All is the default and keeps both sides",
    build({ month:6, year:2026 }).length, junGpf.length + junNps.length);
  check("an unknown value falls back to All", parseDeductionType("banana"), "ALL");
  check("the value is case-insensitive", parseDeductionType("gpf"), "GPF");
  check("selection narrows rows without changing any stored figure",
    junGpf.filter(r => r.employeeId === 2002).map(r => r.gpfDeduction),
    build({ month:6, year:2026 }).filter(r => r.employeeId === 2002).map(r => r.gpfDeduction));
  check("GPF-only total equals the All-mode GPF total",
    sumTotals(junGpf).gpfDeduction, sumTotals(build({ month:6, year:2026 })).gpfDeduction);
  check("NPS-only total equals the All-mode NPS total",
    sumTotals(junNps).npsDeduction, sumTotals(build({ month:6, year:2026 })).npsDeduction);
  check("the filter is on the page", /id="ngd-deduction"/.test(pageSrc), true);
  check("with All / GPF only / NPS only options",
    (pageSrc.match(/value="(ALL|GPF|NPS)"/g) || []).length >= 3, true);

  section("Totals");
  const t = sumTotals(june);
  check("Total GPF is the sum of the GPF column",
    t.gpfDeduction, Number(june.reduce((s,r)=>s+r.gpfDeduction,0).toFixed(2)));
  check("Total NPS is the sum of the NPS column",
    t.npsDeduction, Number(june.reduce((s,r)=>s+r.npsDeduction,0).toFixed(2)));
  check("Grand Total equals Total GPF + Total NPS",
    t.totalDeduction, Number((t.gpfDeduction + t.npsDeduction).toFixed(2)));
  check("June totals are the expected figures", [t.gpfDeduction, t.npsDeduction, t.totalDeduction],
    [5500, 3750, 9250]);
  const empTotals = buildEmployeeTotals(june);
  check("employee subtotal sums that employee's months",
    empTotals.find(e => e.employeeId === 2002).gpfDeduction, 4500);

  section("Reconciliation with GPF Summary and NPS Summary");
  /* Same fixture rows fed to the existing summaries' own filters. */
  const gpfRows = gpf.filterGpfRows(ROWS.map(r => ({
    ...r, WorkflowStatus: r.WorkflowStatus })), { month:6, year:2026 });
  const npsRows = nps.filterNpsRows(ROWS, { month:6, year:2026 });
  const gpfTotal = gpfRows.reduce((s,r)=>s+Number(r.GPFSubscription||0)+Number(r.GPFAdvance||0),0);
  const npsTotal = npsRows.reduce((s,r)=>s+Number(r.NPS||0),0);
  check("GPF total reconciles with the GPF Summary source rows", t.gpfDeduction, gpfTotal);
  check("NPS total reconciles with the NPS Summary source rows", t.npsDeduction, npsTotal);

  section("Report columns");
  /* The original 13 columns plus SALARY TYPE, which the salary-category
     requirement adds between Bill Type and the money columns. */
  check("the specified columns, in order", XLSX_COLUMNS.map(c => c.label),
    ["Sr. No.","Employee ID","Employee Name","Designation","Section","Institute Code",
     "Institute Name","Salary Month","Bill Month","Bill Type","Salary Type",
     "GPF Deduction","NPS Deduction","Total Deduction"]);

  section("Salary Category — REGULAR vs DA DIFFERENCE");
  const cat = require("../utils/salaryCategory");
  check("category comes from the bill's stored fields, not a code prefix",
    [cat.categoryOfBill({ billCategory: "Salary" }),
     cat.categoryOfBill({ billCategory: "DIFFERENCE" }),
     cat.categoryOfBill({ billType: "DA DIFFERENCE" })],
    ["REGULAR", "DA_DIFFERENCE", "DA_DIFFERENCE"]);
  check("the filter accepts the UI and API spellings",
    ["", "ALL", "regular", "DA DIFFERENCE", "da_difference", "junk"]
      .map(cat.parseSalaryCategory),
    ["ALL","ALL","REGULAR","DA_DIFFERENCE","DA_DIFFERENCE","ALL"]);
  check("printed header names the selected category",
    [cat.headerLabel("REGULAR"), cat.headerLabel("DA_DIFFERENCE"), cat.headerLabel("ALL")],
    ["REGULAR SALARY", "DA DIFFERENCE SALARY",
     "ALL (REGULAR SALARY + DA DIFFERENCE SALARY)"]);
  check("OLD is a bill type, never a salary category",
    /OLD.*=.*DA[_ ]DIFFERENCE/i.test(routeSrc), false);
  check("regular rows are tagged REGULAR",
    [...new Set(build({ month:6, year:2026 }).map(r => r.salaryCategory))], ["REGULAR"]);
  check("a DA row keeps its NPS and reports zero GPF",
    (() => { const d = rep.daRowToDeductionRow({
      salaryCategory:"DA_DIFFERENCE", nps: 1234, paidMonth:"JUN-2026", type:"REGULAR" });
      return [d.npsDeduction, d.gpfDeduction, d.totalDeduction]; })(), [1234, 0, 1234]);
  check("ALL reports the two categories separately",
    Object.keys(rep.sumTotalsByCategory(build({ month:6, year:2026 }))),
    ["regular", "daDifference", "grand"]);
  check("DA Difference cannot inflate the Regular total",
    (() => { const rows = [...build({ month:6, year:2026 }),
      rep.daRowToDeductionRow({ salaryCategory:"DA_DIFFERENCE", nps: 500,
        paidMonth:"JUN-2026", type:"REGULAR" })];
      const t = rep.sumTotalsByCategory(rows);
      return [t.regular.npsDeduction, t.daDifference.npsDeduction,
              t.grand.npsDeduction === t.regular.npsDeduction + t.daDifference.npsDeduction]; })(),
    [3750, 500, true]);
  check("reports without DA-compatible columns say so explicitly",
    /REGULAR SALARY only — DA DIFFERENCE SALARY excluded/.test(
      cat.excludedScopeNote("no GPF value exists on a DA Difference record")), true);

  section("Route, navigation, authorization, styling");
  check("the API is mounted", /api\/nps-gpf-deduction/.test(serverSrc), true);
  check("it is authenticated and permission-gated",
    /nps-gpf-deduction[\s\S]{0,200}requirePermissionPrefix/.test(serverSrc), true);
  check("the menu item is renamed to NPS / GPF Deduction",
    /"nps-deduction", label: "NPS \/ GPF Deduction"/.test(modulesSrc), true);
  check("the old NPS / NPS Deduction label is gone",
    /NPS \/ NPS Deduction/.test(modulesSrc), false);
  check("the page title is the report heading",
    /"nps-deduction": "NPS \/ GPF DEDUCTION REPORT"/.test(modulesSrc), true);
  check("the page is wired into AppShell", /NpsGpfDeduction/.test(shellSrc), true);
  check("it keeps the existing REPORT_SALARY permission",
    /"nps-deduction": "REPORT_SALARY"/.test(accessSrc), true);
  check("no write/mutation call exists on the page",
    /method:\s*["'](POST|PUT|PATCH|DELETE)/.test(pageSrc), false);
  check("the page uses the global Inter typography token",
    /var\(--font-family-base\)|Inter/.test(cssSrc), true);
  check("print uses the fixed pattern: containers reset",
    /overflow:\s*visible\s*!important/.test(cssSrc) && /display:\s*block\s*!important/.test(cssSrc), true);
  check("print does not use a global body * visibility hack",
    /body \*/.test(cssSrc), false);
  /* 2026-09-24: every report except Cheque Register prints A4 PORTRAIT. */
  check("A4 portrait (reportPdfConfig; only Cheque Register is landscape)", (new RegExp("npsGpfDeduction: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "NpsGpfDeduction.jsx"), "utf8").includes('useReportPrintPage("npsGpfDeduction")')), true);
  check("the table header repeats across pages",
    /display:\s*table-header-group/.test(cssSrc), true);
  check("Print and PDF both use the dedicated print flow",
    (pageSrc.match(/onClick=\{handlePrint\}/g) || []).length, 2);
  check("the DataGrid popup PDF is hidden",
    /hiddenActions=\{\["excel", "print", "pdf"\]\}/.test(pageSrc), true);
  check("fonts are awaited safely before printing",
    /document\.fonts\?\.ready/.test(pageSrc), true);

  console.log("\n" + "=".repeat(76));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
  process.exit(failed ? 1 : 0);
}
main();
