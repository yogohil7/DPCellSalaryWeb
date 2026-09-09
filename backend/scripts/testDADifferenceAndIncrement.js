/**
 * Offline test for the DA Difference and Employee Increment engines.
 *
 * Runs WITHOUT SQL Server: dbo access is stubbed with an in-memory fixture,
 * so the arithmetic and the month-awareness rules can be verified anywhere.
 *
 * Fixture is requirement R:
 *   JAN-2026 Basic 35,000   FEB-2026 Basic 35,000
 *   Increment 01-Mar-2026 of 1,000
 *   MAR-2026 Basic 36,000   APR-2026 Basic 36,000
 *   DA actually paid 55%, revised DA rate 58%
 *
 * Usage:  cd backend && node scripts/testDADifferenceAndIncrement.js
 *     or: npm run test:da-difference
 */

const path = require("path");
const Module = require("module");

/* =========================================================
   FIXTURE
   ========================================================= */

const OLD_DA_RATE = 55;
const REVISED_DA_RATE = 58;

/* Salary snapshots actually written by Salary Entry, per Bill Month. */
const SNAPSHOTS = {
  "101|2026|01": {
    TotalBasic: 35000,
    BasicPay: 35000,
    DA: 19250,
    PayLevel: "4",
    BillMonth: "JAN-2026",
    SalaryMonth: "JAN-2026",
    BillCode: "JAN-2026",
  },
  "101|2026|02": {
    TotalBasic: 35000,
    BasicPay: 35000,
    DA: 19250,
    PayLevel: "4",
    BillMonth: "FEB-2026",
    SalaryMonth: "FEB-2026",
    BillCode: "FEB-2026",
  },
  "101|2026|03": {
    TotalBasic: 36000,
    BasicPay: 36000,
    DA: 19800,
    PayLevel: "4",
    BillMonth: "MAR-2026",
    SalaryMonth: "MAR-2026",
    BillCode: "MAR-2026",
  },
  "101|2026|04": {
    TotalBasic: 36000,
    BasicPay: 36000,
    DA: 19800,
    PayLevel: "4",
    BillMonth: "APR-2026",
    SalaryMonth: "APR-2026",
    BillCode: "APR-2026",
  },
  /* Employee 202 never received an increment. */
  "202|2026|01": {
    TotalBasic: 30000,
    BasicPay: 30000,
    DA: 16500,
    PayLevel: "3",
    BillMonth: "JAN-2026",
    SalaryMonth: "JAN-2026",
    BillCode: "JAN-2026",
  },
  "202|2026|02": {
    TotalBasic: 30000,
    BasicPay: 30000,
    DA: 16500,
    PayLevel: "3",
    BillMonth: "FEB-2026",
    SalaryMonth: "FEB-2026",
    BillCode: "FEB-2026",
  },
  "202|2026|03": {
    TotalBasic: 30000,
    BasicPay: 30000,
    DA: 16500,
    PayLevel: "3",
    BillMonth: "MAR-2026",
    SalaryMonth: "MAR-2026",
    BillCode: "MAR-2026",
  },
  "202|2026|04": {
    TotalBasic: 30000,
    BasicPay: 30000,
    DA: 16500,
    PayLevel: "3",
    BillMonth: "APR-2026",
    SalaryMonth: "APR-2026",
    BillCode: "APR-2026",
  },
  /*
    OGE-05 style Bill-Month variants under one Salary Month:
    both rows share SalaryMonth=JUN-2026 / SalaryMonthNumber=06.
  */
  "2011|2026|05": {
    TotalBasic: 23100,
    BasicPay: 23100,
    DA: 13860,
    PayLevel: "4",
    BillMonth: "MAY-2026",
    SalaryMonth: "JUN-2026",
    SalaryMonthNumber: "06",
    BillCode: "JUN-2026-BM-MAY",
    SalaryBillCodeId: 1014,
  },
  "2011|2026|06": {
    TotalBasic: 23800,
    BasicPay: 23800,
    DA: 14280,
    PayLevel: "4",
    BillMonth: "JUN-2026",
    SalaryMonth: "JUN-2026",
    SalaryMonthNumber: "06",
    BillCode: "JUN-2026",
    SalaryBillCodeId: 1013,
  },
};

