/**
 * DA Difference must source each month's salary by the bill's actual
 * BillMonth, never by SalaryMonth (cases A-J).
 *
 * OGE-05 fixture: two bills share SalaryMonth JUN-2026 but have different
 * Bill Months, and employee 2011 appears in both.
 *
 * Runs offline. Usage: cd backend && npm run test:da-bill-month
 */

const path = require("path");
const Module = require("module");

/* ===================== FIXTURE ===================== */

const BILLS = {
  601: { BillCodeId: 601, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
         SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026",
         BillCategory: "Salary", Status: "LOCKED", IsArchived: 0 },
  602: { BillCodeId: 602, BillCode: "JUN-2026", BillMonth: "JUN-2026",
         SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026",
         BillCategory: "Salary", Status: "LOCKED", IsArchived: 0 },
  603: { BillCodeId: 603, BillCode: "APR-2026", BillMonth: "APR-2026",
         SalaryMonth: "April", SalaryMonthNumber: "04", SalaryYear: "2026",
         BillCategory: "Salary", Status: "LOCKED", IsArchived: 0 },
};

/* Employee 2011 in BOTH June bills with DIFFERENT salary; 2012 only in MAY. */
const DETAILS = [
  { SalaryBillCodeId: 601, EmployeeId: 2011, InstituteCode: "OGE-05",
    EmployeeName: "Emp 2011", TotalBasic: 35000, DA: 19250, DARate: 55, PayLevel: "7" },
  { SalaryBillCodeId: 602, EmployeeId: 2011, InstituteCode: "OGE-05",
    EmployeeName: "Emp 2011", TotalBasic: 36000, DA: 19800, DARate: 55, PayLevel: "7" },
  { SalaryBillCodeId: 601, EmployeeId: 2012, InstituteCode: "OGE-05",
    EmployeeName: "Emp 2012", TotalBasic: 30000, DA: 16500, DARate: 55, PayLevel: "5" },
  { SalaryBillCodeId: 603, EmployeeId: 2011, InstituteCode: "OGE-05",
    EmployeeName: "Emp 2011", TotalBasic: 34000, DA: 18700, DARate: 55, PayLevel: "7" },
];

const REVISED_RATE = 58;

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");

  if (/FROM dbo\.DAMaster/i.test(text)) {
    return Promise.resolve({
      recordset: [{ DAId: 9, DAPercentage: REVISED_RATE,
                    EffectiveFrom: "2026-01-01", EffectiveTo: null, PayRevisionId: null }],
    });
  }

  if (/FROM dbo\.SalaryEmployeeDetails d/i.test(text)) {
    const wantsEmployee = /d\.EmployeeId = \?/.test(text);
    const employeeId = wantsEmployee ? Number(values[0]) : null;
    const instituteCode = String(wantsEmployee ? values[1] : values[0]);

    const rows = DETAILS.filter(
      (d) =>
        d.InstituteCode === instituteCode &&
        (employeeId == null || d.EmployeeId === employeeId)
    ).map((d) => {
      const b = BILLS[d.SalaryBillCodeId];
      return {
        ...d, Id: d.SalaryBillCodeId * 10 + d.EmployeeId,
        BillCode: b.BillCode, BillMonth: b.BillMonth,
        SalaryMonth: b.SalaryMonth, SalaryMonthNumber: b.SalaryMonthNumber,
        SalaryYear: b.SalaryYear, BillMasterStatus: b.Status,
        InstituteWorkflowStatus: "LOCKED",
        EmployeeCode: `EMP${d.EmployeeId}`,
      };
    });
    return Promise.resolve({ recordset: rows });
  }

  return Promise.resolve({ recordset: [] });
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: { query, Request: function R() { return { query, input() { return this; } }; } },
  connectDB: async () => true,
};

const daDiff = require("../utils/daDifference");
const { buildMonthRange } = require("../utils/employeeIncrement");

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

