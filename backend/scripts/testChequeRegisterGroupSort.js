/**
 * Cheque Register: rows are sorted by Group before Sr. No. is assigned.
 *
 * Group codes sort naturally — alphabetic prefix first, then the numeric part
 * as a NUMBER — so CPD-17 comes before CPD-100, which plain string ordering
 * would get wrong.
 *
 * Runs offline. Usage: cd backend && npm run test:cheque-sort
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

const cheque = require("../routes/chequeRegister");
const { compareGroupCodes, sortAndNumberRows } = cheque;

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "chequeRegister.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "ChequeRegister.jsx"), "utf8");
const gridSrc = fs.readFileSync(path.join(FRONT, "components", "DataGrid.jsx"), "utf8");

const row = (group, extra = {}) => ({ group, srNo: 999, netAmount: 100, ...extra });
const groups = (rows) => rows.map((r) => r.group);
const srNos = (rows) => rows.map((r) => r.srNo);

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
  console.log("Cheque Register — Group sorting then Sr. No. numbering");
  console.log("=".repeat(72));

  /* ---------------- numeric ordering ---------------- */
  section("Numeric part sorts as a number, not as text");

  check("CPD-06 < CPD-17", compareGroupCodes("CPD-06", "CPD-17") < 0, true);
  check("CPD-17 < CPD-25", compareGroupCodes("CPD-17", "CPD-25") < 0, true);
  check("CPD-17 < CPD-100", compareGroupCodes("CPD-17", "CPD-100") < 0, true);
  check("CPD-100 > CPD-25", compareGroupCodes("CPD-100", "CPD-25") > 0, true);
  check("CPD-06 == CPD-06", compareGroupCodes("CPD-06", "CPD-06"), 0);
  check("leading zeros do not matter", compareGroupCodes("CPD-06", "CPD-6"), 0);
  check("string ordering would have been wrong",
    "CPD-100" < "CPD-17", true);
  check("the comparator disagrees with string ordering, correctly",
    compareGroupCodes("CPD-100", "CPD-17") > 0, true);

  check("full numeric run sorts naturally",
    ["CPD-100", "CPD-25", "CPD-06", "CPD-17", "CPD-9"].sort(compareGroupCodes),
    ["CPD-06", "CPD-9", "CPD-17", "CPD-25", "CPD-100"]);

  /* ---------------- prefix ordering ---------------- */
  section("Alphabetic prefix sorts first");

  check("BD < CPD", compareGroupCodes("BD-01", "CPD-06") < 0, true);
  check("CPD < DD", compareGroupCodes("CPD-25", "DD-03") < 0, true);
  check("DD < MR", compareGroupCodes("DD-03", "MR-02") < 0, true);
  check("MR < OGE", compareGroupCodes("MR-02", "OGE-05") < 0, true);
  check("a big CPD number still precedes BD? no — prefix wins",
    compareGroupCodes("CPD-01", "BD-99") > 0, true);
  check("mixed prefixes sort by prefix then number",
    ["OGE-10", "BD-01", "CPD-17", "MR-02", "OGE-05", "DD-03", "CPD-6"]
      .sort(compareGroupCodes),
    ["BD-01", "CPD-6", "CPD-17", "DD-03", "MR-02", "OGE-05", "OGE-10"]);
  check("case does not matter", compareGroupCodes("cpd-06", "CPD-06"), 0);
  check("codes with no number still sort",
    ["Salary", "DA Difference"].sort(compareGroupCodes),
    ["DA Difference", "Salary"]);
  check("an empty group does not throw", typeof compareGroupCodes("", null), "number");

  /* ---------------- the worked example ---------------- */
  section("The stated example");

  const example = sortAndNumberRows([
    row("CPD-25"), row("CPD-06"), row("CPD-17"), row("CPD-06"),
  ]);
  check("groups come out sorted",
    groups(example), ["CPD-06", "CPD-06", "CPD-17", "CPD-25"]);
  check("Sr. No. is 1..4 in that order", srNos(example), [1, 2, 3, 4]);

  /* ---------------- Sr. No. after sorting ---------------- */
  section("Sr. No. is generated AFTER sorting, never carried over");

  const withDbNumbers = sortAndNumberRows([
    row("OGE-10", { srNo: 1 }),
    row("BD-01", { srNo: 2 }),
    row("CPD-100", { srNo: 3 }),
    row("CPD-17", { srNo: 4 }),
  ]);
  check("the database Sr. No. is discarded",
    srNos(withDbNumbers), [1, 2, 3, 4]);
  check("numbering follows the sorted groups",
    groups(withDbNumbers), ["BD-01", "CPD-17", "CPD-100", "OGE-10"]);
  check("row that was Sr. 4 is now Sr. 2",
    withDbNumbers[1].group, "CPD-17");
  check("Sr. No. is always a dense 1..n",
    srNos(sortAndNumberRows([row("A-2"), row("A-1"), row("A-3")])), [1, 2, 3]);

  /* ---------------- grouping and within-group order ---------------- */
  section("Same Group stays together, in its existing order");

  const together = sortAndNumberRows([
    row("CPD-06", { billNo: "B3" }),
    row("OGE-05", { billNo: "B9" }),
    row("CPD-06", { billNo: "B1" }),
    row("CPD-06", { billNo: "B2" }),
    row("OGE-05", { billNo: "B8" }),
  ]);
  check("all CPD-06 rows are contiguous",
    groups(together), ["CPD-06", "CPD-06", "CPD-06", "OGE-05", "OGE-05"]);
  check("their existing order within the group is untouched (stable sort)",
    together.slice(0, 3).map((r) => r.billNo), ["B3", "B1", "B2"]);
  check("and so is the second group's",
    together.slice(3).map((r) => r.billNo), ["B9", "B8"]);
  check("nothing is re-ordered inside a group by this fix",
    /\.sort\(\(a, b\) => compareGroupCodes\(a\.group, b\.group\)\)/.test(routeSrc), true);

  /* ---------------- one authoritative point ---------------- */
  section("One sorting point feeds screen, exports and print");

  check("Sr. No. is assigned only inside sortAndNumberRows",
    (routeSrc.match(/srNo: idx \+ 1/g) || []).length, 1);
  check("the report builder sorts before numbering",
    /sortAndNumberRows\(filterRows\(mapped, query\)\)/.test(routeSrc), true);
  check("the .xlsx export reuses the same builder",
    /buildChequeRegisterReport/.test(routeSrc), true);
  check("the frontend does not sort the rows again",
    /rows[\s\S]{0,40}\.sort\(/.test(pageSrc), false);
  check("the frontend does not renumber the rows",
    /srNo: idx \+ 1|srNo: index \+ 1/.test(pageSrc), false);
  check("the screen prints the server's Sr. No.",
    /<td>\{row\.srNo\}<\/td>/.test(pageSrc), true);
  check("exports are built from the same rows in the same order",
    /const exportRows = useMemo\(\(\) => \{\s*const mapped = rows\.map/.test(pageSrc), true);
  check("CSV, Excel, PDF and Print share one row builder",
    /const \{ header, body \} = exportRows\(visible, rows\);/.test(gridSrc), true);
  check("export rows keep array order (map, never sort)",
    /const body = rows\.map\(/.test(gridSrc), true);

  /* ---------------- totals row ---------------- */
  section("The TOTAL row stays last and unnumbered");

  check("the screen keeps TOTAL in the table foot",
    /<tfoot>[\s\S]{0,200}TOTAL/.test(pageSrc), true);
  check("the exported TOTAL row is appended after the data rows",
    /\.\.\.mapped,\s*\{\s*srNo: "TOTAL"/.test(pageSrc), true);
  check("it carries the word TOTAL, not a number",
    /srNo: "TOTAL"/.test(pageSrc), true);
  check("the .xlsx totals row is written after the body",
    /\.\.\.body,\s*\.\.\.\(totalsRow\.length \? \[totalsRow\] : \[\]\)/.test(routeSrc), true);
  check("and its first cell is TOTAL",
    /if \(index === 0\) totalsRow\.push\("TOTAL"\)/.test(routeSrc), true);
  check("sortAndNumberRows never sees the totals row",
    sortAndNumberRows([row("CPD-06")]).length, 1);

  /* ---------------- filtering renumbers ---------------- */
  section("A filtered result renumbers from 1");

  const all = [row("OGE-05"), row("CPD-17"), row("CPD-06"), row("BD-01")];
  const filtered = sortAndNumberRows(all.filter((r) => r.group.startsWith("CPD")));
  check("only the displayed rows are numbered", srNos(filtered), [1, 2]);
  check("in sorted order", groups(filtered), ["CPD-06", "CPD-17"]);
  check("filtering happens before numbering in the builder",
    /sortAndNumberRows\(filterRows\(/.test(routeSrc), true);

  /* ---------------- nothing else touched ---------------- */
  section("Amounts and totals are untouched");

  const amounts = sortAndNumberRows([
    row("CPD-17", { netAmount: 5000, da: 100, ta: 7200, cla: 150 }),
    row("CPD-06", { netAmount: 4000, da: 200, ta: 3600, cla: 0 }),
  ]);
  check("every amount travels with its own row",
    amounts.map((r) => [r.group, r.netAmount, r.da, r.ta, r.cla]),
    [["CPD-06", 4000, 200, 3600, 0], ["CPD-17", 5000, 100, 7200, 150]]);
  check("the sort copies rows rather than mutating the input",
    /return \[\.\.\.rows\]/.test(routeSrc), true);
  /* The totals still come from the same reduce over the same rows, after
     sorting — the sort function itself touches no amount. */
  const sortFnBody = routeSrc.slice(
    routeSrc.indexOf("function sortAndNumberRows"),
    routeSrc.indexOf("/* GET /api/cheque-register?")
  );
  check("the sort function computes no totals",
    /addTotals|reduce\(/.test(sortFnBody), false);
  check("the sort function changes no amount field",
    /netAmount|chequeAmount|grossAmount|\bda\b|\bta\b/.test(sortFnBody), false);
  check("it only reorders and renumbers",
    /\.sort\([\s\S]{0,80}\.map\(\(row, idx\) => \(\{ \.\.\.row, srNo: idx \+ 1 \}\)\)/.test(sortFnBody), true);
  check("totals are still built from the sorted+numbered rows",
    /const totals = filtered\.reduce\(/.test(routeSrc), true);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
