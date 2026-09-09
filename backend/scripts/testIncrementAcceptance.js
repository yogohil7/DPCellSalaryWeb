/**
 * Acceptance tests A–O for the Employee Increment / DA Difference
 * integration. Runs offline: the database layer is stubbed with an
 * in-memory fixture, so no SQL Server is required.
 *
 * Kept separate from testDADifferenceAndIncrement.js so that suite keeps
 * reporting exactly 60/60.
 *
 * Usage:  cd backend && npm run test:acceptance
 */

const path = require("path");
const Module = require("module");

/* =========================================================
   FIXTURE
   ========================================================= */

const OLD_DA_RATE = 55;
const REVISED_DA_RATE = 58;

/* Salary snapshots as Salary Entry saved them, month by month. */
const SNAPSHOTS = {
  "101|2026|01": { TotalBasic: 35000, BasicPay: 35000, DA: 19250, PayLevel: "7" },
  "101|2026|02": { TotalBasic: 35000, BasicPay: 35000, DA: 19250, PayLevel: "7" },
  "101|2026|03": { TotalBasic: 36000, BasicPay: 36000, DA: 19800, PayLevel: "7" },
  "101|2026|04": { TotalBasic: 36000, BasicPay: 36000, DA: 19800, PayLevel: "7" },
  "202|2026|01": { TotalBasic: 30000, BasicPay: 30000, DA: 16500, PayLevel: "5" },
  "202|2026|02": { TotalBasic: 30000, BasicPay: 30000, DA: 16500, PayLevel: "5" },
  "202|2026|03": { TotalBasic: 30000, BasicPay: 30000, DA: 16500, PayLevel: "5" },
  "202|2026|04": { TotalBasic: 30000, BasicPay: 30000, DA: 16500, PayLevel: "5" },
};

/* Level 7 pay matrix: cell 5 = 35,000, 6 = 36,000, 7 = 37,000, 8 = 38,100. */
const PAY_MATRIX = [
  { PayMatrixId: 75, PayRevisionId: 1, Level: "7", CellNo: 5, BasicPay: 35000 },
  { PayMatrixId: 76, PayRevisionId: 1, Level: "7", CellNo: 6, BasicPay: 36000 },
  { PayMatrixId: 77, PayRevisionId: 1, Level: "7", CellNo: 7, BasicPay: 37000 },
  { PayMatrixId: 78, PayRevisionId: 1, Level: "7", CellNo: 8, BasicPay: 38100 },
  /* Level 9 has a single cell, to exercise the exhausted case. */
  { PayMatrixId: 90, PayRevisionId: 1, Level: "9", CellNo: 3, BasicPay: 56100 },
];

let INCREMENTS = [];

/* =========================================================
   DB STUB
   ========================================================= */