async function main() {
  console.log("=".repeat(72));
  console.log("DA Difference sources salary by BillMonth (OGE-05, cases A-J)");
  console.log("=".repeat(72));

  const snap = (year, monthNumber, employeeId = 2011) =>
    daDiff.getHistoricalSnapshot({
      employeeId, instituteCode: "OGE-05", year, monthNumber,
    });

  /* ---------------- A / B ---------------- */
  section("A, B — each DA month picks the bill whose BillMonth matches");

  const may = await snap("2026", "05");
  check("A. MAY-2026 uses JUN-2026-BM-MAY", may?.BillCode, "JUN-2026-BM-MAY");
  check("A. its BillMonth is MAY-2026", may?.BillMonth, "MAY-2026");
  check("A. and its SalaryMonth is still June", may?.SalaryMonth, "June");
  check("A. MAY salary is the MAY bill's 35,000", may?.TotalBasic, 35000);

  const jun = await snap("2026", "06");
  check("B. JUN-2026 uses the JUN-2026 bill", jun?.BillCode, "JUN-2026");
  check("B. its BillMonth is JUN-2026", jun?.BillMonth, "JUN-2026");
  check("B. JUN salary is 36,000", jun?.TotalBasic, 36000);

  /* ---------------- C / D ---------------- */
  section("C, D — same SalaryMonth, same employee, different sources");

  check("C. the two months resolve to DIFFERENT bills",
    may?.BillCode !== jun?.BillCode, true);
  check("C. and to different SalaryBillCodeIds",
    [may?.SalaryBillCodeId, jun?.SalaryBillCodeId], [601, 602]);
  check("D. MAY did NOT fall back to the JUN master",
    may?.BillCode === "JUN-2026", false);
  check("D. salaries differ per month",
    [may?.TotalBasic, jun?.TotalBasic], [35000, 36000]);
  check("D. old DA differs per month", [may?.DA, jun?.DA], [19250, 19800]);

  const apr = await snap("2026", "04");
  check("C. APR-2026 uses the APR bill", apr?.BillCode, "APR-2026");
  check("C. three months, three bills",
    new Set([apr?.BillCode, may?.BillCode, jun?.BillCode]).size, 3);

  /* ---------------- E / F ---------------- */
  section("E, F — employee scoping and genuinely missing months");

  const emp2012May = await snap("2026", "05", 2012);
  check("E. 2012 has a MAY snapshot", emp2012May?.BillCode, "JUN-2026-BM-MAY");
  check("E. 2012 salary is its own", emp2012May?.TotalBasic, 30000);
  check("E. 2012 has NO JUN snapshot (only in the MAY bill)",
    await snap("2026", "06", 2012), null);
  check("E. 2012's MAY is not copied from 2011", emp2012May?.TotalBasic !== 35000, true);

  check("F. JAN-2026 has no bill at all", await snap("2026", "01"), null);
  check("F. FEB-2026 has no bill at all", await snap("2026", "02"), null);
  check("F. another institute sees nothing",
    await daDiff.getHistoricalSnapshot({
      employeeId: 2011, instituteCode: "CPD-25", year: "2026", monthNumber: "05",
    }), null);

  /* ---------------- Full period ---------------- */
  section("Full JAN-JUN period for employee 2011");

  const months = buildMonthRange("2026", "01", "2026", "06");
  const rateMap = await daDiff.buildRateMap(months);
  const result = await daDiff.calculateEmployeeDifference({
    employeeId: 2011, instituteCode: "OGE-05", months, rateMap,
  });

  check("source bill per month",
    result.months.map((m) => m.sourceBillCode),
    [null, null, null, "APR-2026", "JUN-2026-BM-MAY", "JUN-2026"]);
  check("historical basic per month",
    result.months.map((m) => m.historicalBasic),
    [0, 0, 0, 34000, 35000, 36000]);
  check("missing months flagged, present months not",
    result.months.map((m) => m.snapshotMissing),
    [true, true, true, false, false, false]);
  check("MAY is NOT the JUN master's 36,000",
    result.months[4].historicalBasic !== 36000, true);

  /* ---------------- G / H ---------------- */
  section("G, H — the source bill is persisted for save/load");

  check("G. each month carries sourceSalaryBillCodeId",
    result.months.slice(3).map((m) => m.sourceSalaryBillCodeId), [603, 601, 602]);
  check("G. and the source bill code", result.months[4].sourceBillCode, "JUN-2026-BM-MAY");

  const fs = require("fs");
  const routeSrc = fs.readFileSync(
    path.join(__dirname, "..", "routes", "daDifference.js"), "utf8"
  );
  check("H. save persists SourceSalaryBillCodeId",
    /SourceSalaryBillCodeId/.test(routeSrc), true);
  check("H. save persists SourceBillCode", /SourceBillCode/.test(routeSrc), true);
  check("H. saved detail reads the source back",
    /sourceBillCode: row\.SourceBillCode/.test(routeSrc), true);

  /* ---------------- I ---------------- */
  section("I — DA formulas unchanged");

  check("I. MAY revised DA = 35,000 x 58%", result.months[4].revisedDA, 20300);
  check("I. MAY difference = 20,300 - 19,250", result.months[4].differenceAmount, 1050);
  check("I. JUN revised DA = 36,000 x 58%", result.months[5].revisedDA, 20880);
  check("I. JUN difference = 20,880 - 19,800", result.months[5].differenceAmount, 1080);
  check("I. NPS still CEILING(diff x 10%, 1)",
    [result.months[4].npsDeduction, result.months[5].npsDeduction], [105, 108]);
  check("I. net = difference - NPS",
    [result.months[4].netDifferenceAmount, result.months[5].netDifferenceAmount],
    [945, 972]);

  /* ---------------- No ordering hack ---------------- */
  section("The fix is a BillMonth match, not an ORDER BY trick");

  const utilSrc = fs.readFileSync(
    path.join(__dirname, "..", "utils", "daDifference.js"), "utf8"
  );
  check("no SalaryMonthNumber month match remains",
    /AND\s+TRY_CAST\(b\.SalaryMonthNumber/i.test(utilSrc), false);
  check("month match goes through billMonthPartsFromSalaryBill",
    /billMonthPartsFromSalaryBill/.test(utilSrc), true);
  check("employee discovery also matches on BillMonth",
    /listEmployeesForPeriod[\s\S]{0,1600}billMonthPartsFromSalaryBill/.test(utilSrc), true);

  const employees = await daDiff.listEmployeesForPeriod({
    instituteCode: "OGE-05", months,
  });
  check("both employees discovered for the period",
    employees.map((e) => e.EmployeeId).sort(), [2011, 2012]);

  /* ---------------- UI source indicator (item 10) ---------------- */
  section("The screen can show which bill each month came from");

  const uiSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "pages", "DADifferenceEntry.jsx"),
    "utf8"
  );
  check("the grid row carries the source bill code",
    /sourceBillCode: month\.sourceBillCode/.test(uiSrc), true);
  check("the Month cell shows it as a tooltip",
    /title=\{[\s\S]{0,200}Source bill: \$\{row\.sourceBillCode\}/.test(uiSrc), true);
  check("no new column was added to the grid",
    (uiSrc.match(/key: "salaryMonth"/g) || []).length, 1);
  check("the Month text itself is unchanged",
    /\{row\.salaryMonth\}/.test(uiSrc), true);
  check("a month with no bill says so",
    /No salary bill found for this Bill Month/.test(uiSrc), true);
  check("the saved bill code is read back on reopen",
    /sourceBillCode: row\.SourceBillCode/.test(routeSrc), true);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
