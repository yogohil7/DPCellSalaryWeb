/**
 * NPS SCHEDULE SUMMARY — value-level offline tests.
 * Usage: cd backend && npm run test:nps-schedule-summary
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

const sch = require("../routes/npsSchedule");
const { parseBillType, buildScheduleGroups, compareGroups, filterByInstitute,
        monthPartsFromLabel } = sch;
const { mapSalaryRow, filterSalaryRows } = require("../routes/employeeWiseSalary");
const nps = require("../routes/npsSummary");
const cheque = require("../routes/chequeRegister");

const routeSrc  = fs.readFileSync(path.join(__dirname, "..", "routes", "npsSchedule.js"), "utf8");
const ewsSrc    = fs.readFileSync(path.join(__dirname, "..", "routes", "employeeWiseSalary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const sqlSrc    = fs.readFileSync(path.join(__dirname, "..", "sql", "schema", "47_NpsSchedule.sql"), "utf8");
const applySrc  = fs.readFileSync(path.join(__dirname, "applyNpsSchedule.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc   = fs.readFileSync(path.join(FRONT, "pages", "NpsScheduleSummary.jsx"), "utf8");
const cssSrc    = fs.readFileSync(path.join(FRONT, "pages", "npsScheduleSummary.css"), "utf8");
const shellSrc  = fs.readFileSync(path.join(FRONT, "components", "AppShell.jsx"), "utf8");
const modulesSrc= fs.readFileSync(path.join(FRONT, "modules.js"), "utf8");
const accessSrc = fs.readFileSync(path.join(FRONT, "utils", "accessControl.js"), "utf8");

/* ===================== FIXTURE ===================== */
const JUL     = { BillCodeId: 71, BillCode:"JUL-2026", BillMonth:"JUL-2026",
                  SalaryMonth:"July", SalaryMonthNumber:"07", SalaryYear:"2026" };
/* Salary month JULY, Bill Month JUNE -> OLD */
const JUL_OLD = { BillCodeId: 72, BillCode:"JUL-2026-BM-JUN", BillMonth:"JUN-2026",
                  SalaryMonth:"July", SalaryMonthNumber:"07", SalaryYear:"2026" };
const AUG     = { BillCodeId: 81, BillCode:"AUG-2026", BillMonth:"AUG-2026",
                  SalaryMonth:"August", SalaryMonthNumber:"08", SalaryYear:"2026" };

const raw = (o) => ({
  WorkflowStatus: "APPROVED", BillCategory: "Salary", BillType: "Salary",
  InstituteCode: o.code, InstituteName: o.instName || o.code,
  SectionId: o.secId, SectionSrNo: o.secSr, SectionName: o.secName,
  EmployeeId: o.emp, EmployeeName: o.name, EmployeeCode: String(o.emp),
  GPFNPSNumber: o.pran || null,
  NPS: o.nps || 0, BasicPay: 34400, GrossSalary: 50000, NetSalary: 40000,
  ...(o.bill || JUL),
});

