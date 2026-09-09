/*
  ==================================================================
  EMPLOYEE REPORT — administrative / HR selections
  ==================================================================

  Four ways of selecting employees from the Employee Master, in one report:

    RETIREMENT_DATE   EmployeeMaster.DateOfRetirement  in [From..To]
    CCC_PASS_DATE     EmployeeMaster.CCCPassDate       in [From..To]
    JOINING_DATE      EmployeeMaster.DateOfJoining     in [From..To]
    INCREMENT_MONTH   EmployeeMaster.MonthOfIncrement  = the chosen month

  Every one of those columns already exists in the Employee Master; none is
  derived or invented, and the increment month is never computed from the
  joining date. This suite asserts that on the shipped source as well as on
  the returned data.

  HOW IT RUNS
    The db module is replaced with a RECORDING stub that both logs every
    statement (so the suite can prove it wrote nothing) and answers the
    report's SELECT by applying the same predicates the SQL expresses to an
    in-memory Employee Master. The route's real builder, mapper, sorter and
    column chooser then run over that.

  Offline. No database, no server, no network.

  Usage: cd backend && npm run test:employee-report
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ------------------------------------------------------------------ *
 * In-memory Employee Master.
 *
 * Fields are named exactly as the real columns are.
 * ------------------------------------------------------------------ */
const EMPLOYEES = [
  { EmployeeId: 2001, EmployeeCode: "2001", EmployeeName: "Anil Patel",
    EmployeeType: "Regular", DesignationName: "Clerk",
    SectionId: 1, SectionName: "PH SECTION", SectionSrNo: 1,
    InstituteCode: "OGE-05", InstituteName: "Institute Five",
    DateOfJoining: "2010-06-15", DateOfRetirement: "2026-06-30",
    CCCPassDate: "2015-08-20", MonthOfIncrement: 7,
    IsActive: 1, Status: "Active" },

  { EmployeeId: 2002, EmployeeCode: "2002", EmployeeName: "Bhavna Shah",
    EmployeeType: "Regular", DesignationName: "Superintendent",
    SectionId: 1, SectionName: "PH SECTION", SectionSrNo: 1,
    InstituteCode: "OGE-05", InstituteName: "Institute Five",
    DateOfJoining: "2026-04-01", DateOfRetirement: "2027-03-31",
    CCCPassDate: "2026-04-01", MonthOfIncrement: 1,
    IsActive: 1, Status: "Active" },

  /* Boundary rows: exactly the From date and exactly the To date. */
  { EmployeeId: 2003, EmployeeCode: "2003", EmployeeName: "Chirag Desai",
    EmployeeType: "Regular", DesignationName: "Peon",
    SectionId: 2, SectionName: "WOMEN SECTION", SectionSrNo: 2,
    InstituteCode: "CPD-17", InstituteName: "Institute Seventeen",
    DateOfJoining: "2027-03-31", DateOfRetirement: "2027-03-31",
    CCCPassDate: "2027-03-31", MonthOfIncrement: 7,
    IsActive: 1, Status: "Active" },

  /* Outside every range used below. */
  { EmployeeId: 2004, EmployeeCode: "2004", EmployeeName: "Dipika Joshi",
    EmployeeType: "Regular", DesignationName: "Clerk",
    SectionId: 2, SectionName: "WOMEN SECTION", SectionSrNo: 2,
    InstituteCode: "CPD-17", InstituteName: "Institute Seventeen",
    DateOfJoining: "2005-01-10", DateOfRetirement: "2035-12-31",
    CCCPassDate: "2009-02-02", MonthOfIncrement: 3,
    IsActive: 1, Status: "Active" },

  /* Every selectable field NULL — must never appear in any selection. */
  { EmployeeId: 2005, EmployeeCode: "2005", EmployeeName: "Eknath Rana",
    EmployeeType: "Work Charge", DesignationName: "Driver",
    SectionId: 1, SectionName: "PH SECTION", SectionSrNo: 1,
    InstituteCode: "OGE-05", InstituteName: "Institute Five",
    DateOfJoining: null, DateOfRetirement: null,
    CCCPassDate: null, MonthOfIncrement: null,
    IsActive: 1, Status: "Active" },

  /* Inactive — outside the Employee Master's own active rule. */
  { EmployeeId: 2006, EmployeeCode: "2006", EmployeeName: "Falguni Mehta",
    EmployeeType: "Regular", DesignationName: "Clerk",
    SectionId: 1, SectionName: "PH SECTION", SectionSrNo: 1,
    InstituteCode: "OGE-05", InstituteName: "Institute Five",
    DateOfJoining: "2011-01-01", DateOfRetirement: "2026-09-30",
    CCCPassDate: "2016-01-01", MonthOfIncrement: 7,
    IsActive: 0, Status: "Inactive" },
];