/* Pay Matrix: level 4 cells. Cell 5 = 35,000 -> cell 6 = 36,000. */
const PAY_MATRIX = [
  { PayMatrixId: 45, PayRevisionId: 1, Level: "4", CellNo: 5, BasicPay: 35000 },
  { PayMatrixId: 46, PayRevisionId: 1, Level: "4", CellNo: 6, BasicPay: 36000 },
  { PayMatrixId: 47, PayRevisionId: 1, Level: "4", CellNo: 7, BasicPay: 37100 },
];

/* Increment rows already recorded. Mutated by the tests that record one. */
let INCREMENTS = [];

/* =========================================================
   DB STUB
   Intercepts require("../db") before the real one is loaded, so the
   msnodesqlv8 native driver is never needed.
   ========================================================= */

function makeRecordset(rows) {
  return { recordset: rows };
}

/** Tagged-template stub that dispatches on the SQL text. */
function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");

  /* DAMaster: revised rate for a month. */
  if (/FROM dbo\.DAMaster/i.test(text)) {
    const asOfDate = values.find(
      (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    );
    if (!asOfDate) return Promise.resolve(makeRecordset([]));
    return Promise.resolve(
      makeRecordset([
        {
          DAId: 9,
          DAPercentage: REVISED_DA_RATE,
          EffectiveFrom: "2026-01-01",
          EffectiveTo: null,
          PayRevisionId: null,
        },
      ])
    );
  }

  /* Historical salary snapshots for one employee (all Bill Months). */
  if (
    /FROM dbo\.SalaryEmployeeDetails d/i.test(text) &&
    /INNER JOIN dbo\.SalaryBillCodes b/i.test(text) &&
    !/SELECT DISTINCT/i.test(text) &&
    !/SELECT\s+d\.EmployeeId/i.test(text)
  ) {
    const employeeId = Number(values[0]);
    const instituteCode = values[1];
    const rows = Object.entries(SNAPSHOTS)
      .filter(([key]) => key.startsWith(`${employeeId}|`))
      .map(([key, row]) => {
        const [, year, monthNumber] = key.split("|");
        return {
          Id: 1,
          SalaryBillCodeId: row.SalaryBillCodeId || 500 + Number(monthNumber),
          EmployeeId: employeeId,
          InstituteCode: instituteCode,
          EmployeeName: employeeId === 101 ? "Test Employee A" : employeeId === 2011 ? "Employee 2011" : "Test Employee B",
          Designation: "Lecturer",
          EmployeeType: "REGULAR",
          BasicPay: row.BasicPay,
          GradePay: 0,
          TotalBasic: row.TotalBasic,
          DA: row.DA,
          HRA: 0,
          MA: 0,
          TA: 0,
          PayLevel: row.PayLevel,
          DARate: null,
          BillCode: row.BillCode || `${monthNumber}-${year}`,
          BillMonth: row.BillMonth || null,
          SalaryMonth: row.SalaryMonth || `${monthNumber}-${year}`,
          SalaryMonthNumber: row.SalaryMonthNumber || monthNumber,
          SalaryYear: year,
          BillMasterStatus: "OPEN",
          InstituteWorkflowStatus: "LOCKED",
        };
      });
    return Promise.resolve(makeRecordset(rows));
  }

  /* Employees that have snapshots in the period (BillMonth discovery). */
  if (
    /FROM dbo\.SalaryEmployeeDetails d/i.test(text) &&
    /EmployeeCode/i.test(text)
  ) {
    const instituteCode = values[0];
    const rows = Object.entries(SNAPSHOTS).map(([key, row]) => {
      const [employeeId, year, monthNumber] = key.split("|");
      return {
        EmployeeId: Number(employeeId),
        EmployeeName:
          employeeId === "101"
            ? "Test Employee A"
            : employeeId === "2011"
              ? "Employee 2011"
              : "Test Employee B",
        Designation: "Lecturer",
        EmployeeType: "REGULAR",
        EmployeeCode: `E${employeeId}`,
        BillCode: row.BillCode || `${monthNumber}-${year}`,
        BillMonth: row.BillMonth || null,
        SalaryMonth: row.SalaryMonth || `${monthNumber}-${year}`,
        SalaryMonthNumber: row.SalaryMonthNumber || monthNumber,
        SalaryYear: year,
        InstituteCode: instituteCode,
      };
    });
    return Promise.resolve(makeRecordset(rows));
  }

  /* Increment history. */
  if (/FROM dbo\.EmployeeIncrement/i.test(text)) {
    const employeeId = Number(values[0]);
    let rows = INCREMENTS.filter((r) => Number(r.EmployeeId) === employeeId);
    if (/EffectiveMonth = /i.test(text)) {
      const month = values[1];
      rows = rows.filter(
        (r) => r.EffectiveMonth === month && r.Status === "Active"
      );
    } else if (/Status = N'Active'/i.test(text) && values[1] === 0) {
      rows = rows.filter((r) => r.Status === "Active");
    }
    return Promise.resolve(makeRecordset(rows));
  }

  /* Next Pay Matrix cell. */
  if (/FROM dbo\.PayMatrixMaster/i.test(text)) {
    const payRevisionId = Number(values[0]);
    const level = String(values[1]).trim();
    const afterCell = Number(values[2]);
    const rows = PAY_MATRIX.filter(
      (r) =>
        r.PayRevisionId === payRevisionId &&
        String(r.Level) === level &&
        r.CellNo > afterCell
    ).sort((a, b) => a.CellNo - b.CellNo);
    return Promise.resolve(makeRecordset(rows.slice(0, 1)));
  }

  return Promise.resolve(makeRecordset([]));
}

