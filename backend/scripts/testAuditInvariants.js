/**
 * Cross-module invariants confirmed by the end-to-end audit.
 *
 * These are behaviours that were verified by reading the shipped code and
 * that no single module's test suite owns, so a future change to any one
 * module could break them silently.
 *
 * Runs offline. Usage: cd backend && npm run test:audit
 */

const fs = require("fs");
const path = require("path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const readFront = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", rel), "utf8");

const serverSrc = read("server.js");
const approvalSrc = read("routes/salaryBillApproval.js");
const daUtilSrc = read("utils/daDifference.js");

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
  console.log("End-to-end audit invariants");
  console.log("=".repeat(72));

  /* ---------------- No report re-derives a stored amount ---------------- */
  section("Reports read stored salary amounts; none recompute TA");

  const reports = [
    "routes/finalSalaryBill.js",
    "routes/chequeRegister.js",
    "routes/salaryVariation.js",
    "utils/salaryVariationReport.js",
    "routes/salaryBillApproval.js",
  ];
  reports.forEach((rel) => {
    const src = read(rel);
    check(`${rel} does not consult the TA master`,
      /TransportAllowanceMaster/.test(src), false);
    check(`${rel} does not re-run the salary engine`,
      /calculateForEmployee\s*\(/.test(src), false);
  });
  check("a manual TA therefore reaches every report as stored",
    /ta: moneyRound\(row\.TA\)/.test(read("routes/finalSalaryBill.js")) &&
    /ta: moneyRound\(row\.TA\)/.test(read("utils/salaryVariationReport.js")) &&
    /ta: toNum\(row\.TA\)/.test(approvalSrc), true);

  /* ---------------- Approval header agrees with its rows ---------------- */
  section("Approval header totals are summed from the displayed rows");

  check("gross total sums the rows' own stored gross",
    /acc\.grossAmount \+= toNum\(row\.grossSalary\)/.test(approvalSrc), true);
  check("net total sums the rows' own stored net",
    /acc\.netSalary \+= toNum\(row\.netSalary\)/.test(approvalSrc), true);
  check("deduction total sums the rows' own stored deduction",
    /acc\.totalDeduction \+= toNum\(row\.totalDeduction\)/.test(approvalSrc), true);
  check("the header cannot be built from a second query",
    (approvalSrc.match(/function computeTotals/g) || []).length, 1);

  /* ---------------- Every API is authenticated ---------------- */
  section("Every /api route is mounted behind authentication");

  const mounts = serverSrc
    .split("\n")
    .filter((line) => /^app\.use\("\/api/.test(line.trim()));
  const unauthed = mounts
    .filter((line) => !/\.\.\.authed|authenticate/.test(line))
    .filter((line) => !/\/api\/auth/.test(line))
    .map((line) => (line.match(/"(\/api[^"]*)"/) || [])[1]);
  check("no /api router is mounted without authentication", unauthed, []);
  check("authed is the authenticate middleware",
    /const authed = \[authenticate\]/.test(serverSrc), true);
  check("Salary Entry is permission-gated",
    /\/api\/salary-entry[\s\S]{0,120}requirePermissionPrefix\("SALARY_ENTRY"\)/.test(serverSrc), true);
  check("DA Difference is permission-gated",
    /\/api\/da-difference[\s\S]{0,160}requirePermissionPrefix\(/.test(serverSrc), true);
  check("Salary Approval is permission-gated",
    /salary-bill-approval[\s\S]{0,200}requirePermissionPrefix\(/.test(serverSrc), true);

  /* ---------------- Workflow transitions are guarded ---------------- */
  section("Approve / Verify / Return / Reject reject invalid transitions");

  const gate = /if \(!\["SUBMITTED", "RESUBMITTED", "VERIFIED"\]\.includes\(current\)\)/g;
  check("all four actions gate on the current status",
    (approvalSrc.match(gate) || []).length, 4);
  check("an out-of-order transition is a 409",
    /status: 409/.test(approvalSrc), true);
  check("a LOCKED master bill blocks every institute mutation",
    /masterStatus === "LOCKED"[\s\S]{0,200}status\(403\)/.test(approvalSrc), true);
  check("Return requires an auditor and remarks",
    /Please select an auditor\./.test(approvalSrc) &&
    /Return remarks are required\./.test(approvalSrc), true);

  /* ---------------- DA source selection ---------------- */
  section("DA Difference still selects its source by real Bill Month");

  check("month match goes through the bill's BillMonth",
    /billMonthPartsFromSalaryBill/.test(daUtilSrc), true);
  check("no SalaryMonthNumber month match",
    /AND\s+TRY_CAST\(b\.SalaryMonthNumber/i.test(daUtilSrc), false);
  check("no BillCodeId DESC ordering trick",
    /ORDER BY b\.BillCodeId DESC/.test(daUtilSrc), false);
  check("no BillCode prefix used to pick the month",
    /BillCode LIKE N'%-BM-%'/.test(daUtilSrc), false);

  /* ---------------- Section filtering ---------------- */
  section("Institute filtering still uses the real SectionId relationship");

  const entrySrc = read("routes/salaryEntry.js");
  const pageSrc = readFront("pages/SalaryEntry.jsx");
  check("no institute-code prefix test in the backend",
    /startsWith\(\s*["'](OGE|BD|DD|MR|CPD)/.test(entrySrc), false);
  check("no institute-code prefix test in the page",
    /startsWith\(\s*["'](OGE|BD|DD|MR|CPD)/.test(pageSrc), false);
  check("the backend validates the section/institute pair",
    /function assertInstituteInSection/.test(entrySrc), true);

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
