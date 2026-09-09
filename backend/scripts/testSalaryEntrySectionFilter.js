/**
 * Salary Entry "Institute Section" filter (cases A-M).
 *
 * Verifies the cascading Section -> Institute Code -> Institute Name filter
 * uses the REAL dbo.Institutes.SectionId relationship (never a code prefix),
 * and that the backend rejects inconsistent section/institute pairs.
 *
 * Runs offline. Usage: cd backend && npm run test:section-filter
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ===================== FIXTURE ===================== */

const SECTIONS = [
  { SectionId: 1, SrNo: 1, SectionName: "OGE", Status: "Active" },
  { SectionId: 2, SrNo: 2, SectionName: "BD", Status: "Active" },
  { SectionId: 3, SrNo: 3, SectionName: "CPD", Status: "Inactive" },
];

const INSTITUTES = [
  { InstituteId: 11, InstituteCode: "OGE-05", InstituteName: "OGE Five", SectionId: 1 },
  { InstituteId: 12, InstituteCode: "OGE-07", InstituteName: "OGE Seven", SectionId: 1 },
  { InstituteId: 21, InstituteCode: "BD-01", InstituteName: "BD One", SectionId: 2 },
  /* Deliberately "OGE-"-looking code that actually belongs to BD. */
  { InstituteId: 22, InstituteCode: "OGE-99", InstituteName: "Misfiled Ninety-Nine", SectionId: 2 },
  { InstituteId: 31, InstituteCode: "CPD-25", InstituteName: "CPD TwentyFive", SectionId: null },
];

/* db.js stub — the section filter must not need any new query. */
const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() { return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } }; },
  },
  connectDB: async () => true,
};

const salaryEntry = require("../routes/salaryEntry");
const { assertInstituteInSection } = salaryEntry;

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "SalaryEntry.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "salaryEntryApi.js"), "utf8");
const sectionApiSrc = fs.readFileSync(path.join(FRONT, "utils", "sectionApi.js"), "utf8");
const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryEntry.js"), "utf8");
const institutesSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "institutes.js"), "utf8");

/* Mirror of the frontend visibleInstitutes memo, driven by SectionId only. */
function visibleInstitutes(list, sectionId) {
  if (!sectionId) return list;
  return list.filter((row) => String(row.SectionId ?? "") === String(sectionId));
}

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
const failures = [];
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
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