const SECTIONS = [
  { SectionId: 1, SectionName: "PH SECTION", SrNo: 1 },
  { SectionId: 2, SectionName: "WOMEN SECTION", SrNo: 2 },
];
const INSTITUTES = [
  { InstituteId: 5, InstituteCode: "OGE-05", InstituteName: "Institute Five", SectionId: 1 },
  { InstituteId: 17, InstituteCode: "CPD-17", InstituteName: "Institute Seventeen", SectionId: 2 },
];

/* ------------------------------------------------------------------ *
 * Recording stub.
 *
 * The parameters the route binds are captured, and the fake engine applies
 * exactly the predicates the route's WHERE clause names — including the
 * inclusive >= / <= comparisons and the fact that NULL satisfies none of
 * them. Nothing about the expected answer is hard-coded.
 * ------------------------------------------------------------------ */
const statements = [];

function answerEmployeeQuery(text, params) {
  const active = EMPLOYEES.filter(
    (e) => (e.IsActive == null || e.IsActive === 1) &&
      String(e.Status || "Active").toUpperCase() === "ACTIVE"
  );
  /* The SELECT list names all four columns, so the filtered column must be
     read from the WHERE clause alone. */
  const whereText = text.slice(text.search(/\bWHERE\b/i));
  const col = (e) => {
    if (whereText.includes("e.DateOfRetirement")) return e.DateOfRetirement;
    if (whereText.includes("e.CCCPassDate")) return e.CCCPassDate;
    if (whereText.includes("e.DateOfJoining")) return e.DateOfJoining;
    return e.MonthOfIncrement;
  };
  return active.filter((e) => {
    const value = col(e);
    if (whereText.includes("@IncrementMonth")) {
      if (value == null) return false;          /* NULL = NULL is never true */
      if (Number(value) !== Number(params.IncrementMonth)) return false;
    } else {
      if (whereText.includes("IS NOT NULL") && value == null) return false;
      if (value == null) return false;
      if (params.FromDate != null && !(value >= params.FromDate)) return false;
      if (params.ToDate != null && !(value <= params.ToDate)) return false;
    }
    if (params.SectionId != null && Number(e.SectionId) !== Number(params.SectionId)) {
      return false;
    }
    if (params.InstituteCode != null &&
        String(e.InstituteCode).toUpperCase() !==
          String(params.InstituteCode).toUpperCase()) {
      return false;
    }
    return true;
  });
}

function answer(text, params) {
  statements.push(String(text || ""));
  const t = String(text || "");
  if (/FROM dbo\.EmployeeMaster/i.test(t)) {
    return Promise.resolve({ recordset: answerEmployeeQuery(t, params) });
  }
  if (/FROM dbo\.Sections/i.test(t)) return Promise.resolve({ recordset: SECTIONS });
  if (/FROM dbo\.Institutes/i.test(t)) return Promise.resolve({ recordset: INSTITUTES });
  return Promise.resolve({ recordset: [] });
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    Date: "Date", Int: "Int", NVarChar: () => "NVarChar",
    query: (strings, ...vals) => {
      const text = Array.isArray(strings)
        ? strings.reduce((acc, s, i) => acc + s + (i < vals.length ? String(vals[i]) : ""), "")
        : String(strings);
      return answer(text, {});
    },
    Request: function R() {
      const params = {};
      return {
        input(name, _type, value) { params[name] = value; return this; },
        query: (text) => answer(text, params),
      };
    },
  },
  connectDB: async () => true,
};