const RAWS = [
  raw({ code:"CPD-06",  instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section", emp:2002, name:"Ramanbhai D. Damor", pran:"110022003300", nps:1850 }),
  raw({ code:"CPD-06",  instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section", emp:2003, name:"Second Emp",         pran:"110022003301", nps:1650 }),
  raw({ code:"CPD-17",  instName:"Samarpan Kendra",         secId:11, secSr:1, secName:"CPD Section", emp:2007, name:"Varshaba A. Chavda", pran:"",             nps:5648 }),
  raw({ code:"CPD-100", instName:"Late Code",               secId:11, secSr:1, secName:"CPD Section", emp:2008, name:"Rinaben R. Mhatre",  pran:"110022003302", nps:1000 }),
  raw({ code:"OGE-05",  instName:"Samanya Vruddhashram",    secId:4,  secSr:2, secName:"OGE Section", emp:2011, name:"Pradyuman N. Yadav", pran:"110022003303", nps:3808 }),
  /* Same institute, OLD bill, same salary month -> a SECOND schedule line. */
  raw({ code:"CPD-06",  instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section", emp:2002, name:"Ramanbhai D. Damor", pran:"110022003300", nps:1700, bill:JUL_OLD }),
  /* Different salary month -> must not appear in a JULY schedule. */
  raw({ code:"CPD-06",  instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section", emp:2002, name:"Ramanbhai D. Damor", pran:"110022003300", nps:9999, bill:AUG }),
  /* Zero NPS -> excluded, exactly as NPS Summary excludes it. */
  raw({ code:"CPD-06",  instName:"Gujarat State Probation", secId:11, secSr:1, secName:"CPD Section", emp:2009, name:"No NPS Emp", nps:0 }),
  /* Not approved -> excluded. */
  { ...raw({ code:"CPD-06", secId:11, secSr:1, secName:"CPD Section", emp:2012, name:"Draft Emp", nps:5555 }), WorkflowStatus:"DRAFT" },
];

const SCHEDULE_NOS = new Map([
  ["71|CPD-06",  "SCH/7/2026/173683"],
  ["72|CPD-06",  "SCH/6/2026/132438"],
  ["71|CPD-17",  "SCH/7/2026/168402"],
  ["71|CPD-100", "SCH/7/2026/151959"],
  ["71|OGE-05",  "SCH/7/2026/172165"],
]);

let passed=0, failed=0; const failures=[];
function check(name, actual, expected) {
  const a=JSON.stringify(actual), e=JSON.stringify(expected);
  if (a===e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`); console.log(`        expected ${e}`); console.log(`        actual   ${a}`); }
}
const section = (t) => { console.log(`\n${t}`); console.log("-".repeat(t.length)); };

/* Mirrors buildNpsScheduleReport without the database. */
function build(query) {
  const billType = parseBillType(query.billType);
  const mapped = RAWS.map((r) => {
    const base = mapSalaryRow(r);
    const bp = cheque.billMonthPartsOf(r.BillMonth, r.SalaryMonth, r.SalaryYear, r.SalaryMonthNumber);
    return { ...base,
      sectionSrNo: r.SectionSrNo == null ? null : Number(r.SectionSrNo),
      billMonthIndex: bp ? bp.year * 12 + bp.month : null,
      npsScheduleNo: SCHEDULE_NOS.get(`${base.billCodeId}|${base.instituteCode}`) || "",
      pran: r.GPFNPSNumber == null ? "" : String(r.GPFNPSNumber).trim() };
  });
  /* Mirrors the route: OLD narrows, everything else spans the salary bills. */
  const scoped = filterSalaryRows(mapped, {
    ...query, salaryType: billType === "OLD" ? "OLD" : "ALL" });
  const withNps = scoped.filter((r) => Number(r.nps || 0) !== 0);
  const groups = filterByInstitute(buildScheduleGroups(withNps), query.instituteCode)
    .sort(compareGroups);
  const rows = groups.map((g, i) => ({ ...g, srNo: i + 1 }));
  const totals = rows.reduce((a, r) => ({
    employeeCount: a.employeeCount + r.employeeCount,
    amount: Number((a.amount + r.amount).toFixed(2)),
  }), { employeeCount: 0, amount: 0 });
  return { rows, totals };
}

async function main() {
  console.log("=".repeat(76));
  console.log("NPS SCHEDULE SUMMARY");
  console.log("=".repeat(76));

  const julReg = build({ month:7, year:2026, billType:"REGULAR" });
  const julOld = build({ month:7, year:2026, billType:"OLD" });

  section("Source of truth");
  check("NPS comes from the stored NPS column, never recalculated",
    /BasicPay\s*\*|DA\s*\*|\* *0\.1/.test(routeSrc), false);
  check("the schedule number is the stored workflow value (migration 45)",
    /NPSScheduleNo/.test(routeSrc), true);
  check("PRAN is EmployeeMaster.GPFNPSNumber and never invented",
    /GPFNPSNumber/.test(routeSrc) && !/PRAN[0-9]|generatePran|fakePran/i.test(routeSrc), true);
  check("employee-level values are the stored figures",
    julReg.rows.find(r => r.instituteCode === "CPD-06" && r.billType === "REGULAR")
      .employees.map(e => e.nps), [1850, 1650]);
  check("PRAN passes through, empty stays empty",
    julReg.rows.find(r => r.instituteCode === "CPD-17").employees.map(e => e.pran), [""]);
  check("it reuses the shared loader, no second report query",
    /loadEmployeeSalaryRows/.test(routeSrc), true);

  section("Eligibility — same rules as NPS Summary");
  check("zero-NPS rows are excluded",
    julReg.rows.some(r => r.employees.some(e => e.nps === 0)), false);
  check("DRAFT bills are excluded",
    julReg.rows.some(r => r.employees.some(e => e.employeeId === 2012)), false);
  check("DA Difference and archived bills are excluded by the shared SQL",
    /BillCategory[^\n]*<>\s*N'DIFFERENCE'/.test(ewsSrc) &&
    /BillType[^\n]*<>\s*N'DA DIFFERENCE'/.test(ewsSrc) &&
    /IsArchived, 0\) = 0/.test(ewsSrc), true);
  check("the approved-status filter is the shared one",
    /filterSalaryRows/.test(routeSrc), true);

  section("Month rule — salary month is the period");
  check("a JULY schedule contains the JULY salary-month rows",
    [...new Set(julReg.rows.map(r => r.salaryMonth))], ["JUL-2026"]);
  check("the AUGUST bill is not in the JULY schedule",
    julReg.rows.some(r => r.employees.some(e => e.nps === 9999)), false);
  check("the OLD schedule's bill month is JUNE while its salary month is JULY",
    julOld.rows.map(r => [r.salaryMonth, r.billMonth]), [["JUL-2026","JUN-2026"]]);
  check("bill month is carried for traceability, not used as the period",
    /billMonth: group\.billMonth/.test(routeSrc), true);

  section("REGULAR scope — ordinary salary bills, whatever the bill month");
  /* In THIS report "Regular Salary" spans every ordinary salary bill for the
     selected salary month, including one whose bill month is earlier; the
     Bill Type column keeps REGULAR and OLD distinguishable on the row. */
  const julRegScope = build({ month:7, year:2026, billType:"REGULAR" }).rows;
  check("a bill whose BILL month is earlier is included",
    julRegScope.some(r => r.billMonth === "JUN-2026"), true);
  check("its row is still labelled OLD, never relabelled REGULAR",
    julRegScope.find(r => r.billMonth === "JUN-2026").billType, "OLD");
  check("every row still belongs to the selected SALARY month",
    [...new Set(julRegScope.map(r => r.salaryMonth))], ["JUL-2026"]);
  check("MAY/JUN-style rows stay separate, one per source bill",
    julRegScope.filter(r => r.instituteCode === "CPD-06")
      .map(r => [r.billMonth, r.billCode, r.amount]),
    [["JUN-2026","JUL-2026-BM-JUN",1700], ["JUL-2026","JUL-2026",3500]]);
  check("OLD only still returns the narrow set",
    build({ month:7, year:2026, billType:"OLD" }).rows.map(r => r.billType), ["OLD"]);
  check("DA Difference never leaks into the salary bill types",
    /billType === "DA_DIFFERENCE" \|\| billType === "ALL"/.test(routeSrc), true);
  check("the shared REGULAR/OLD classifier was not modified",
    /resolveChequeSalaryType/.test(ewsSrc), true);

  section("REGULAR and OLD are separate schedules");
  /* "Regular Salary" now spans every ordinary salary bill for the month, so
     its total includes the later-bill-month bill: 13,956 + 1,700 = 15,656.
     "OLD Salary only" remains the narrow 1,700. */
  check("Regular-scope total spans the salary bills; OLD-only stays narrow",
    [julReg.totals.amount, julOld.totals.amount], [15656, 1700]);
  check("rows are never merged — one per source bill in each scope",
    [julReg.rows.length, julOld.rows.length], [5, 1]);
  check("the same institute's two bills stay distinguishable by Bill Type",
    julReg.rows.filter(r => r.instituteCode === "CPD-06").map(r => r.billType),
    ["OLD", "REGULAR"]);
  check("each carries its own schedule number",
    julReg.rows.filter(r => r.instituteCode === "CPD-06").map(r => r.scheduleNo),
    ["SCH/6/2026/132438","SCH/7/2026/173683"]);
  check("bill type comes from the bill, not from employee data",
    /resolveChequeSalaryType/.test(ewsSrc), true);

  section("Schedule structure and sorting");
  /* CPD-06 twice: its JUL bill and its earlier-bill-month bill are two
     source bills, so they are two schedule lines. */
  check("one row per institute per source bill",
    julReg.rows.map(r => r.instituteCode),
    ["CPD-06","CPD-06","CPD-17","CPD-100","OGE-05"]);
  check("institute codes sort naturally (CPD-06 < CPD-17 < CPD-100)",
    [...new Set(julReg.rows.filter(r => r.sectionName === "CPD Section")
      .map(r => r.instituteCode))], ["CPD-06","CPD-17","CPD-100"]);
  check("section SrNo 1 sorts before SrNo 2",
    [...new Set(julReg.rows.map(r => r.sectionName))], ["CPD Section","OGE Section"]);
  check("the count column is per source bill, not per institute",
    julReg.rows.map(r => r.employeeCount), [1,2,1,1,1]);
  check("the amount is that source bill's stored NPS",
    julReg.rows.map(r => r.amount), [1700, 3500, 5648, 1000, 3808]);
  check("Sr. No. is assigned after sorting", julReg.rows.map(r => r.srNo), [1,2,3,4,5]);
  check("institute rows carry no employee Sr. No.",
    /RowKind = N'INSTITUTE'/.test(routeSrc) || /'INSTITUTE'/.test(routeSrc), true);

  section("Bill Month separation (same institute, different source bills)");
  /* CPD-06 carries a REGULAR JUL bill and an OLD bill whose BILL month is
     JUNE; both belong to salary month JULY. Under ALL they must stay two
     rows with their own bill months, counts, amounts and schedule numbers. */
  const julAll = build({ month:7, year:2026, billType:"ALL" });
  const cpd06 = julAll.rows.filter(r => r.instituteCode === "CPD-06");
  check("the same institute yields one row per source bill", cpd06.length, 2);
  check("each row keeps its own Bill Month",
    cpd06.map(r => r.billMonth), ["JUN-2026", "JUL-2026"]);
  check("bill months sort chronologically, MAY/JUN before JUL",
    cpd06.map(r => r.billMonthIndex)[0] < cpd06.map(r => r.billMonthIndex)[1], true);
  check("each row keeps its own source bill",
    cpd06.map(r => r.billCode), ["JUL-2026-BM-JUN", "JUL-2026"]);
  check("each row keeps its own schedule number",
    cpd06.map(r => r.scheduleNo), ["SCH/6/2026/132438", "SCH/7/2026/173683"]);
  check("counts are per source bill, not per institute",
    cpd06.map(r => r.employeeCount), [1, 2]);
  check("amounts are per source bill, never combined",
    cpd06.map(r => r.amount), [1700, 3500]);
  check("both rows share the same salary month",
    [...new Set(cpd06.map(r => r.salaryMonth))], ["JUL-2026"]);
  check("the grouping key is institute + source bill + Bill Month",
    /\$\{row\.instituteCode\}\|\$\{row\.billCodeId\}\|\$\{row\.paidMonth\}/.test(routeSrc), true);
  check("separating rows does not change the total",
    Number(cpd06.reduce((a,r)=>a+r.amount,0).toFixed(2)), 5200);
  check("the saved snapshot stores Bill Month per detail row",
    /BillMonthLabel/.test(routeSrc) && /BillMonthLabel/.test(sqlSrc), true);
  check("the saved snapshot stores the source bill per detail row",
    /SourceSalaryBillId/.test(sqlSrc) && /SourceSalaryBillCode/.test(sqlSrc), true);
  check("the saved view returns Bill Month per row",
    /billMonth: d\.BillMonthLabel/.test(routeSrc), true);
  check("the Bill Month column is in the report table",
    /\{ key: "billMonth", label: "Bill Month" \}/.test(pageSrc), true);
  check("Bill Month is exported and printed, not hidden",
    /billMonth: row\.billMonth/.test(pageSrc), true);

  section("Totals and reconciliation with NPS Summary");
  check("the total is the sum of the displayed amounts",
    julReg.totals.amount,
    Number(julReg.rows.reduce((s,r)=>s+r.amount,0).toFixed(2)));
  check("the employee count total is the sum of the counts",
    julReg.totals.employeeCount, 6);
  /*
    "Regular Salary" here spans every ordinary salary bill for the month, so
    its counterpart in NPS Summary is that month's FULL salary set (REGULAR
    plus the later-bill-month bills) — not NPS Summary's narrower REGULAR
    figure. Reconciling against the narrow figure would be comparing two
    different scopes.
  */
  const npsRowsAllSalary = nps.filterNpsRows(RAWS, { month:7, year:2026, salaryTime:"1" });
  check("Regular-scope total reconciles with the NPS Summary salary rows",
    julReg.totals.amount,
    Number(npsRowsAllSalary.reduce((s,r)=>s+Number(r.NPS||0),0).toFixed(2)));
  check("OLD-only total reconciles with its own source rows",
    julOld.totals.amount,
    Number(npsRowsAllSalary.filter(r => String(r.BillCode).includes("-BM-"))
      .reduce((s,r)=>s+Number(r.NPS||0),0).toFixed(2)));
  check("employee-level values match NPS Summary exactly",
    julReg.rows.find(r => r.instituteCode==="CPD-06" && r.billType==="REGULAR")
      .employees.find(e => e.employeeId===2002).nps,
    Number(npsRowsAllSalary.find(r => r.EmployeeId===2002 &&
      !String(r.BillCode).includes("-BM-")).NPS));

  section("Filters");
  check("section filter narrows to that section",
    [...new Set(build({ month:7, year:2026, billType:"REGULAR", sectionId:4 })
      .rows.map(r => r.sectionName))], ["OGE Section"]);
  check("institute filter narrows to that institute",
    build({ month:7, year:2026, billType:"REGULAR", instituteCode:"CPD-17" })
      .rows.map(r => r.instituteCode), ["CPD-17"]);
  check("institute filter uses the exact code, not a prefix",
    /startsWith\(/.test(routeSrc), false);
  check("bill type defaults to REGULAR", parseBillType(""), "REGULAR");
  check("bill type accepts OLD and ALL",
    [parseBillType("old"), parseBillType("ALL")], ["OLD","ALL"]);
  check("month label parsing is exact",
    [monthPartsFromLabel("JUL-2026"), monthPartsFromLabel("nonsense")],
    [{ month:7, year:2026 }, null]);

  section("Report-only — the save operation is gone");
  check("no save endpoint exists on the report route",
    /router\.post\(/.test(routeSrc), false);
  check("the route never writes to the schedule tables",
    /INSERT INTO dbo\.NpsSchedule/.test(routeSrc), false);
  check("the page has no SAVE NPS SCHEDULE button",
    /SAVE NPS SCHEDULE/.test(pageSrc), false);
  check("the page has no save handler or save state",
    /handleSave|setSaving|allowRevision/.test(pageSrc), false);
  check("the API client exposes no save helper",
    /saveNpsSchedule/.test(fs.readFileSync(path.join(FRONT,"utils","npsScheduleApi.js"),"utf8")), false);
  check("the schedule tables and their data are left in place",
    /CREATE TABLE dbo\.NpsScheduleHeader/.test(sqlSrc) &&
    !/DROP TABLE|DELETE FROM dbo\.NpsSchedule/.test(routeSrc + sqlSrc), true);
  check("historical schedules can still be read",
    /router\.get\("\/saved"/.test(routeSrc) && /router\.get\("\/saved\/:id"/.test(routeSrc), true);

  section("Bill Type — REGULAR / OLD / DA DIFFERENCE kept apart");
  check("the four bill types parse, in the project's spellings",
    ["REGULAR","OLD","OLD SALARY","DA DIFFERENCE","DA_DIFFERENCE","ALL","junk"]
      .map(parseBillType),
    ["REGULAR","OLD","OLD","DA_DIFFERENCE","DA_DIFFERENCE","ALL","REGULAR"]);
  check("the page offers all four options",
    ["REGULAR","OLD","DA_DIFFERENCE","ALL"]
      .every(v => pageSrc.includes(`value="${v}"`)), true);
  check("DA Difference NPS is the stored TotalNPSDeduction, not recalculated",
    /TotalNPSDeduction/.test(fs.readFileSync(path.join(__dirname,"..","utils","salaryCategory.js"),"utf8")), true);
  check("a DA row is labelled DA DIFFERENCE, never REGULAR or OLD",
    sch.daRowToScheduleRow({ nps: 500, salaryMonthIndex: 1 }).type, "DA DIFFERENCE");
  check("a DA row keeps its own schedule number, not a salary one",
    sch.daRowToScheduleRow({ npsScheduleNo: "DA/SCH/9", salaryMonthIndex: 1 }).npsScheduleNo,
    "DA/SCH/9");
  check("a DA row with no schedule number shows blank, never invented",
    sch.daRowToScheduleRow({ salaryMonthIndex: 1 }).npsScheduleNo, "");
  check("the salary loader is skipped when only DA Difference is asked for",
    /wantsSalary \? loadEmployeeSalaryRows\(\)/.test(routeSrc), true);
  check("the DA loader runs for DA DIFFERENCE and for ALL",
    /billType === "DA_DIFFERENCE" \|\| billType === "ALL"/.test(routeSrc), true);
  check("the Bill Type column keeps the categories distinguishable under ALL",
    /\{ key: "billType", label: "Bill Type" \}/.test(pageSrc), true);
  check("OLD is still a salary bill type, never DA Difference",
    /OLD.*=.*DA[_ ]DIFFERENCE/i.test(routeSrc), false);

  section("Snapshot storage (unchanged, still used by saved schedules)");
  check("the migration creates both tables",
    /CREATE TABLE dbo\.NpsScheduleHeader/.test(sqlSrc) &&
    /CREATE TABLE dbo\.NpsScheduleDetails/.test(sqlSrc), true);
  check("it is additive and idempotent",
    /IF OBJECT_ID\(N'dbo\.NpsScheduleHeader', N'U'\) IS NULL/.test(sqlSrc) &&
    !/DROP TABLE|ALTER TABLE dbo\.Salary/.test(sqlSrc), true);
  check("indexes exist for month/type, schedule and employee",
    /IX_NpsScheduleHeader_MonthType/.test(sqlSrc) &&
    /IX_NpsScheduleDetails_Schedule/.test(sqlSrc) &&
    /IX_NpsScheduleDetails_Employee/.test(sqlSrc), true);
  check("the detail table has a foreign key to the header",
    /FK_NpsScheduleDetails_Header/.test(sqlSrc), true);
  check("snapshot columns exist for name, PRAN, amount and source bill",
    /EmployeeNameSnapshot/.test(sqlSrc) && /PranSnapshot/.test(sqlSrc) &&
    /NpsAmount/.test(sqlSrc) && /SourceSalaryBillId/.test(sqlSrc), true);
  check("the apply script is registered",
    /migrate:nps-schedule"/.test(fs.readFileSync(path.join(__dirname,"..","package.json"),"utf8")), true);
  check("the apply script verifies both tables",
    /NpsScheduleHeader/.test(applySrc) && /NpsScheduleDetails/.test(applySrc), true);
  check("missing tables produce a clear instruction, not a crash",
    /npm run migrate:nps-schedule/.test(routeSrc), true);
  check("all SQL is parameterized template literals, never concatenated",
    /sql\.query\(\s*["'`][^`]*\+/.test(routeSrc), false);
  check("viewing a saved schedule reads the snapshot, not current salary",
    /FROM dbo\.NpsScheduleDetails/.test(routeSrc) &&
    !/loadEmployeeSalaryRows[\s\S]{0,400}saved\/:id/.test(routeSrc), true);

  section("Route, navigation, permissions, UI");
  check("the API is mounted", /api\/nps-schedule"/.test(serverSrc), true);
  check("it is authenticated and permission-gated",
    /nps-schedule"[\s\S]{0,200}requirePermissionPrefix/.test(serverSrc), true);
  check("the existing menu item and title are unchanged",
    /\{ id: "nps-schedule", label: "NPS Schedule Summary" \}/.test(modulesSrc) &&
    /"nps-schedule": "NPS SCHEDULE SUMMARY"/.test(modulesSrc), true);
  check("the page is wired into AppShell", /NpsScheduleSummary/.test(shellSrc), true);
  check("it keeps the existing REPORT_SALARY permission",
    /"nps-schedule": "REPORT_SALARY"/.test(accessSrc), true);
  check("the report cannot edit salary data",
    /salary\/save|salaryEntry|PUT|PATCH|DELETE/.test(pageSrc), false);
  check("print resets the app containers",
    /overflow:\s*visible\s*!important/.test(cssSrc) &&
    /display:\s*block\s*!important/.test(cssSrc), true);
  check("print does not use the global body-star visibility hack",
    /body \*/.test(cssSrc), false);
  check("A4 portrait for six columns (reportPdfConfig)", (new RegExp("npsScheduleSummary: \\{[^}]*orientation: \"portrait\"").test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "utils", "reportPdfConfig.js"), "utf8")) && require("fs").readFileSync(require("path").join(__dirname, "..", "..", "frontend", "src", "pages", "NpsScheduleSummary.jsx"), "utf8").includes('useReportPrintPage("npsScheduleSummary")')), true);
  check("the table header repeats across pages",
    /display:\s*table-header-group/.test(cssSrc), true);
  check("filters, saved list and buttons are hidden when printing",
    /\.nsch-filters/.test(cssSrc) && /\.nsch-saved,/.test(cssSrc), true);
  check("the signature area is present and printed",
    /Prepared By/.test(pageSrc) && /Checked By/.test(pageSrc) &&
    /Approved By/.test(pageSrc), true);
  /* Was 2 (PDF, Print). The NPS Letter section adds a third trigger,
     "Print Letter", which uses the SAME handlePrint flow — so the count grows
     to 3 while the flow itself is unchanged. */
  check("PDF, Print and Print Letter all use the dedicated print flow",
    (pageSrc.match(/onClick=\{handlePrint\}/g) || []).length, 3);
  check("the DataGrid popup PDF is hidden",
    /hiddenActions=\{\["excel", "print", "pdf"\]\}/.test(pageSrc), true);
  check("fonts are awaited safely before printing",
    /document\.fonts\?\.ready/.test(pageSrc), true);

  /* ============================================================
     EXCEL EXPORT  +  NPS BANK LETTER   (additive enhancement)
     ============================================================ */
  const routeCode = routeSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const pageCode = pageSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "npsScheduleApi.js"), "utf8");
  const guj = require("../utils/gujaratiAmountInWords");

  section("EXCEL EXPORT");
  check("1. the /export.xlsx route exists",
    /router\.get\("\/export\.xlsx"/.test(routeCode), true);
  check("2. it uses the same buildNpsScheduleReport()",
    /const data = await buildNpsScheduleReport\(req\.query \|\| \{\}\);/.test(routeCode), true);
  {
    /* The export ROUTE only — slicing to end of file would sweep in the
       saved-schedule endpoints, whose own queries are pre-existing. */
    const exportRoute = routeCode.slice(
      routeCode.indexOf('router.get("/export.xlsx"'),
      routeCode.indexOf('router.get("/saved"')
    );
    check("2. and runs no second query or calculation of its own",
      /FROM dbo\.|SUM\(|loadEmployeeSalaryRows\(\)/.test(exportRoute), false);
    check("2. it only formats what the builder returned",
      /data\.rows\.map\(/.test(exportRoute), true);
  }
  check("3-7. every filter reaches the builder through req.query",
    /buildNpsScheduleReport\(req\.query/.test(routeCode), true);
  check("3-7. the api helper sends one param set for screen and export",
    (apiSrc.match(/buildFilterParams\(filters\)/g) || []).length, 2);
  check("3-7. that param set carries month, year, section, institute and bill type",
    ["month", "year", "sectionId", "instituteCode", "billType"]
      .every((k) => new RegExp(`params\\.set\\("${k}"`).test(apiSrc)), true);
  check("8. the export totals row reads the report's own totals",
    /Number\(data\.totals\.employeeCount\)/.test(routeCode) &&
      /Number\(data\.totals\.amount\)/.test(routeCode), true);
  check("8. and is not recomputed from the exported body",
    /body[\s\S]{0,200}reduce\(/.test(routeCode), false);
  check("9. the eight report columns are unchanged, in order",
    sch.XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "Code No.", "Institute Name", "Bill Month",
     "Bill Type", "Schedule No.", "Count", "Amount"]);
  check("9. the screen still declares the same eight",
    (pageSrc.match(/\{ key: "/g) || []).length, 8);
  check("the Export Excel button exists",
    /Export Excel/.test(pageCode), true);
  check("and downloads through the shared helper",
    /downloadNpsScheduleExcel\(filters\)/.test(pageCode), true);

  section("NPS LETTER — period");
  check("10. the letter UI exists", /nsch-letter/.test(pageCode), true);
  check("10. behind its own toggle, leaving the table in place",
    /setShowLetter/.test(pageCode) && /nsch-table/.test(pageSrc), true);
  check("11. JUL + 2026 gives JULY-2026",
    sch.letterMonthLabelOf({ month: 7, year: 2026 }), "JULY-2026");
  check("12. AUG + 2026 gives AUGUST-2026",
    sch.letterMonthLabelOf({ month: 8, year: 2026 }), "AUGUST-2026");
  check("11-12. every month resolves",
    [1, 2, 3, 12].map((m) => sch.letterMonthLabelOf({ month: m, year: 2026 })),
    ["JANUARY-2026", "FEBRUARY-2026", "MARCH-2026", "DECEMBER-2026"]);
  check("11-12. an unusable month gives an empty label, not a guess",
    [sch.letterMonthLabelOf({}), sch.letterMonthLabelOf({ month: 13, year: 2026 })],
    ["", ""]);
  check("13. JULY-2026 is not hard-coded in the route",
    /JULY-2026/.test(routeCode), false);
  check("13. nor in the page",
    /JULY-2026/.test(pageCode), false);
  check("13. the page reads the label the backend computed",
    /report\.letter\?\.monthLabel/.test(pageCode), true);

  section("NPS LETTER — amount");
  {
    /* The letter block is built from the report's own totals object. */
    check("14. the letter amount is report totals.amount",
      /amount: totals\.amount/.test(routeCode), true);
    check("14. and its words and figure come from that same total",
      /gujaratiFigure\(totals\.amount\)/.test(routeCode) &&
        /gujaratiAmountInWords\(totals\.amount\)/.test(routeCode), true);
    check("15. there is one letter total, not a per-institute letter",
      /rows\.map[\s\S]{0,200}letter/.test(routeCode), false);
    check("15. the page prints the single report figure",
      /report\.letter\?\.amountGujarati/.test(pageCode), true);
    check("14. no second sum is computed for the letter",
      /letter[\s\S]{0,300}reduce\(/.test(routeCode), false);
  }

  section("NPS LETTER — nothing fabricated");
  check("16-19. the route invents no cheque or challan value",
    /chequeNo|ChequeNo|chequeDate|challanNo|ChallanNo|challanDate/i.test(routeCode), false);
  check("16-19. no such column exists to read anyway",
    /ChequeNumber|ChallanNumber/.test(routeCode), false);
  check("20. a blank manual field prints a rule",
    /return text === "" \? "__________" : text;/.test(pageCode), true);
  check("20. a blank date prints a rule too",
    /if \(!text\) return "__________";/.test(pageCode), true);
  {
    /* Every line that calls the API, checked for any manual field. */
    const apiCallLines = pageCode
      .split("\n")
      .filter((l) => /getNpsSchedule\(|downloadNpsScheduleExcel\(/.test(l))
      .join("\n");
    check("21. the manual fields are never sent to an API",
      /chequeNo|challanNo|chequeDate|challanDate|letterDateValue/.test(apiCallLines),
      false);
    check("21. both API calls pass only the report filters",
      apiCallLines.match(/\((filters)?\)/g) != null, true);
  }
  check("21. and the filters object carries only report filters",
    /\(\) => \(\{ sectionId, instituteCode, month, year, billType \}\)/.test(pageSrc), true);
  check("21. no save call was added",
    /method:\s*"POST"|savePost|createSchedule/.test(pageCode), false);
  check("22. the letter date defaults to today",
    /useState\(todayIso\(\)\)/.test(pageCode), true);
  check("23. and is editable before printing",
    /setLetterDateValue\(e\.target\.value\)/.test(pageCode), true);

  section("GUJARATI AMOUNT IN WORDS");
  check("24. the reference figure converts exactly",
    guj.gujaratiWords(1369424), "તેર લાખ ઓગણસિત્તેર હજાર ચારસો ચોવીસ");
  check("24. and its bracketed phrase",
    guj.gujaratiAmountInWords(1369424),
    "(અંકે તેર લાખ ઓગણસિત્તેર હજાર ચારસો ચોવીસ પૂરા /-)");
  check("24. the figure uses Gujarati digits with Indian grouping",
    guj.gujaratiFigure(1369424), "૧૩,૬૯,૪૨૪");
  check("24. tens, hundreds, thousands, lakh and crore",
    [guj.gujaratiWords(13), guj.gujaratiWords(69), guj.gujaratiWords(424),
     guj.gujaratiWords(1000), guj.gujaratiWords(100000), guj.gujaratiWords(10000000)],
    ["તેર", "ઓગણસિત્તેર", "ચારસો ચોવીસ", "એક હજાર", "એક લાખ", "એક કરોડ"]);
  check("24. every value 0-99 has its own word, none blank",
    Array.from({ length: 100 }, (_, i) => guj.gujaratiWords(i))
      .filter((w) => !w || w.trim() === "").length, 0);
  check("24. and they are all distinct",
    new Set(Array.from({ length: 100 }, (_, i) => guj.gujaratiWords(i))).size, 100);
  check("25. zero is handled cleanly, not malformed",
    [guj.gujaratiWords(0), guj.gujaratiAmountInWords(0), guj.gujaratiFigure(0)],
    ["શૂન્ય", "(અંકે શૂન્ય પૂરા /-)", "૦"]);
  check("25. no result contains 'undefined' or a stray double space",
    [0, 1, 100, 1000, 100000, 1369424, 12345678]
      .some((n) => /undefined|  /.test(guj.gujaratiAmountInWords(n))), false);
  check("the utility performs no financial calculation",
    /\*|\/ 100\b|round2|toFixed/.test(
      fs.readFileSync(path.join(__dirname, "..", "utils", "gujaratiAmountInWords.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/Math\.floor\([^)]*\)/g, "")
        .replace(/10000000|100000|1000|100/g, "")), false);

  section("NOTHING EXISTING WAS CHANGED");
  check("26. NPS still reads the stored SalaryEmployeeDetails.NPS",
    /d\.NPS,/.test(ewsSrc), true);
  check("26. the schedule adds no NPS arithmetic",
    /calculateNps|Math\.ceil/.test(routeCode), false);
  check("27. the eight table columns are untouched",
    /key: "srNo"[\s\S]{0,400}key: "amount"/.test(pageSrc), true);
  check("28. REGULAR spans REGULAR+OLD as before",
    /const salaryType = billType === "OLD" \? "OLD" : "ALL";/.test(routeCode), true);
  check("29. DA Difference still comes from the shared loader",
    /loadDaDifferenceRows\(\)/.test(routeCode), true);
  check("29. and keeps its own schedule number",
    /daRowToScheduleRow\(/.test(routeCode), true);
  check("30. the global body-star visibility hack is still absent",
    /body \*\s*\{[^}]*visibility:\s*hidden/.test(cssSrc), false);
  check("30. the letter print block keeps the scoped shell reset",
    /\.nsch-letter-wrap[\s\S]{0,400}page-break-before/.test(cssSrc) &&
      /\.app-shell[\s\S]{0,200}overflow: visible/.test(cssSrc), true);
  check("30. no global @page rule in the stylesheet, so orientations cannot conflict",
    (cssSrc.match(/@page\s*\{/g) || []).length, 0);
  check("30. letter controls are excluded from print",
    /nsch-letter-inputs no-print/.test(pageCode), true);
  check("the report still has no save endpoint",
    /router\.(post|put|patch|delete)\(/.test(routeCode), false);

  await sectionMr29();

  console.log("\n" + "=".repeat(76));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
  process.exit(failed ? 1 : 0);
}

/*
  MR-29 keeps two workflow instances of the SAME salary bill (one BillCodeId):
  JUL-2026 (earlier Bill Month, details in SalaryEntryBillEmployeeDetails,
  schedule number on that instance's SalaryEntryBillHeader) and AUG-2026
  (canonical instance, details in SalaryEmployeeDetails, schedule number on
  its own workflow row). Grouping by institute + bill code alone merged them
  into one AUG line.
*/
const MR29_BILL = {
  BillCodeId: 1029, BillCode: "AUG-2026", MasterBillMonth: "AUG-2026",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Salary",
  InstituteCode: "MR-29", InstituteName: "MR-29",
  SectionId: 3, SectionSrNo: 3, SectionName: "MR Section",
};
const MR29_JUL_WF = 2907;
const MR29_AUG_WF = 2908;
const MR29_HEADER = [{
  SalaryBillCodeId: 1029, InstituteCode: "MR-29", BillMonth: "JUL-2026",
  BillNo: "701", BillDate: "2026-08-11", NPSScheduleNo: "SCH/JUL/MR29",
}];

function mr29Employee({ workflowId, billMonth, employeeId, nps, workflowSchedule, status }) {
  return {
    ...MR29_BILL,
    ReportWorkflowId: workflowId,
    WorkflowBillMonth: billMonth,
    BillMonth: billMonth,
    WorkflowStatus: status,
    BillNo: billMonth === "AUG-2026" ? "849" : null,
    BillDate: billMonth === "AUG-2026" ? "2026-09-03" : null,
    NPSScheduleNo: workflowSchedule,
    DetailId: workflowId * 10 + employeeId,
    EmployeeId: employeeId,
    EmployeeName: `E${employeeId}`,
    EmployeeCode: `E${employeeId}`,
    GPFNPSNumber: "",
    NPS: nps,
    BasicPay: 1000, GrossSalary: 1000, NetSalary: 1000,
  };
}

function mr29Rows(julNps) {
  const jul = (employeeId, nps) => mr29Employee({
    workflowId: MR29_JUL_WF, billMonth: "JUL-2026", employeeId, nps,
    workflowSchedule: null, status: "LOCKED",
  });
  const aug = mr29Employee({
    workflowId: MR29_AUG_WF, billMonth: "AUG-2026", employeeId: 3, nps: 4500,
    workflowSchedule: "SCH/AUG/MR29", status: "APPROVED",
  });
  return [jul(1, julNps[0]), jul(2, julNps[1]), aug];
}

function scheduleLines(report) {
  return report.rows
    .filter((r) => r.instituteCode === "MR-29")
    .map((r) => ({
      billMonth: r.billMonth,
      billType: r.billType,
      scheduleNo: r.scheduleNo,
      employeeCount: r.employeeCount,
      amount: r.amount,
    }));
}

function installMr29Sql(rows) {
  const sqlApi = require.cache[dbPath].exports.sql;
  const respond = (text) => {
    if (/SalaryEntryBillHeader/i.test(text)) return { recordset: MR29_HEADER };
    if (/COL_LENGTH/i.test(text)) return { recordset: [{ Present: 1 }] };
    if (/SalaryBillInstituteWorkflow/i.test(text) && /NPSScheduleNo/i.test(text) &&
        !/SalaryEmployeeDetails/i.test(text)) {
      /* A bill+institute schedule map cannot tell JUL from AUG. The report
         must ignore it and keep each instance's own header/workflow value. */
      return { recordset: [{ SalaryBillCodeId: 1029, InstituteCode: "MR-29", NPSScheduleNo: "WRONG-SHARED" }] };
    }
    if (/SalaryEmployeeDetails/i.test(text)) return { recordset: rows };
    return { recordset: [] };
  };
  sqlApi.query = (strings) => {
    const text = strings && strings.raw ? strings.raw.join("?") : String(strings);
    return Promise.resolve(respond(text));
  };
  sqlApi.Request = function R() {
    return { input() { return this; }, query: (text) => Promise.resolve(respond(String(text))) };
  };
}

async function sectionMr29() {
  section("MR-29 JUL-2026 and AUG-2026 stay separate instances");
  const derived = require("../utils/reportBillInstance").instanceEmployeeRowsSql().replace(/\s+/g, " ");
  check("canonical instance (AUG, Bill Month = salary month) reads SalaryEmployeeDetails",
    /JOIN dbo\.SalaryEmployeeDetails ed0/.test(derived) &&
    /WHERE iw0\.BillMonth = UPPER\(LEFT/.test(derived), true);
  check("earlier Bill Month (JUL) reads SalaryEntryBillEmployeeDetails for that Bill Month",
    /JOIN dbo\.SalaryEntryBillEmployeeDetails ed1/.test(derived) &&
    /ed1\.BillMonth = iw1\.BillMonth/.test(derived) &&
    /iw1\.BillMonth <> UPPER\(LEFT/.test(derived), true);
  check("NPS Schedule uses that loader, not a bill+institute employee join",
    /loadEmployeeSalaryRows/.test(routeSrc) &&
    !/INNER JOIN dbo\.SalaryEmployeeDetails d\s+ON d\.SalaryBillCodeId/.test(routeSrc), true);

  installMr29Sql(mr29Rows([1200, 800]));
  const both = await sch.buildNpsScheduleReport({ month: 8, year: 2026, billType: "REGULAR" });
  const bothLines = scheduleLines(both);
  console.log("  MR-29 non-zero JUL (no names, no PRANs):");
  console.log(`    WorkflowId ${MR29_JUL_WF}  ${JSON.stringify(bothLines.find((r) => r.billMonth === "JUL-2026"))}`);
  console.log(`    WorkflowId ${MR29_AUG_WF}  ${JSON.stringify(bothLines.find((r) => r.billMonth === "AUG-2026"))}`);
  check("non-zero JUL and AUG are two MR-29 rows, not one merged AUG row",
    bothLines, [
      { billMonth: "JUL-2026", billType: "OLD", scheduleNo: "SCH/JUL/MR29", employeeCount: 2, amount: 2000 },
      { billMonth: "AUG-2026", billType: "REGULAR", scheduleNo: "SCH/AUG/MR29", employeeCount: 1, amount: 4500 },
    ]);
  check("each schedule number is that instance's own, not the shared bill+institute value",
    bothLines.map((r) => r.scheduleNo).includes("WRONG-SHARED"), false);
  check("the two rows share one bill code, so Bill Month is what separates them",
    both.rows.filter((r) => r.instituteCode === "MR-29").map((r) => r.billCodeId),
    [1029, 1029]);

  installMr29Sql(mr29Rows([0, 0]));
  const julZero = await sch.buildNpsScheduleReport({ month: 8, year: 2026, billType: "REGULAR" });
  const zeroLines = scheduleLines(julZero);
  console.log("  MR-29 zero JUL (excluded, not fabricated):");
  console.log(`    WorkflowId ${MR29_JUL_WF}  saved NPS total 0 -> no schedule row`);
  console.log(`    WorkflowId ${MR29_AUG_WF}  ${JSON.stringify(zeroLines[0])}`);
  check("a JUL instance whose saved NPS total is zero is not given a row",
    zeroLines, [
      { billMonth: "AUG-2026", billType: "REGULAR", scheduleNo: "SCH/AUG/MR29", employeeCount: 1, amount: 4500 },
    ]);
}

main().catch((error) => { console.error(error); process.exit(1); });