const dbStub = {
  sql: {
    query,
    Request: function Request() {
      return { query };
    },
  },
  connectDB: async () => true,
};

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = dbStub;

/* =========================================================
   MODULES UNDER TEST (loaded after the stub is in place)
   ========================================================= */

const increment = require("../utils/employeeIncrement");
const daDiff = require("../utils/daDifference");
const { calculateSalaryAmounts, calculateNps } = require("../utils/salaryBasicCalc");
const {
  getTransportAllowanceGroup,
  getClaPayLevelGroup,
  getPayLevelGroupFromPayLevel,
} = require("../utils/transportAllowanceGroup");

/* =========================================================
   TINY TEST RUNNER
   ========================================================= */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}\n          expected ${e}\n          actual   ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const EMPLOYEE_A = {
  EmployeeId: 101,
  EmployeeName: "Test Employee A",
  PayRevisionId: 1,
  PayLevel: "4",
  PayMatrixCellNo: 5,
  MonthOfIncrement: 3,
  IncrementDate: "2026-03-01",
};

const EMPLOYEE_NO_INCREMENT = {
  EmployeeId: 202,
  EmployeeName: "Test Employee B",
  PayRevisionId: 1,
  PayLevel: "3",
  PayMatrixCellNo: 2,
  MonthOfIncrement: null,
  IncrementDate: null,
};

const EMPLOYEE_JULY = {
  EmployeeId: 303,
  EmployeeName: "Test Employee C",
  PayRevisionId: 1,
  PayLevel: "4",
  PayMatrixCellNo: 5,
  MonthOfIncrement: 7,
  IncrementDate: "2026-07-01",
};