/* ---------- runner ---------- */
let passed = 0, failed = 0;
const failures = [];
let sectionName = "", secPass = 0, secFail = 0;
const sectionReport = [];
function closeSection() {
  if (!sectionName) return;
  sectionReport.push({
    name: sectionName,
    verdict: secFail === 0 ? "PASS" : "FAIL",
    assertions: secPass + secFail,
  });
  console.log(`  → ${secFail === 0 ? "PASS" : "FAIL"}   assertions: ${secPass + secFail}`);
}
function section(t) {
  closeSection();
  sectionName = t; secPass = 0; secFail = 0;
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; secPass++; console.log(`  PASS  ${name}`); }
  else {
    failed++; secFail++;
    failures.push(`[${sectionName}] ${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

const report = require("../routes/employeeReport");
const routeSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "employeeReport.js"), "utf8"
);
const routeCode = routeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "EmployeeReport.jsx"),
  "utf8"
);

const names = (data) => data.rows.map((r) => r.employeeName);
const FY = { fromDate: "2026-04-01", toDate: "2027-03-31" };

async function main() {
  console.log("======================================================================");
  console.log("  EMPLOYEE REPORT");
  console.log("======================================================================");

  /* ================================================================ */
  section("1. Retirement Date Wise");

  const ret = await report.buildEmployeeReport({
    selectionType: "RETIREMENT_DATE", ...FY,
  });
  check("Test 1 — a retirement date inside the range is included",
    names(ret).includes("Bhavna Shah"), true);
  check("all three retirements inside 01-04-2026..31-03-2027 are listed",
    names(ret).sort(), ["Anil Patel", "Bhavna Shah", "Chirag Desai"]);
  check("Test 2 — a retirement date after the range is excluded",
    names(ret).includes("Dipika Joshi"), false);
  check("Test 2 — a retirement date before the range is excluded",
    names(await report.buildEmployeeReport({
      selectionType: "RETIREMENT_DATE",
      fromDate: "2026-07-01", toDate: "2027-03-31",
    })).includes("Anil Patel"), false);
  check("Test 3 — a NULL retirement date is excluded",
    names(ret).includes("Eknath Rana"), false);
  check("Test 18 — the To date itself is included",
    names(ret).includes("Chirag Desai"), true);
  check("an inactive employee is not listed",
    names(ret).includes("Falguni Mehta"), false);
  check("each retirement date is shown as stored, unshifted",
    ret.rows.map((r) => r.retirementDateText),
    ["30-06-2026", "31-03-2027", "31-03-2027"]);
  check("the columns show both service dates",
    ret.columns.map((c) => c.label).slice(-2),
    ["Date of Joining", "Retirement Date"]);

  /* ================================================================ */
  section("2. CCC Pass Date Wise");

  const ccc = await report.buildEmployeeReport({
    selectionType: "CCC_PASS_DATE", ...FY,
  });
  check("Test 4 — a CCC date inside the range is included",
    names(ccc).sort(), ["Bhavna Shah", "Chirag Desai"]);
  check("Test 5 — a CCC date outside the range is excluded",
    names(ccc).some((n) => ["Anil Patel", "Dipika Joshi"].includes(n)), false);
  check("Test 6 — a NULL CCC date is excluded",
    names(ccc).includes("Eknath Rana"), false);
  check("Test 18 — the From date itself is included",
    ccc.rows.find((r) => r.employeeName === "Bhavna Shah").cccPassDateText,
    "01-04-2026");
  check("the CCC column leads, followed by joining",
    ccc.columns.map((c) => c.label).slice(-2),
    ["CCC Pass Date", "Date of Joining"]);
  check("the real CCCPassDate column is what is filtered",
    /e\.CCCPassDate/.test(routeCode), true);

  /* ================================================================ */
  section("3. Joining Date Wise");

  const join = await report.buildEmployeeReport({
    selectionType: "JOINING_DATE", ...FY,
  });
  check("Test 7 — a joining date inside the range is included",
    names(join).sort(), ["Bhavna Shah", "Chirag Desai"]);
  check("Test 8 — a joining date outside the range is excluded",
    names(join).some((n) => ["Anil Patel", "Dipika Joshi"].includes(n)), false);
  check("a NULL joining date is excluded",
    names(join).includes("Eknath Rana"), false);
  check("Test 18 — both boundary dates are inclusive",
    [join.rows.find((r) => r.employeeName === "Bhavna Shah").joiningDateText,
     join.rows.find((r) => r.employeeName === "Chirag Desai").joiningDateText],
    ["01-04-2026", "31-03-2027"]);

  /* ================================================================ */
  section("4. Increment Month Wise");

  const inc = await report.buildEmployeeReport({
    selectionType: "INCREMENT_MONTH", incrementMonth: 7,
  });
  check("Test 9 — a matching increment month is included",
    names(inc).sort(), ["Anil Patel", "Chirag Desai"]);
  check("Test 10 — a different increment month is excluded",
    names(inc).some((n) => ["Bhavna Shah", "Dipika Joshi"].includes(n)), false);
  check("a NULL increment month is excluded",
    names(inc).includes("Eknath Rana"), false);
  check("the month is shown by name",
    [...new Set(inc.rows.map((r) => r.monthOfIncrementName))], ["July"]);
  check("the explicit MonthOfIncrement column is what is filtered",
    /e\.MonthOfIncrement/.test(routeCode), true);
  /* Derivation would mean reading a month OUT of the joining date, or
     assigning the increment month FROM it. Merely listing both columns in a
     SELECT is not derivation, so the check targets the computation itself. */
  check("the increment month is never computed from the joining date",
    /getMonth\(\)|DateOfJoining[^\n]*(MONTH\(|getMonth)|MonthOfIncrement\s*=\s*[^@\n]*DateOfJoining/
      .test(routeCode), false);
  check("EmployeeMaster.IncrementDate is not used as a substitute",
    /e\.IncrementDate/.test(routeCode), false);
  check("with no month chosen nothing is listed, and the reason is stated",
    await report.buildEmployeeReport({ selectionType: "INCREMENT_MONTH" })
      .then((d) => [d.rows.length, d.emptyMessage.includes("Increment Month")]),
    [0, true]);

  /* ================================================================ */
  section("5. Section and Institute filters");

  const bySection = await report.buildEmployeeReport({
    selectionType: "INCREMENT_MONTH", incrementMonth: 7, sectionId: 1,
  });
  check("Test 11 — the matching section is kept",
    names(bySection), ["Anil Patel"]);
  check("Test 11 — a different section is excluded",
    names(bySection).includes("Chirag Desai"), false);

  const byInstitute = await report.buildEmployeeReport({
    selectionType: "INCREMENT_MONTH", incrementMonth: 7, instituteCode: "CPD-17",
  });
  check("Test 12 — the matching institute is kept",
    names(byInstitute), ["Chirag Desai"]);
  check("Test 12 — a different institute is excluded",
    names(byInstitute).includes("Anil Patel"), false);

  check("Test 13 — date range, section and institute all apply together",
    names(await report.buildEmployeeReport({
      selectionType: "JOINING_DATE", ...FY, sectionId: 2, instituteCode: "CPD-17",
    })), ["Chirag Desai"]);
  check("a contradictory combination returns nothing, not a fallback",
    names(await report.buildEmployeeReport({
      selectionType: "JOINING_DATE", ...FY, sectionId: 1, instituteCode: "CPD-17",
    })), []);
  check("ALL is treated as no filter",
    (await report.buildEmployeeReport({
      selectionType: "INCREMENT_MONTH", incrementMonth: 7,
      sectionId: "ALL", instituteCode: "ALL",
    })).count, 2);
  check("the lookups come from the existing masters, not a copy",
    /FROM dbo\.Sections/.test(routeCode) && /FROM dbo\.Institutes/.test(routeCode),
    true);

  /* ================================================================ */
  section("6. Test 14 — empty result");

  const empty = await report.buildEmployeeReport({
    selectionType: "RETIREMENT_DATE", fromDate: "2040-01-01", toDate: "2040-12-31",
  });
  check("no employee matches", empty.rows, []);
  check("the count is zero", empty.count, 0);
  check("the project's empty-state message is returned",
    empty.emptyMessage, "No employees found for the selected criteria.");
  check("the page renders that message rather than fabricating rows",
    /\{report\.emptyMessage\}/.test(pageSrc), true);

  /* ================================================================ */
  section("7. Sorting and numbering");

  const sorted = await report.buildEmployeeReport({
    selectionType: "INCREMENT_MONTH", incrementMonth: 7,
  });
  check("Sr. No. is 1..n over the sorted rows",
    sorted.rows.map((r) => r.srNo), [1, 2]);
  check("section order comes before institute and name",
    sorted.rows.map((r) => r.sectionSrNo), [1, 2]);
  check("the selected date leads the sort for a date selection",
    (await report.buildEmployeeReport({
      selectionType: "JOINING_DATE", fromDate: "2000-01-01", toDate: "2030-01-01",
    })).rows.map((r) => r.joiningDateText),
    ["10-01-2005", "15-06-2010", "01-04-2026", "31-03-2027"]);

  /* ================================================================ */
  section("8. Tests 16 & 17 — Excel, PDF and Print share the dataset");

  check("the Excel export calls the same builder as the screen",
    (routeCode.match(/buildEmployeeReport\(req\.query \|\| \{\}\)/g) || []).length, 2);
  check("the export has no filtering of its own",
    /export\.xlsx[\s\S]*?\.filter\(/.test(routeCode), false);
  check("the export writes the builder's own rows and columns",
    /data\.rows\.map\(\(row\) =>[\s\S]{0,200}columns\.map/.test(routeCode), true);
  check("the columns are chosen once, by the backend, for every output",
    /columns: columnsFor\(selectionType\)/.test(routeCode), true);
  check("the page renders the backend's columns rather than its own list",
    /const columns = report\?\.columns \|\| \[\];/.test(pageSrc), true);
  check("PDF and Print use the same rendered sheet, via the print flow",
    (pageSrc.match(/onClick=\{handlePrint\}/g) || []).length, 2);
  check("the API helper builds one parameter set for screen and Excel",
    /buildFilterParams/.test(fs.readFileSync(path.join(
      __dirname, "..", "..", "frontend", "src", "utils", "employeeReportApi.js"
    ), "utf8")), true);

  /* ================================================================ */
  section("9. Test 15 — read-only");

  const joined = statements.join("\n").toUpperCase();
  check("INSERT statements", (joined.match(/\bINSERT\b/g) || []).length, 0);
  check("UPDATE statements", (joined.match(/\bUPDATE\b/g) || []).length, 0);
  check("DELETE statements", (joined.match(/\bDELETE\b/g) || []).length, 0);
  check("MERGE statements", (joined.match(/\bMERGE\b/g) || []).length, 0);
  check("TRUNCATE statements", (joined.match(/\bTRUNCATE\b/g) || []).length, 0);
  check("the route source contains no write statement at all",
    /\b(INSERT INTO|UPDATE\s+dbo\.|DELETE FROM|MERGE\s+dbo\.|TRUNCATE)\b/i
      .test(routeCode), false);
  check("every statement it issued was a SELECT",
    statements.filter((s) => !/^\s*SELECT/im.test(s)), []);
  check("no query loads the whole Employee Master unfiltered",
    /FROM dbo\.EmployeeMaster\s*(LEFT JOIN[\s\S]*?)?\s*(?!WHERE)$/m.test(routeCode),
    false);

  /* ================================================================ */
  section("10. Test 19 — the fields are real, and access is unchanged");

  /*
     All four selectable fields exist in the Employee Master. Recorded here so
     a future schema change that removes one fails loudly instead of the
     report quietly returning nothing:
       DateOfRetirement  DATE NULL  (sql/schema/07)
       DateOfJoining     DATE NULL  (sql/schema/07)
       CCCPassDate       DATE NULL  (read and written by routes/employees.js)
       MonthOfIncrement  INT  NULL  (validated by parseMonthOfIncrement there)
  */
  const schema07 = fs.readFileSync(path.join(
    __dirname, "..", "sql", "schema", "07_CreateEmployeePayHistory.sql"), "utf8");
  const employeesSrc = fs.readFileSync(path.join(
    __dirname, "..", "routes", "employees.js"), "utf8");
  check("DateOfRetirement exists in the Employee Master schema",
    /DateOfRetirement DATE NULL/.test(schema07), true);
  check("DateOfJoining exists in the Employee Master schema",
    /DateOfJoining DATE NULL/.test(schema07), true);
  check("CCCPassDate is a real Employee Master column",
    /CCCPassDate/.test(employeesSrc), true);
  check("MonthOfIncrement is a real Employee Master column",
    /MonthOfIncrement/.test(employeesSrc), true);
  check("no invented column name is referenced",
    Object.values(report.SELECTION_COLUMN).sort(),
    ["e.CCCPassDate", "e.DateOfJoining", "e.DateOfRetirement", "e.MonthOfIncrement"]);

  const shellSrc = fs.readFileSync(path.join(
    __dirname, "..", "..", "frontend", "src", "components", "AppShell.jsx"), "utf8");
  const accessSrc = fs.readFileSync(path.join(
    __dirname, "..", "..", "frontend", "src", "utils", "accessControl.js"), "utf8");
  const modulesSrc = fs.readFileSync(path.join(
    __dirname, "..", "..", "frontend", "src", "modules.js"), "utf8");
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  check("the page is registered under Reports",
    /\{ id: "employee-report", label: "Employee Report" \}/.test(modulesSrc), true);
  check("it renders through the same authorised wrapper as every report",
    /renderAuthorized\(\s*"employee-report"/.test(shellSrc), true);
  check("it reuses the existing REPORT_SALARY permission — no new one",
    /"employee-report": "REPORT_SALARY"/.test(accessSrc), true);
  check("the API is mounted behind the standard auth and permission guards",
    /app\.use\("\/api\/employee-report", \.\.\.authed, requirePermissionPrefix\(/
      .test(serverSrc), true);
  check("Employee Master save, update and delete were not touched",
    /router\.(post|put|delete)/.test(routeCode), false);
  check("this report defines only GET endpoints",
    (routeCode.match(/router\.(get|post|put|delete)\(/g) || []).sort(),
    ["router.get(", "router.get(", "router.get("]);

  closeSection();

  console.log("\n======================================================================");
  console.log("SECTION SUMMARY");
  console.log("======================================================================");
  for (const s of sectionReport) {
    console.log(`  ${s.verdict.padEnd(6)} ${String(s.assertions).padStart(2)} assertions   ${s.name}`);
  }
  console.log("\n======================================================================");
  console.log(`  TOTAL ASSERTIONS : ${passed + failed}`);
  console.log(`  PASSED           : ${passed}`);
  console.log(`  FAILED           : ${failed}`);
  console.log("======================================================================");
  if (failures.length) {
    console.log("\nFAILURES");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
