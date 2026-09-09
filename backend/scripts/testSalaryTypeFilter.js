/**
 * SALARY TYPE FILTER — ALL / REGULAR / OLD / DA_DIFFERENCE.
 * Usage: cd backend && npm run test:salary-type
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: { query: () => Promise.resolve({ recordset: [] }),
    Request: function R(){ return { query: () => Promise.resolve({recordset:[]}), input(){return this;} }; } },
  connectDB: async () => true,
};

const ews = require("../routes/employeeWiseSalary");
const { mapSalaryRow, filterSalaryRows, daRowToSalaryRow, parseSalaryTypeFilter } = ews;
const cat = require("../utils/salaryCategory");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const ewsPage = fs.readFileSync(path.join(FRONT, "pages", "EmployeeWiseSalary.jsx"), "utf8");
const ssPage  = fs.readFileSync(path.join(FRONT, "pages", "SectionSummary.jsx"), "utf8");
const ewsSrc  = fs.readFileSync(path.join(__dirname, "..", "routes", "employeeWiseSalary.js"), "utf8");

/* ---------------- fixture ---------------- */
const JUN = { BillCodeId: 1013, BillCode:"JUN-2026", BillMonth:"JUN-2026",
  SalaryMonth:"June", SalaryMonthNumber:"06", SalaryYear:"2026" };
const JUN_BM_MAY = { BillCodeId: 1014, BillCode:"JUN-2026-BM-MAY", BillMonth:"MAY-2026",
  SalaryMonth:"June", SalaryMonthNumber:"06", SalaryYear:"2026" };

const salaryRaw = (o) => ({
  WorkflowStatus:"APPROVED", BillCategory:"Salary", BillType:"Salary",
  InstituteCode:o.code, InstituteName:o.code, SectionId:11, SectionSrNo:1, SectionName:"CPD Section",
  EmployeeId:o.emp, EmployeeName:o.name, EmployeeCode:String(o.emp),
  BasicPay:34400, GrossSalary:50000, NetSalary:40000, NPS:o.nps||0, GPFSubscription:5000,
  ...(o.bill || JUN),
});

/* A DA Difference row as loadDaDifferenceRows() returns it. */
const daRow = {
  salaryCategory:"DA_DIFFERENCE", billCodeId:1012, billCode:"JUN-2026-DA-DIFF",
  employeeId:2002, employeeName:"Ramanbhai D. Damor", employeeCode:"2002",
  instituteCode:"CPD-06", instituteName:"Gujarat State Probation",
  sectionId:11, sectionName:"CPD Section", sectionSrNo:1,
  salaryMonth:"JUN-2026", salaryMonthKey:"2026-06", salaryMonthIndex:2026*12+6,
  paidMonth:"JUN-2026", workflowStatus:"APPROVED",
  differenceAmount: 9000, nps: 900, net: 8100,
};

const MAPPED = [
  mapSalaryRow(salaryRaw({ code:"CPD-06", emp:2002, name:"Ramanbhai D. Damor", nps:1850 })),
  mapSalaryRow(salaryRaw({ code:"CPD-06", emp:2002, name:"Ramanbhai D. Damor", nps:1700, bill:JUN_BM_MAY })),
  daRowToSalaryRow(daRow),
];