async function main() {
  console.log("=".repeat(66));
  console.log("DA Difference + Employee Increment engine tests (offline)");
  console.log("=".repeat(66));

  /* ---------------------------------------------------------
     1. Period expansion
     --------------------------------------------------------- */
  section("1. Difference period expansion");

  const janToApr = increment.buildMonthRange("2026", "01", "2026", "04");
  check("JAN-2026..APR-2026 gives 4 months", janToApr.length, 4);
  check(
    "month labels",
    janToApr.map((m) => m.label),
    ["JAN-2026", "FEB-2026", "MAR-2026", "APR-2026"]
  );
  check(
    "JAN-2026..JUN-2026 gives 6 months",
    increment.buildMonthRange("2026", "01", "2026", "06").length,
    6
  );
  check(
    "period spanning a year boundary",
    increment
      .buildMonthRange("2025", "11", "2026", "02")
      .map((m) => m.label),
    ["NOV-2025", "DEC-2025", "JAN-2026", "FEB-2026"]
  );
  check(
    "reversed period is rejected",
    increment.buildMonthRange("2026", "04", "2026", "01").length,
    0
  );

  /* ---------------------------------------------------------
     2. DA Difference, employee WITH an increment mid-period
     --------------------------------------------------------- */
  section("2. DA Difference for employee 101 (increment on 01-Mar-2026)");

  const rateMap = await daDiff.buildRateMap(janToApr);
  check("revised rate for JAN-2026", rateMap.get("2026-01").rate, REVISED_DA_RATE);

  const resultA = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months: janToApr,
    rateMap,
  });

  check(
    "historical Basic per month (NOT the current August Basic)",
    resultA.months.map((m) => m.historicalBasic),
    [35000, 35000, 36000, 36000]
  );
  check(
    "old DA per month is what was actually paid",
    resultA.months.map((m) => m.oldDA),
    [19250, 19250, 19800, 19800]
  );
  check(
    "old DA rate derived from the snapshot",
    resultA.months.map((m) => m.oldDARate),
    [OLD_DA_RATE, OLD_DA_RATE, OLD_DA_RATE, OLD_DA_RATE]
  );
  check(
    "revised DA per month",
    resultA.months.map((m) => m.revisedDA),
    [20300, 20300, 20880, 20880]
  );
  check(
    "monthly difference",
    resultA.months.map((m) => m.differenceAmount),
    [1050, 1050, 1080, 1080]
  );
  check("total DA difference", resultA.totalDifferenceAmount, 4260);
  check(
    "JAN and FEB did NOT use the post-increment Basic",
    resultA.months.slice(0, 2).every((m) => m.historicalBasic === 35000),
    true
  );

  /* ---------------------------------------------------------
     3. DA Difference, employee with NO increment
     --------------------------------------------------------- */
  section("3. DA Difference for employee 202 (no increment)");

  const resultB = await daDiff.calculateEmployeeDifference({
    employeeId: 202,
    instituteCode: "INST1",
    months: janToApr,
    rateMap,
  });

  check(
    "Basic constant across the period",
    resultB.months.map((m) => m.historicalBasic),
    [30000, 30000, 30000, 30000]
  );
  check(
    "monthly difference constant",
    resultB.months.map((m) => m.differenceAmount),
    [900, 900, 900, 900]
  );
  check("total DA difference", resultB.totalDifferenceAmount, 3600);

  /* ---------------------------------------------------------
     4. Missing snapshot is reported, not invented
     --------------------------------------------------------- */
  section("4. Month with no salary snapshot");

  const wide = increment.buildMonthRange("2025", "12", "2026", "01");
  const wideRates = await daDiff.buildRateMap(wide);
  const resultC = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months: wide,
    rateMap: wideRates,
  });
  check("missing month is flagged", resultC.months[0].snapshotMissing, true);
  check("missing month contributes 0", resultC.months[0].differenceAmount, 0);
  check("present month still calculates", resultC.months[1].differenceAmount, 1050);

  /* ---------------------------------------------------------
     5. Increment month-awareness
     --------------------------------------------------------- */
  section("5. Increment due detection (never July-hard-coded)");

  check(
    "employee A: due in MAR-2026",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2026", "03"),
    true
  );
  check(
    "employee A: NOT due in FEB-2026",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2026", "02"),
    false
  );
  check(
    "employee A: NOT due in JUL-2026",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2026", "07"),
    false
  );
  check(
    "employee A: due again in MAR-2027 (annual)",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2027", "03"),
    true
  );
  check(
    "employee A: not due before the increment year",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2025", "03"),
    false
  );
  check(
    "employee C: due in JUL-2026",
    increment.isIncrementDueInMonth(EMPLOYEE_JULY, "2026", "07"),
    true
  );
  check(
    "employee C: NOT due in JUN-2026",
    increment.isIncrementDueInMonth(EMPLOYEE_JULY, "2026", "06"),
    false
  );
  check(
    "employee B: never due (no increment month configured)",
    increment.isIncrementDueInMonth(EMPLOYEE_NO_INCREMENT, "2026", "07"),
    false
  );

  /* ---------------------------------------------------------
     6. Increment resolution from the Pay Matrix
     --------------------------------------------------------- */
  section("6. Increment calculation");

  INCREMENTS = [];
  const due = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "03",
  });
  check("increment is due", due.due, true);
  check("previous Basic", due.previousBasic, 35000);
  check("new Basic from the next matrix cell", due.newBasic, 36000);
  check("increment amount", due.incrementAmount, 1000);
  check("cell advanced 5 -> 6", [due.previousCellNo, due.newCellNo], [5, 6]);
  check("source is the pay matrix", due.source, "matrix");

  const notDue = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "02",
  });
  check("FEB: not due", notDue.due, false);
  check("FEB: Basic unchanged", notDue.newBasic, 35000);

  const manual = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "03",
    manualAmount: 1500,
  });
  check("manual amount wins", manual.incrementAmount, 1500);
  check("manual new Basic", manual.newBasic, 36500);

  /* ---------------------------------------------------------
     7. Increment stays in effect in later months
     --------------------------------------------------------- */
  section("7. Increment persistence across months");

  INCREMENTS = [
    {
      IncrementId: 1,
      EmployeeId: 101,
      EffectiveMonth: "2026-03",
      Status: "Active",
      PreviousBasic: 35000,
      NewBasic: 36000,
      IncrementAmount: 1000,
      PreviousPayLevel: "4",
      NewPayLevel: "4",
      PreviousCellNo: 5,
      NewCellNo: 6,
      PayMatrixId: 46,
    },
  ];

  check(
    "FEB-2026 keeps the old Basic",
    increment.resolveBasicForMonth(INCREMENTS, "2026-02", 35000),
    35000
  );
  check(
    "MAR-2026 uses the new Basic",
    increment.resolveBasicForMonth(INCREMENTS, "2026-03", 35000),
    36000
  );
  check(
    "APR-2026 still uses the new Basic",
    increment.resolveBasicForMonth(INCREMENTS, "2026-04", 35000),
    36000
  );
  check(
    "AUG-2026 still uses the new Basic",
    increment.resolveBasicForMonth(INCREMENTS, "2026-08", 35000),
    36000
  );
  check(
    "JAN-2026 (before it) is untouched",
    increment.resolveBasicForMonth(INCREMENTS, "2026-01", 35000),
    35000
  );

  const state = increment.resolveEmployeeStateForMonth({
    pay: { basicPay: 35000, level: "4", cellNo: 5, payMatrixId: 45 },
    increments: INCREMENTS,
    targetMonthKey: "2026-04",
  });
  check("state carries the new cell", [state.basic, state.cellNo], [36000, 6]);

  /* A second annual increment chains from the new cell, not the base one. */
  const nextYear = await increment.resolveIncrementForMonth({
    employee: { ...EMPLOYEE_A, PayLevel: state.payLevel, PayMatrixCellNo: state.cellNo },
    currentBasic: state.basic,
    year: "2027",
    monthNumber: "03",
  });
  check("MAR-2027 chains 6 -> 7", [nextYear.previousCellNo, nextYear.newCellNo], [6, 7]);
  check("MAR-2027 new Basic", nextYear.newBasic, 37100);

  /* ---------------------------------------------------------
     8. Component recalculation after an increment
     --------------------------------------------------------- */
  section("8. Salary components recalculated from the new Basic");

  const before = calculateSalaryAmounts({
    basic: 35000,
    fixBasic: 0,
    daPercentage: REVISED_DA_RATE,
    hraPercentage: 9,
  });
  const after = calculateSalaryAmounts({
    basic: 36000,
    fixBasic: 0,
    daPercentage: REVISED_DA_RATE,
    hraPercentage: 9,
  });

  check("Total Basic Pay follows the increment", after.totalBasicPay, 36000);
  check("DA recalculated on the new Total Basic", after.da, 20880);
  check("DA changed from the pre-increment value", before.da !== after.da, true);
  check("HRA recalculated on the new Total Basic", after.hra, 3240);
  check("NPS = CEILING((TotalBasic + DA) x 10%, 1)", after.nps, Math.ceil((36000 + 20880) * 0.1));
  check("NPS excludes HRA/MA/TA/CLA", calculateNps(36000, 20880), 5688);
  check("HRA forced to zero when payroll config says so",
    calculateSalaryAmounts({
      basic: 36000, fixBasic: 0, daPercentage: REVISED_DA_RATE,
      hraPercentage: 9, payrollHra: true,
    }).hra,
    0
  );

  /* ---------------------------------------------------------
     9. Pay level classification after an increment
     --------------------------------------------------------- */
  section("9. TA / CLA classification");

  check("TA: below PayMatrix Level-1 Cell-11 threshold stays Level 2 and Below", getTransportAllowanceGroup(23800, "IS-1", { basicUpgradeThreshold: 24200 }), "Level 2 and Below");
  check("TA: at PayMatrix Level-1 Cell-11 threshold moves to Level 3-8", getTransportAllowanceGroup(24200, "IS-2", { basicUpgradeThreshold: 24200 }), "Level 3-8");
  check("TA: above threshold is Level 3-8", getTransportAllowanceGroup(24201, null, { basicUpgradeThreshold: 24200 }), "Level 3-8");
  check("TA: 36,000 with Level 4 is Level 3-8", getTransportAllowanceGroup(36000, "4"), "Level 3-8");
  check("TA groups from pay level", [
    getPayLevelGroupFromPayLevel("2"),
    getPayLevelGroupFromPayLevel("4"),
    getPayLevelGroupFromPayLevel("9"),
  ], ["Level 2 and Below", "Level 3-8", "Level 9 and Above"]);
  check("CLA keeps its own separate grouping", [
    getClaPayLevelGroup("IS-2"),
    getClaPayLevelGroup("3"),
    getClaPayLevelGroup("4"),
  ], ["Level 1 to Below", "Level 1 to 3", "Level 4 and Above"]);

  /* ---------------------------------------------------------
     10. Snapshot immutability
     --------------------------------------------------------- */
  section("10. Saved snapshot is independent of later master changes");

  const savedMonth = daDiff.calculateMonthDifference({
    month: janToApr[0],
    snapshot: { TotalBasic: 35000, DA: 19250, SalaryBillCodeId: 501, BillCode: "01-2026" },
    revisedRate: 58,
  });
  const recalculatedLater = daDiff.calculateMonthDifference({
    month: janToApr[0],
    snapshot: { TotalBasic: 35000, DA: 19250, SalaryBillCodeId: 501, BillCode: "01-2026" },
    revisedRate: 62,
  });
  check("saved row used the rate in force when it was saved", savedMonth.differenceAmount, 1050);
  check("a later master change would give a different number", recalculatedLater.differenceAmount, 2450);
  check(
    "so the stored snapshot must be read back, not recomputed",
    savedMonth.differenceAmount !== recalculatedLater.differenceAmount,
    true
  );

  /* ---------------------------------------------------------
     SUMMARY
     --------------------------------------------------------- */
  console.log(`\n${"=".repeat(66)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(66));
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