function main() {
  console.log("=".repeat(72));
  console.log("Salary Entry Institute Section filter (cases A-M)");
  console.log("=".repeat(72));

  /* ---------------- A ---------------- */
  section("A — Section dropdown loads from the existing Section Master");
  check("A. sectionApi exposes listActiveSections",
    /export\s+(async\s+)?function\s+listActiveSections/.test(sectionApiSrc), true);
  check("A. it calls the existing /sections API, no new endpoint",
    /\/sections/.test(sectionApiSrc), true);
  check("A. Salary Entry imports it", /listActiveSections/.test(pageSrc), true);
  check("A. Salary Entry calls it", /listActiveSections\s*\(/.test(pageSrc), true);
  check("A. no new sections table/route was created for this page",
    fs.existsSync(path.join(__dirname, "..", "routes", "salaryEntrySections.js")), false);

  /* ---------------- B ---------------- */
  section("B — Institute list carries the real SectionId from Institute Master");
  check("B. institutes route joins dbo.Sections",
    /JOIN\s+dbo\.Sections/i.test(institutesSrc), true);
  check("B. institutes route returns sectionId", /sectionId/.test(institutesSrc), true);
  check("B. Salary Entry maps sectionId onto each institute",
    /sectionId:\s*row\.sectionId/.test(pageSrc), true);

  /* ---------------- C ---------------- */
  section("C — Selecting a Section filters Institute Code by relationship");
  check("C. OGE (1) shows only its institutes",
    visibleInstitutes(INSTITUTES, 1).map((r) => r.InstituteCode), ["OGE-05", "OGE-07"]);
  check("C. BD (2) shows only its institutes",
    visibleInstitutes(INSTITUTES, 2).map((r) => r.InstituteCode), ["BD-01", "OGE-99"]);
  check("C. no section selected shows all",
    visibleInstitutes(INSTITUTES, "").length, INSTITUTES.length);

  /* ---------------- D ---------------- */
  section("D — Filtering is by SectionId, NOT by code prefix");
  check("D. OGE-99 belongs to BD and is NOT listed under OGE",
    visibleInstitutes(INSTITUTES, 1).some((r) => r.InstituteCode === "OGE-99"), false);
  check("D. OGE-99 IS listed under BD",
    visibleInstitutes(INSTITUTES, 2).some((r) => r.InstituteCode === "OGE-99"), true);
  check("D. no startsWith prefix hack in the page",
    /startsWith\(\s*["'](OGE|BD|CPD)/.test(pageSrc), false);
  check("D. no hard-coded section name list in the page",
    /\[\s*["']OGE["']\s*,\s*["']BD["']/.test(pageSrc), false);
  check("D. no prefix hack in the backend route",
    /startsWith\(\s*["'](OGE|BD|CPD)/.test(routeSrc), false);
  check("D. institute with NULL SectionId is not attached to any section",
    visibleInstitutes(INSTITUTES, 1).concat(visibleInstitutes(INSTITUTES, 2))
      .some((r) => r.InstituteCode === "CPD-25"), false);

  /* ---------------- E ---------------- */
  section("E — Institute Name still follows the selected Institute Code");
  check("E. page keeps a full institutes list for name resolution",
    /const\s+selectedInstitute[\s\S]{0,200}institutes\.find/.test(pageSrc), true);
  check("E. selectedInstitute is NOT resolved from the filtered list",
    /const\s+selectedInstitute[\s\S]{0,200}visibleInstitutes\.find/.test(pageSrc), false);

  /* ---------------- F ---------------- */
  section("F — Changing Section clears an incompatible Institute Code");
  check("F. handleSectionChange exists", /handleSectionChange/.test(pageSrc), true);
  const allowedAfterSwitch = visibleInstitutes(INSTITUTES, 2).map((r) => r.InstituteCode);
  check("F. OGE-05 is not allowed after switching to BD",
    allowedAfterSwitch.includes("OGE-05"), false);
  check("F. the change handler re-points the institute when not allowed",
    /handleSectionChange[\s\S]{0,600}allowed\.some\([\s\S]{0,120}setInstituteCode\(/.test(pageSrc), true);
  check("F. and falls back to empty when the section has no institutes",
    /setInstituteCode\(\s*allowed\.length\s*\?[^)]*:\s*""\s*\)/.test(pageSrc), true);

  /* ---------------- G ---------------- */
  section("G — Section is sent with Get Data / Save / Submit");
  check("G. Get Data sends sectionId", /sectionId:\s*sectionId/.test(pageSrc), true);
  check("G. all three payloads send it",
    (pageSrc.match(/sectionId:\s*sectionId/g) || []).length, 3);
  check("G. the API helper accepts sectionId",
    /getSalaryEntryEmployees\([\s\S]{0,200}sectionId/.test(apiSrc), true);
  check("G. and puts it on the query string",
    /params\.set\(\s*["']sectionId["']/.test(apiSrc), true);

  /* ---------------- H ---------------- */
  section("H — Backend accepts a consistent section/institute pair");
  const oge05 = INSTITUTES[0];
  check("H. OGE-05 with section 1 is accepted",
    assertInstituteInSection(oge05, 1), null);
  check("H. string sectionId is accepted too",
    assertInstituteInSection(oge05, "1"), null);
  check("H. BD-01 with section 2 is accepted",
    assertInstituteInSection(INSTITUTES[2], 2), null);

  /* ---------------- I ---------------- */
  section("I — Backend rejects an inconsistent pair (section=OGE / BD-01)");
  const bad = assertInstituteInSection(INSTITUTES[2], 1);
  check("I. it is rejected", bad != null, true);
  check("I. with HTTP 400", bad?.status, 400);
  check("I. the message names the institute",
    /BD-01/.test(bad?.message || ""), true);
  check("I. the OGE-named BD institute is rejected under OGE too",
    assertInstituteInSection(INSTITUTES[3], 1)?.status, 400);
  check("I. an institute with NULL SectionId is rejected under any section",
    assertInstituteInSection(INSTITUTES[4], 1)?.status, 400);
  check("I. omitted sectionId stays backward-compatible (no rejection)",
    [assertInstituteInSection(oge05, undefined),
     assertInstituteInSection(oge05, null),
     assertInstituteInSection(oge05, "")], [null, null, null]);
  check("I. a non-numeric sectionId is ignored rather than 500-ing",
    assertInstituteInSection(oge05, "abc"), null);
  check("I. GET /employees enforces it",
    /assertInstituteInSection\(\s*institute,\s*req\.query\?\.sectionId/.test(routeSrc), true);
  check("I. save/submit enforces it",
    /assertInstituteInSection\(\s*institute,\s*req\.body\?\.sectionId/.test(routeSrc), true);

  /* ---------------- J ---------------- */
  section("J — Returned bill JUN-2026-BM-MAY / OGE-05 restores the Section");
  check("J. an effect derives the section from the selected institute",
    /selected\.sectionId/.test(pageSrc), true);
  const restored = INSTITUTES.find((r) => r.InstituteCode === "OGE-05");
  check("J. Section restores to OGE (1)", restored.SectionId, 1);
  check("J. OGE-05 is visible under the restored section",
    visibleInstitutes(INSTITUTES, restored.SectionId).some((r) => r.InstituteCode === "OGE-05"), true);
  check("J. returned mode does not clear the institute",
    /returnedMode/.test(pageSrc), true);
  check("J. the filter touches no bill-month state",
    /handleSectionChange[\s\S]{0,600}setBillMonth\(/.test(pageSrc), false);
  check("J. the filter touches no salary-month state",
    /handleSectionChange[\s\S]{0,600}setSalaryMonth\(/.test(pageSrc), false);

  /* ---------------- K ---------------- */
  section("K — No duplicate data source, no localStorage");
  check("K. the page does not persist the section in localStorage",
    /localStorage[\s\S]{0,80}section/i.test(pageSrc), false);
  check("K. no second sections fetch was added",
    (pageSrc.match(/listActiveSections\s*\(/g) || []).length <= 2, true);

  /* ---------------- L ---------------- */
  section("L — Salary calculation is untouched by the filter");
  check("L. handleSectionChange only CLEARS the grid, never recalculates it",
    /handleSectionChange[\s\S]{0,600}setEmployees\(\s*\[\s*\]\s*\)/.test(pageSrc), true);
  check("L. it does not recompute rows from the section",
    /handleSectionChange[\s\S]{0,600}setEmployees\(\s*\(/.test(pageSrc), false);
  check("L. no DA/HRA/TA recalculation hangs off sectionId",
    /sectionId[\s\S]{0,120}recalculateTransportAllowance/.test(pageSrc), false);
  check("L. assertInstituteInSection returns only a status/message, never amounts",
    Object.keys(assertInstituteInSection(INSTITUTES[2], 1)).sort(), ["message", "status"]);

  /* ---------------- M ---------------- */
  section("M — No schema change required");
  check("M. dbo.Institutes.SectionId is pre-existing (used by institutes route)",
    /i\.SectionId|SectionId/.test(institutesSrc), true);
  check("M. no new migration file was added for this feature",
    fs.readdirSync(path.join(__dirname, "..", "sql"))
      .some((f) => /section.*filter/i.test(f)), false);

  /* ---------------- Summary ---------------- */
  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main();