let passed=0, failed=0; const failures=[];
function check(name, actual, expected) {
  const a=JSON.stringify(actual), e=JSON.stringify(expected);
  if (a===e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`); console.log(`        expected ${e}`); console.log(`        actual   ${a}`); }
}
const section = (t)=>{ console.log(`\n${t}`); console.log("-".repeat(t.length)); };

function run(salaryType) {
  return filterSalaryRows(MAPPED, { month:6, year:2026, salaryType }).map(r=>r.type);
}

function main() {
  console.log("=".repeat(76));
  console.log("SALARY TYPE FILTER");
  console.log("=".repeat(76));

  section("A-D. the four categories");
  check("A. ALL keeps Regular + Old + DA Difference",
    run("ALL").sort(), ["DA DIFFERENCE","OLD","REGULAR"]);
  /*
     UPDATED with the Regular-includes-Old requirement.

     "Regular Salary" names the KIND of salary (as opposed to DA Difference),
     not the Bill Month it was raised in. An OLD bill is an ordinary salary
     bill of the SAME selected Salary Month that carries an earlier Bill
     Month, so it belongs to that month's Regular Salary report. This used to
     expect ["REGULAR"], which dropped the OLD bills of the selected month and
     under-reported the period. "OLD" below is still a genuine narrowing
     option. See billTypeMatchesFilter in utils/salaryMonthKey.js.
  */
  check("B. REGULAR keeps Regular AND Old for the selected Salary Month",
    run("REGULAR").sort(), ["OLD", "REGULAR"]);
  check("C. OLD keeps only Old", run("OLD"), ["OLD"]);
  check("D. DA_DIFFERENCE keeps only DA Difference", run("DA_DIFFERENCE"), ["DA DIFFERENCE"]);
  check("ALL is the default when nothing is selected", run("").sort(),
    ["DA DIFFERENCE","OLD","REGULAR"]);
  check("the value spellings the UI and API use all parse",
    ["ALL","REGULAR","OLD","DA_DIFFERENCE","DA Difference","junk"].map(parseSalaryTypeFilter),
    ["ALL","REGULAR","OLD","DA_DIFFERENCE","DA_DIFFERENCE","ALL"]);

  section("Regular is never replaced or hidden by DA Difference");
  check("adding DA rows does not remove the Regular row",
    run("ALL").filter(t=>t==="REGULAR").length, 1);
  check("nor the Old row", run("ALL").filter(t=>t==="OLD").length, 1);
  check("no row is duplicated", run("ALL").length, 3);

  section("E-F. month semantics unchanged");
  check("E. a different salary month excludes everything",
    filterSalaryRows(MAPPED, { month:1, year:2026, salaryType:"ALL" }).length, 0);
  check("F. Bill Month stays independent of Salary Month",
    filterSalaryRows(MAPPED, { month:6, year:2026, salaryType:"ALL" })
      .map(r=>[r.salaryMonth, r.paidMonth]),
    [["JUN-2026","JUN-2026"],["JUN-2026","MAY-2026"],["JUN-2026","JUN-2026"]]);

  section("DA rows use stored fields only — nothing invented");
  const da = daRowToSalaryRow(daRow);
  check("the three stored amounts are carried",
    [da.total, da.nps, da.net], [9000, 900, 8100]);
  /* Phase 8 (HIGH-3): columns that do not exist in the DA schema are null,
     not 0. A zero would assert "this employee's Basic is 0", which is a
     fabricated figure; null renders as an em dash meaning "not applicable". */
  check("components absent from the DA schema are null, never a guessed zero",
    [da.basic, da.da, da.hra, da.ta, da.cla, da.gpf, da.gpfAdvance, da.incomeTax, da.professionalTax],
    [null,null,null,null,null,null,null,null,null]);
  check("it is labelled DA DIFFERENCE, never REGULAR or OLD", da.type, "DA DIFFERENCE");
  check("category is not inferred from amounts or bill numbers",
    /BillNo.*DIFF|amount\s*>\s*0\s*\?\s*["']DA/.test(ewsSrc), false);
  check("DA rows are concatenated, never joined to salary rows",
    /\.\.\.rawRows\.map\(mapSalaryRow\),/.test(ewsSrc), true);
  check("the DA loader is skipped for REGULAR and OLD",
    /wantsDa = wanted === "DA_DIFFERENCE" \|\| wanted === "ALL"/.test(ewsSrc), true);

  section("G-I. other reports");
  check("G. Section Summary still offers all four",
    ["ALL","REGULAR","OLD","DA_DIFFERENCE"].every(v=>ssPage.includes(`value="${v}"`)), true);
  check("H. Employee Wise Salary offers all four, no duplicates, no blank",
    (ewsPage.match(/<option value="(ALL|REGULAR|OLD|DA_DIFFERENCE)">/g)||[]).length, 4);
  /* The Regular option now states that it includes Old, matching what the
     filter does (billTypeMatchesFilter). Display only — the value is still
     REGULAR, and Old Salary is still its own narrowing option. */
  check("H. with the unambiguous labels",
    ["Regular Salary (incl. Old)","Old Salary","DA Difference"]
      .every(l=>ewsPage.includes(`>${l}<`)), true);
  check("I. the shared category constants are reused, not reinvented",
    /loadDaDifferenceRows/.test(ewsSrc) && /DA_DIFFERENCE/.test(
      fs.readFileSync(path.join(__dirname,"..","utils","salaryCategory.js"),"utf8")), true);

  console.log("\n" + "=".repeat(76));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) { console.log("\nFailures:"); failures.forEach(f=>console.log("  - "+f)); }
  process.exit(failed ? 1 : 0);
}
main();