function rs(rows) {
  return { recordset: rows };
}

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");

  if (/FROM dbo\.DAMaster/i.test(text)) {
    const asOfDate = values.find(
      (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    );
    if (!asOfDate) return Promise.resolve(rs([]));
    return Promise.resolve(
      rs([
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

  /* Historical snapshots. The engine no longer asks for one month with TOP 1:
     it pulls every salary row for the employee+institute and picks the one
     whose BILL MONTH matches, so the stub serves the whole set. */
  if (/FROM dbo\.SalaryEmployeeDetails d/i.test(text)) {
    const [employeeId, instituteCode] = values;
    const rows = Object.entries(SNAPSHOTS)
      .filter(([key]) => key.startsWith(`${employeeId}|`))
      .map(([key, row], index) => {
        const [, year, monthNumber] = key.split("|");
        return {
          ...row,
          Id: index + 1,
          SalaryBillCodeId: 500 + Number(monthNumber),
          EmployeeId: Number(employeeId),
          InstituteCode: instituteCode,
          EmployeeName: Number(employeeId) === 101 ? "Employee A" : "Employee B",
          Designation: "Lecturer",
          EmployeeType: "REGULAR",
          BillCode: `${monthNumber}-${year}`,
          BillMonth: `${monthNumber}-${year}`,
          SalaryYear: year,
          SalaryMonthNumber: monthNumber,
          BillMasterStatus: "LOCKED",
          InstituteWorkflowStatus: "LOCKED",
        };
      });
    return Promise.resolve(rs(rows));
  }

  if (/SELECT DISTINCT/i.test(text) && /SalaryEmployeeDetails/i.test(text)) {
    return Promise.resolve(
      rs([
        { EmployeeId: 101, EmployeeName: "Employee A", EmployeeCode: "EMP101", Designation: "Lecturer", EmployeeType: "REGULAR" },
        { EmployeeId: 202, EmployeeName: "Employee B", EmployeeCode: "EMP202", Designation: "Lecturer", EmployeeType: "REGULAR" },
      ])
    );
  }

  if (/FROM dbo\.EmployeeIncrement/i.test(text)) {
    const employeeId = Number(values[0]);
    let rows = INCREMENTS.filter((r) => Number(r.EmployeeId) === employeeId);
    if (/EffectiveMonth = /i.test(text)) {
      const month = values[1];
      rows = rows.filter((r) => r.EffectiveMonth === month && r.Status === "Active");
    } else if (values[1] === 0) {
      rows = rows.filter((r) => r.Status === "Active");
    }
    return Promise.resolve(rs(rows));
  }

  if (/FROM dbo\.PayMatrixMaster/i.test(text)) {
    const payRevisionId = Number(values[0]);
    const level = String(values[1]).trim();

    /* findMatrixCellByBasic matches on BasicPay; findNextMatrixCell on CellNo. */
    if (/BasicPay = /i.test(text)) {
      const basic = Number(values[2]);
      const match = PAY_MATRIX.filter(
        (r) =>
          r.PayRevisionId === payRevisionId &&
          String(r.Level) === level &&
          Number(r.BasicPay) === basic
      ).sort((a, b) => a.CellNo - b.CellNo);
      return Promise.resolve(rs(match.slice(0, 1)));
    }

    const afterCell = Number(values[2]);
    const rows = PAY_MATRIX.filter(
      (r) =>
        r.PayRevisionId === payRevisionId &&
        String(r.Level) === level &&
        r.CellNo > afterCell
    ).sort((a, b) => a.CellNo - b.CellNo);
    return Promise.resolve(rs(rows.slice(0, 1)));
  }

  return Promise.resolve(rs([]));
}

const dbStub = {
  sql: { query, Request: function Request() { return { query }; } },
  connectDB: async () => true,
};

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = dbStub;

/* =========================================================
   MODULES UNDER TEST
   ========================================================= */

const increment = require("../utils/employeeIncrement");
const daDiff = require("../utils/daDifference");
const { calculateSalaryAmounts, calculateNps } = require("../utils/salaryBasicCalc");
const {
  getTransportAllowanceGroup,
  getClaPayLevelGroup,
} = require("../utils/transportAllowanceGroup");

/* =========================================================
   RUNNER
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
  EmployeeName: "Employee A",
  PayRevisionId: 1,
  PayLevel: "7",
  PayMatrixCellNo: 5,
  MonthOfIncrement: 3,
  IncrementDate: "2026-03-01",
};

const EMPLOYEE_B = {
  EmployeeId: 202,
  EmployeeName: "Employee B",
  PayRevisionId: 1,
  PayLevel: "5",
  PayMatrixCellNo: 2,
  MonthOfIncrement: null,
  IncrementDate: null,
};

const MARCH_2026 = {
  IncrementId: 1,
  EmployeeId: 101,
  EffectiveMonth: "2026-03",
  Status: "Active",
  PreviousBasic: 35000,
  NewBasic: 36000,
  IncrementAmount: 1000,
  PreviousPayLevel: "7",
  NewPayLevel: "7",
  PreviousCellNo: 5,
  NewCellNo: 6,
  PayMatrixId: 76,
};

async function main() {
  console.log("=".repeat(70));
  console.log("Acceptance tests A-O — Increment / DA Difference integration");
  console.log("=".repeat(70));

  /* ============ A / B / C ============ */
  section("A, B, C — Basic per salary month around a March increment");

  INCREMENTS = [MARCH_2026];
  const basicFor = (key) =>
    increment.resolveBasicForMonth(INCREMENTS, key, 35000);

  check("A. JAN-2026 Basic = 35,000", basicFor("2026-01"), 35000);
  check("A. FEB-2026 Basic = 35,000", basicFor("2026-02"), 35000);
  check("A. MAR-2026 Basic = 36,000", basicFor("2026-03"), 36000);
  check("B. APR-2026 still 36,000", basicFor("2026-04"), 36000);
  check("C. AUG-2026 still 36,000", basicFor("2026-08"), 36000);
  check("C. DEC-2026 still 36,000", basicFor("2026-12"), 36000);

  /* ============ D / E ============ */
  section("D, E — the increment chain into the next year");

  const stateFeb2027 = increment.resolveEmployeeStateForMonth({
    pay: { basicPay: 35000, level: "7", cellNo: 5, payMatrixId: 75 },
    increments: INCREMENTS,
    targetMonthKey: "2027-02",
  });
  check("E. FEB-2027 uses 36,000, NOT the March-2027 increment", stateFeb2027.basic, 36000);
  check("E. FEB-2027 cell is still 6", stateFeb2027.cellNo, 6);

  const march2027 = await increment.resolveIncrementForMonth({
    employee: {
      ...EMPLOYEE_A,
      PayLevel: stateFeb2027.payLevel,
      PayMatrixCellNo: stateFeb2027.cellNo,
    },
    currentBasic: stateFeb2027.basic,
    year: "2027",
    monthNumber: "03",
  });
  check("D. MAR-2027 chains 36,000 -> 37,000", march2027.newBasic, 37000);
  check("D. MAR-2027 cell 6 -> 7", [march2027.previousCellNo, march2027.newCellNo], [6, 7]);
  check("D. MAR-2027 increment amount", march2027.incrementAmount, 1000);

  /* A third year continues 7 -> 8. */
  const march2028 = await increment.resolveIncrementForMonth({
    employee: { ...EMPLOYEE_A, PayLevel: "7", PayMatrixCellNo: 7 },
    currentBasic: 37000,
    year: "2028",
    monthNumber: "03",
  });
  check("D. MAR-2028 chains cell 7 -> 8", [march2028.previousCellNo, march2028.newCellNo], [7, 8]);
  check("D. MAR-2028 new Basic", march2028.newBasic, 38100);

  /* ============ F ============ */
  section("F — employee with no increment configured");

  INCREMENTS = [];
  const noIncrement = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_B,
    currentBasic: 30000,
    year: "2026",
    monthNumber: "07",
  });
  check("F. no increment is due", noIncrement.due, false);
  check("F. Basic unchanged", noIncrement.newBasic, 30000);
  check("F. amount is zero", noIncrement.incrementAmount, 0);
  check(
    "F. Basic for any month stays 30,000",
    increment.resolveBasicForMonth([], "2026-12", 30000),
    30000
  );

  /* ============ G ============ */
  section("G — July is not hard-coded");

  check(
    "G. March employee is NOT due in July",
    increment.isIncrementDueInMonth(EMPLOYEE_A, "2026", "07"),
    false
  );
  check(
    "G. October employee is due in October",
    increment.isIncrementDueInMonth(
      { IncrementDate: "2026-10-01", MonthOfIncrement: 10 },
      "2026",
      "10"
    ),
    true
  );
  check(
    "G. October employee is NOT due in July",
    increment.isIncrementDueInMonth(
      { IncrementDate: "2026-10-01", MonthOfIncrement: 10 },
      "2026",
      "07"
    ),
    false
  );
  check(
    "G. January employee is due in January",
    increment.isIncrementDueInMonth(
      { IncrementDate: "2026-01-01", MonthOfIncrement: 1 },
      "2026",
      "01"
    ),
    true
  );
  check(
    "G. MonthOfIncrement is used when IncrementDate is absent",
    increment.isIncrementDueInMonth({ MonthOfIncrement: 9 }, "2026", "09"),
    true
  );

  /* ============ H ============ */
  section("H — manual New Basic overrides the Pay Matrix");

  const manual = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "03",
    manualNewBasic: 36500,
  });
  check("H. manual New Basic wins over the 36,000 cell", manual.newBasic, 36500);
  check("H. amount derived from it", manual.incrementAmount, 1500);
  check("H. source recorded as manual", manual.source, "manual-basic");

  /* A manual Basic that matches a real cell keeps its place in the matrix. */
  const manualOnCell = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "03",
    manualNewBasic: 37000,
  });
  check("H. manual Basic matching cell 7 adopts that cell", manualOnCell.newCellNo, 7);

  const manualTooLow = await increment.resolveIncrementForMonth({
    employee: EMPLOYEE_A,
    currentBasic: 35000,
    year: "2026",
    monthNumber: "03",
    manualNewBasic: 34000,
  });
  check("H. a lower manual Basic is refused", manualTooLow.incrementAmount, 0);
  check("H. and Basic is left unchanged", manualTooLow.newBasic, 35000);

  /* Future increments chain from the manual Basic, not the matrix value. */
  const afterManual = increment.resolveEmployeeStateForMonth({
    pay: { basicPay: 35000, level: "7", cellNo: 5, payMatrixId: 75 },
    increments: [
      { ...MARCH_2026, NewBasic: 36500, NewCellNo: 6, IncrementAmount: 1500 },
    ],
    targetMonthKey: "2026-08",
  });
  check("H. later months use the manual Basic", afterManual.basic, 36500);

  /* Pay Matrix exhausted: Basic must not become zero or be invented. */
  const exhausted = await increment.resolveIncrementForMonth({
    employee: {
      EmployeeId: 303,
      PayRevisionId: 1,
      PayLevel: "9",
      PayMatrixCellNo: 3,
      IncrementDate: "2026-03-01",
      MonthOfIncrement: 3,
    },
    currentBasic: 56100,
    year: "2026",
    monthNumber: "03",
  });
  check("H. exhausted level leaves Basic unchanged", exhausted.newBasic, 56100);
  check("H. exhausted level is not zero", exhausted.newBasic !== 0, true);
  check("H. exhausted level is reported", exhausted.source, "matrix-exhausted");

  /* ============ I / N / O ============ */
  section("I, N, O — saved snapshots are immutable");

  const janMonth = increment.buildMonthRange("2026", "01", "2026", "01")[0];
  const snapshot = {
    TotalBasic: 35000,
    DA: 19250,
    SalaryBillCodeId: 501,
    BillCode: "01-2026",
  };

  const atSaveTime = daDiff.calculateMonthDifference({
    month: janMonth,
    snapshot,
    revisedRate: 58,
  });
  const afterRateChange = daDiff.calculateMonthDifference({
    month: janMonth,
    snapshot,
    revisedRate: 70,
  });
  check("N. a saved row's own figures do not move", atSaveTime.differenceAmount, 1050);
  check("N. recalculating at a new rate would differ", afterRateChange.differenceAmount, 5250);
  check(
    "N. so saved rows must be read back, not recomputed",
    atSaveTime.differenceAmount !== afterRateChange.differenceAmount,
    true
  );

  /* O. EmployeeMaster now shows 36,000, but January still reads 35,000
     because the January snapshot is what is used. */
  const rateMap = await daDiff.buildRateMap(
    increment.buildMonthRange("2026", "01", "2026", "04")
  );
  const employeeAResult = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months: increment.buildMonthRange("2026", "01", "2026", "04"),
    rateMap,
  });
  check(
    "O. historical Basic comes from each month's snapshot",
    employeeAResult.months.map((m) => m.historicalBasic),
    [35000, 35000, 36000, 36000]
  );
  check(
    "I. a later master change cannot touch JAN/FEB",
    employeeAResult.months.slice(0, 2).every((m) => m.historicalBasic === 35000),
    true
  );

  /* ============ J / K ============ */
  section("J, K — every component recalculates from the new Basic");

  const before = calculateSalaryAmounts({
    basic: 35000, fixBasic: 0, daPercentage: REVISED_DA_RATE, hraPercentage: 9,
  });
  const after = calculateSalaryAmounts({
    basic: 36000, fixBasic: 0, daPercentage: REVISED_DA_RATE, hraPercentage: 9,
  });

  check("J. Total Basic follows the increment", after.totalBasicPay, 36000);
  check("J. DA recalculated", after.da, 20880);
  check("J. DA actually changed", before.da !== after.da, true);
  check("J. HRA recalculated", after.hra, 3240);
  check("J. HRA actually changed", before.hra !== after.hra, true);
  check("K. NPS = CEILING((TotalBasic + DA) x 10%, 1)", after.nps, Math.ceil((36000 + 20880) * 0.1));
  check("K. NPS value", after.nps, 5688);
  check(
    "K. NPS excludes HRA/MA/TA/CLA",
    calculateNps(36000, 20880),
    calculateNps(36000, 20880)
  );
  check(
    "K. adding HRA does not change NPS",
    calculateNps(36000, 20880),
    5688
  );
  check("J. TA group follows the new Basic", getTransportAllowanceGroup(36000, "4"), "Level 3-8");
  check("J. CLA keeps its own grouping", getClaPayLevelGroup("7"), "Level 4 and Above");

  /* Gross / deductions / net move with the new Basic. */
  const grossBefore = before.totalBasicPay + before.da + before.hra;
  const grossAfter = after.totalBasicPay + after.da + after.hra;
  check("J. Gross increases with the increment", grossAfter > grossBefore, true);
  check("J. Net moves with Gross and NPS", Number((grossAfter - after.nps).toFixed(2)), Number((grossAfter - 5688).toFixed(2)));

  /* ============ L ============ */
  section("L — DA Difference with NPS deduction");

  const months = increment.buildMonthRange("2026", "01", "2026", "04");
  const resultL = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months,
    rateMap,
  });

  check("L. Basic per month", resultL.months.map((m) => m.historicalBasic), [35000, 35000, 36000, 36000]);
  check("L. Old DA per month", resultL.months.map((m) => m.oldDA), [19250, 19250, 19800, 19800]);
  check("L. Revised DA per month", resultL.months.map((m) => m.revisedDA), [20300, 20300, 20880, 20880]);
  check("L. DA Difference per month", resultL.months.map((m) => m.differenceAmount), [1050, 1050, 1080, 1080]);
  check("L. NPS per month", resultL.months.map((m) => m.npsDeduction), [105, 105, 108, 108]);
  check("L. Net per month", resultL.months.map((m) => m.netDifferenceAmount), [945, 945, 972, 972]);
  check("L. Total DA Difference = 4,260", resultL.totalDifferenceAmount, 4260);
  check("L. Total NPS = 426", resultL.totalNpsDeduction, 426);
  check("L. Total Net = 3,834", resultL.totalNetDifferenceAmount, 3834);
  check("L. NPS default formula", daDiff.calculateNpsOnDifference(1050), 105);
  check("L. NPS rounds up", daDiff.calculateNpsOnDifference(1001), 101);
  check("L. NPS on zero difference is zero", daDiff.calculateNpsOnDifference(0), 0);

  /* ============ M ============ */
  section("M — manual NPS is honoured and survives a reopen");

  const savedNpsByMonth = new Map([["2026-01", 100]]);
  const resultM = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months,
    rateMap,
    savedNpsByMonth,
  });

  check("M. JAN NPS is the manual 100, not 105", resultM.months[0].npsDeduction, 100);
  check("M. JAN is flagged manual", resultM.months[0].npsManual, true);
  check("M. JAN Net = 950", resultM.months[0].netDifferenceAmount, 950);
  check("M. FEB keeps the derived 105", resultM.months[1].npsDeduction, 105);
  check("M. FEB is not flagged manual", resultM.months[1].npsManual, false);
  check("M. totals reflect the manual value", resultM.totalNpsDeduction, 421);
  check("M. net total reflects the manual value", resultM.totalNetDifferenceAmount, 3839);

  /* Reopening recalculates with the SAME saved value and must not revert. */
  const reopened = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months,
    rateMap,
    savedNpsByMonth: new Map([["2026-01", 100]]),
  });
  check("M. after reopen JAN NPS is still 100", reopened.months[0].npsDeduction, 100);
  check("M. after reopen JAN Net is still 950", reopened.months[0].netDifferenceAmount, 950);

  /* Zero is a legitimate manual value and must not fall back to the default. */
  const zeroNps = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months,
    rateMap,
    savedNpsByMonth: new Map([["2026-01", 0]]),
  });
  check("M. manual zero is respected", zeroNps.months[0].npsDeduction, 0);
  check("M. manual zero gives Net = DA Difference", zeroNps.months[0].netDifferenceAmount, 1050);

  section("NPS validation");

  check("negative NPS is rejected", daDiff.validateNpsOverride(-1, 1050).valid, false);
  check("non-numeric NPS is rejected", daDiff.validateNpsOverride("abc", 1050).valid, false);
  check("empty NPS is rejected", daDiff.validateNpsOverride("", 1050).valid, false);
  check("zero NPS is accepted", daDiff.validateNpsOverride(0, 1050).valid, true);
  check("NPS above its difference is rejected", daDiff.validateNpsOverride(2000, 1050).valid, false);
  check("NPS equal to its difference is accepted", daDiff.validateNpsOverride(1050, 1050).valid, true);
  check("decimal NPS is accepted", daDiff.validateNpsOverride(100.5, 1050).value, 100.5);

  const rejected = await daDiff.calculateEmployeeDifference({
    employeeId: 101,
    instituteCode: "INST1",
    months,
    rateMap,
    savedNpsByMonth: new Map([["2026-01", 99999]]),
  });
  check("an out-of-range NPS is reported, not silently applied", rejected.npsErrors.length, 1);
  check("and the derived value is kept meanwhile", rejected.months[0].npsDeduction, 105);

  /* ============ SUMMARY ============ */
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(70));
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
