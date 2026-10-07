/**
 * FIX employee salary: pay only Fix Basic.
 *
 * Regular allowances (DA, HRA, TA, CLA, Medical, Special, Washing, NPPA,
 * other earnings) are zero for an editable FIX row. REGULAR rows are
 * unchanged. Approved/Locked snapshots are not rewritten.
 *
 * Offline — the database layer is stubbed. No SQL Server needed.
 * Usage: cd backend && node scripts/testFixEmployeeSalary.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const { pathToFileURL } = require("url");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return {
        query: () => Promise.resolve({ recordset: [] }),
        input() {
          return this;
        },
      };
    },
  },
  connectDB: async () => true,
};

const { calculateSalaryAmounts, calculateNps } = require("../utils/salaryBasicCalc");
const { applyFixEmployeeEarnings, zeroFixEarningComponentLines } = require("../utils/fixEmployeeSalary");
const { mapCalcToGridRow } = require("../routes/salaryCalculate");
const salaryEntry = require("../routes/salaryEntry");
const { finalizeSnapshotAmounts, mapSavedDetailToGridRow, shouldApplyFixPayRule } =
  salaryEntry;

const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"),
  "utf8"
);
const entrySrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "salaryEntry.js"),
  "utf8"
);

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
    failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function assertConsistent(name, row) {
  const gross = round2(
    row.totalBasic +
      row.da +
      row.hra +
      row.ma +
      row.ta +
      row.cla +
      row.specialAllowance +
      row.washingAllowance +
      row.otherEarnings +
      row.nppa
  );
  const deduction = round2(
    row.gpfSubscription +
      row.gpfAdvance +
      row.nps +
      row.incomeTax +
      row.professionalTax +
      row.otherDeduction
  );
  check(`${name}: gross = earnings`, row.grossSalary, gross);
  check(`${name}: grossAmount matches`, row.grossAmount, gross);
  check(`${name}: total deduction = parts`, row.totalDeduction, deduction);
  check(`${name}: net = gross - deduction`, row.netSalary, round2(gross - deduction));
  check(
    `${name}: cheque = net + income tax + professional tax`,
    row.chequeAmount,
    round2(row.netSalary + row.incomeTax + row.professionalTax)
  );
}

const ALLOWANCE_KEYS = [
  "da",
  "hra",
  "ma",
  "ta",
  "cla",
  "specialAllowance",
  "washingAllowance",
  "otherEarnings",
  "nppa",
];

function fixInput(over = {}) {
  return {
    employeeId: 4060,
    employeeName: "Fix Employee",
    designation: "Peon",
    employeeType: "FIX",
    basicPay: 9999,
    fixBasic: 40600,
    gradePay: 40600,
    da: 21518,
    daRate: 53,
    hra: 4060,
    hraRate: 10,
    ma: 1000,
    ta: 3600,
    cla: 480,
    specialAllowance: 250,
    washingAllowance: 75,
    otherEarnings: 40,
    nppa: 15,
    gpfSubscription: 2500,
    gpfAdvance: 400,
    nps: 9999,
    incomeTax: 1000,
    professionalTax: 200,
    otherDeduction: 150,
    recalcFromBasic: true,
    basicDriven: true,
    ...over,
  };
}

function savedDetailFrom(row, over = {}) {
  return {
    Id: 91,
    EmployeeId: row.employeeId,
    EmployeeName: row.employeeName,
    Designation: row.designation,
    EmployeeType: row.employeeType,
    BasicPay: row.basicPay,
    GradePay: row.fixBasic,
    DA: row.da,
    HRA: row.hra,
    MA: row.ma,
    TA: row.ta,
    CLA: row.cla,
    SpecialAllowance: row.specialAllowance,
    WashingAllowance: row.washingAllowance,
    OtherEarnings: row.otherEarnings,
    NPPA: row.nppa,
    GPFSubscription: row.gpfSubscription,
    GPFAdvance: row.gpfAdvance,
    NPS: row.nps,
    NPSManual: row.npsManual ? 1 : 0,
    IncomeTax: row.incomeTax,
    ProfessionalTax: row.professionalTax,
    OtherDeduction: row.otherDeduction,
    DAPercentage: row.daRate,
    HRAPercentage: row.hraRate,
    PensionType: row.pension || "GPF",
    HraForcedZero: 0,
    TAManual: 0,
    ...over,
  };
}

function calcShell(over = {}) {
  return {
    employee: {
      employeeId: 4060,
      employeeCode: "F-1",
      employeeName: "Fix Employee",
      designation: "Peon",
      employeeType: "FIX",
      gpfNps: "GPF",
      sectionId: 1,
      sectionName: "HQ",
      instituteId: 5,
      instituteCode: "OGE-05",
      cityClassName: "X",
    },
    payRevision: { payRevisionId: null, revisionName: "", revisionCode: "" },
    level: null,
    cellNo: null,
    payMatrixId: null,
    basicPay: 0,
    daRate: 53,
    hraRate: 10,
    daMasterId: 3,
    hraMasterId: 4,
    payrollConfig: { hraForcedZero: false },
    earnings: {
      gradePay: 0,
      fixBasic: 0,
      ma: 1000,
      ta: 3600,
      cla: 480,
      nppa: 15,
      otherEarnings: 40,
      washingAllowance: 75,
      specialAllowance: 250,
    },
    deductions: {
      gpfSubscription: 2500,
      gpfAdvance: 400,
      incomeTax: 1000,
      professionalTax: 200,
      otherDeduction: 150,
    },
    gpfNpsRetirementStop: false,
    warnings: [],
    ...over,
  };
}

section("1. FIX employee, Fix Basic 40600 — allowances are zero");
{
  const row = finalizeSnapshotAmounts(fixInput(), {
    pension: "GPF",
    hraForcedZero: false,
  }).row;
  check("type unchanged", row.employeeType, "FIX");
  check("Fix Basic unchanged", row.fixBasic, 40600);
  check("grade pay is Fix Basic", row.gradePay, 40600);
  check("basic pay is 0", row.basicPay, 0);
  check("total basic is Fix Basic", row.totalBasic, 40600);
  for (const key of ALLOWANCE_KEYS) check(`${key} is 0`, row[key], 0);
  check("DA rate cleared so reload cannot rebuild DA", row.daRate, 0);
  check("HRA rate cleared", row.hraRate, 0);
  check("GPF subscription kept (existing posted rule)", row.gpfSubscription, 2500);
  check("GPF advance kept", row.gpfAdvance, 400);
  check("NPS stays 0 for a GPF employee", row.nps, 0);
  assertConsistent("40600 GPF", row);
}

section("2. FIX employee with a different Fix Basic");
{
  const row = finalizeSnapshotAmounts(fixInput({ fixBasic: 18500, gradePay: 18500 }), {
    pension: "NPS",
    hraForcedZero: false,
  }).row;
  check("Fix Basic 18500 kept", row.fixBasic, 18500);
  check("total basic 18500", row.totalBasic, 18500);
  for (const key of ALLOWANCE_KEYS) check(`18500 ${key} is 0`, row[key], 0);
  check("automatic NPS is 10% of Fix Basic only", row.nps, calculateNps(18500, 0));
  check("NPS employee has no GPF subscription", row.gpfSubscription, 0);
  check("NPS employee has no GPF advance", row.gpfAdvance, 0);
  assertConsistent("18500 NPS", row);
}

section("3. REGULAR employee calculations stay unchanged");
{
  const regular = {
    employeeId: 3001,
    employeeName: "Regular Employee",
    designation: "Clerk",
    employeeType: "REGULAR",
    basicPay: 30000,
    fixBasic: 0,
    da: 1,
    daRate: 50,
    hra: 1,
    hraRate: 10,
    ma: 500,
    ta: 3600,
    cla: 480,
    specialAllowance: 100,
    washingAllowance: 50,
    otherEarnings: 20,
    nppa: 0,
    gpfSubscription: 2000,
    gpfAdvance: 100,
    nps: 0,
    incomeTax: 500,
    professionalTax: 200,
    otherDeduction: 0,
    recalcFromBasic: true,
  };
  const sameObject = applyFixEmployeeEarnings(regular);
  check("REGULAR helper returns the same object", sameObject === regular, true);
  const amounts = calculateSalaryAmounts({
    basic: 30000,
    fixBasic: 0,
    daPercentage: 50,
    hraPercentage: 10,
  });
  check("REGULAR DA is still 50% of basic", amounts.da, 15000);
  check("REGULAR HRA is still 10% of basic", amounts.hra, 3000);
  const row = finalizeSnapshotAmounts(regular, {
    pension: "GPF",
    hraForcedZero: false,
  }).row;
  check("REGULAR basic kept", row.basicPay, 30000);
  check("REGULAR total basic", row.totalBasic, 30000);
  check("REGULAR DA recomputed from rate", row.da, 15000);
  check("REGULAR HRA recomputed from rate", row.hra, 3000);
  check("REGULAR MA kept", row.ma, 500);
  check("REGULAR TA kept", row.ta, 3600);
  check("REGULAR CLA kept", row.cla, 480);
  check("REGULAR special kept", row.specialAllowance, 100);
  check("REGULAR washing kept", row.washingAllowance, 50);
  check("REGULAR other earnings kept", row.otherEarnings, 20);
  check("REGULAR GPF kept", row.gpfSubscription, 2000);
  check("REGULAR GPF advance kept", row.gpfAdvance, 100);
  assertConsistent("REGULAR", row);
}

section("4. FIX draft save and reload");
{
  const saved = finalizeSnapshotAmounts(
    fixInput({ fromSnapshot: false }),
    { pension: "GPF", hraForcedZero: false }
  ).row;
  const reloaded = mapSavedDetailToGridRow(
    savedDetailFrom(saved, { DA: 21518, HRA: 4060, MA: 1000, TA: 3600, CLA: 480 }),
    { applyFixPayRule: shouldApplyFixPayRule("DRAFT") }
  );
  check("draft reload still FIX", reloaded.employeeType, "FIX");
  check("draft reload keeps Fix Basic", reloaded.fixBasic, 40600);
  for (const key of ALLOWANCE_KEYS) check(`draft reload ${key} is 0`, reloaded[key], 0);
  check("DRAFT applies the FIX rule", shouldApplyFixPayRule("DRAFT"), true);
  check("RETURNED applies the FIX rule", shouldApplyFixPayRule("RETURNED"), true);
  assertConsistent("draft reload", reloaded);
}

section("5. FIX submit uses the same corrected snapshot");
{
  check(
    "save draft and submit share upsertEmployeeSalary",
    entrySrc.includes("const saved = await upsertEmployeeSalary("),
    true
  );
  const submitted = finalizeSnapshotAmounts(fixInput(), {
    pension: "GPF",
    hraForcedZero: false,
  }).row;
  check("submitted DA is 0", submitted.da, 0);
  check("submitted HRA is 0", submitted.hra, 0);
  check("submitted MA is 0", submitted.ma, 0);
  check("submitted TA is 0", submitted.ta, 0);
  check("submitted CLA is 0", submitted.cla, 0);
  check("submitted gross is Fix Basic", submitted.grossSalary, 40600);
  check("submitted type unchanged", submitted.employeeType, "FIX");
  check("submitted Fix Basic unchanged", submitted.fixBasic, 40600);
  assertConsistent("submit", submitted);
}

section("6. Grid mapping ignores posted regular allowances for FIX");
{
  const row = mapCalcToGridRow(calcShell(), {
    manual: {
      fixBasic: 40600,
      da: 21518,
      daRate: 53,
      hra: 4060,
      hraRate: 10,
      ma: 1000,
      ta: 3600,
      cla: 480,
      specialAllowance: 250,
      washingAllowance: 75,
      otherEarnings: 40,
      nppa: 15,
      basicPay: 12000,
    },
  });
  check("mapped basic is 0", row.basicPay, 0);
  check("mapped Fix Basic kept", row.fixBasic, 40600);
  for (const key of ALLOWANCE_KEYS) check(`mapped ${key} is 0`, row[key], 0);
  check("mapped gross is Fix Basic", row.grossSalary, 40600);
  assertConsistent("mapped FIX", row);

  const lines = [
    { componentCode: "DA", isEarning: true, amount: 21518, rate: 53 },
    { componentCode: "HRA", isEarning: true, amount: 4060, rate: 10 },
    { componentCode: "MEDICAL", isEarning: true, amount: 1000, rate: null },
    { componentCode: "GPF", isEarning: false, isDeduction: true, amount: 2500, rate: 6 },
  ];
  zeroFixEarningComponentLines(lines, "FIX");
  check("component DA amount zeroed", lines[0].amount, 0);
  check("component DA rate zeroed", lines[0].rate, 0);
  check("component HRA amount zeroed", lines[1].amount, 0);
  check("component medical zeroed", lines[2].amount, 0);
  check("GPF component left to existing deduction rules", lines[3].amount, 2500);
}

section("7. Retirement GPF/NPS rules are unchanged");
{
  const fixStopped = finalizeSnapshotAmounts(fixInput(), {
    pension: "NPS",
    hraForcedZero: false,
    retirementStop: true,
  }).row;
  check("retirement stop still zeroes FIX NPS", fixStopped.nps, 0);
  check("retirement stop does not invent GPF for NPS", fixStopped.gpfSubscription, 0);
  check("FIX allowances still zero while NPS is stopped", fixStopped.da, 0);

  const fixOpen = finalizeSnapshotAmounts(fixInput(), {
    pension: "NPS",
    hraForcedZero: false,
    retirementStop: false,
  }).row;
  check("outside the window, FIX NPS is 10% of Fix Basic", fixOpen.nps, 4060);

  const gpfStopped = finalizeSnapshotAmounts(
    {
      employeeId: 3001,
      employeeType: "REGULAR",
      basicPay: 40000,
      fixBasic: 0,
      da: 22000,
      hra: 3600,
      ma: 0,
      ta: 0,
      cla: 0,
      specialAllowance: 0,
      washingAllowance: 0,
      otherEarnings: 0,
      nppa: 0,
      gpfSubscription: 5000,
      gpfAdvance: 700,
      nps: 0,
      incomeTax: 100,
      professionalTax: 200,
      otherDeduction: 50,
    },
    { pension: "GPF", hraForcedZero: false, retirementStop: true }
  ).row;
  check("REGULAR retirement still zeroes GPF subscription", gpfStopped.gpfSubscription, 0);
  check("REGULAR retirement still keeps GPF advance", gpfStopped.gpfAdvance, 700);
  check("REGULAR retirement still keeps DA", gpfStopped.da, 22000);
  check("REGULAR retirement does not invent NPS", gpfStopped.nps, 0);

  const manual = finalizeSnapshotAmounts(
    fixInput({
      nps: 1234,
      npsManual: true,
      fromSnapshot: true,
      recalcFromBasic: false,
      basicDriven: false,
    }),
    { pension: "NPS", hraForcedZero: false, retirementStop: false }
  ).row;
  check("manual NPS is kept when retirement does not apply", manual.nps, 1234);
  const manualStopped = finalizeSnapshotAmounts(
    fixInput({
      nps: 1234,
      npsManual: true,
      fromSnapshot: true,
      recalcFromBasic: false,
      basicDriven: false,
    }),
    { pension: "NPS", hraForcedZero: false, retirementStop: true }
  ).row;
  check("retirement stop still beats a manual NPS", manualStopped.nps, 0);
}

section("8. Approved/Locked history is not modified");
{
  check("APPROVED does not apply the FIX rewrite", shouldApplyFixPayRule("APPROVED"), false);
  check("LOCKED does not apply the FIX rewrite", shouldApplyFixPayRule("LOCKED"), false);
  check("SUBMITTED is not rewritten on reload", shouldApplyFixPayRule("SUBMITTED"), false);
  const historical = mapSavedDetailToGridRow(
    savedDetailFrom({
      employeeId: 4060,
      employeeName: "Historical Fix",
      designation: "Peon",
      employeeType: "FIX",
      basicPay: 0,
      fixBasic: 40600,
      da: 21518,
      hra: 4060,
      ma: 1000,
      ta: 3600,
      cla: 480,
      specialAllowance: 250,
      washingAllowance: 75,
      otherEarnings: 40,
      nppa: 15,
      gpfSubscription: 2500,
      gpfAdvance: 400,
      nps: 0,
      npsManual: false,
      incomeTax: 1000,
      professionalTax: 200,
      otherDeduction: 150,
      daRate: 53,
      hraRate: 10,
      pension: "GPF",
    })
  );
  check("approved reload keeps stored DA", historical.da, 21518);
  check("approved reload keeps stored HRA", historical.hra, 4060);
  check("approved reload keeps stored MA", historical.ma, 1000);
  check("approved reload keeps stored TA", historical.ta, 3600);
  check("approved reload keeps Fix Basic", historical.fixBasic, 40600);
  check("approved reload keeps type", historical.employeeType, "FIX");
  const explicit = finalizeSnapshotAmounts(
    fixInput({ da: 111, recalcFromBasic: false, basicDriven: false }),
    { pension: "GPF", hraForcedZero: false, applyFixPayRule: false }
  ).row;
  check("explicit historical finalize keeps stored DA", explicit.da, 111);
  check("explicit historical finalize keeps stored HRA", explicit.hra, 4060);
  check("no bulk historical UPDATE was added", /UPDATE\s+dbo\.SalaryEmployeeDetails[\s\S]{0,200}SET[\s\S]{0,80}DA\s*=\s*0/i.test(entrySrc), false);
}

section("Frontend cannot restore FIX allowances while editing");
{
  check("grid preserves stored allowances only when read-only", pageSrc.includes("preserveStoredAllowances: salaryReadOnly"), true);
  check("allowance edits are ignored for FIX", pageSrc.includes("FIX_INAPPLICABLE_EARNING_FIELDS.includes(field)"), true);
  check("TA refresh is skipped for FIX", pageSrc.includes("isFixEmployeeType(edited?.employeeType)"), true);
}

(async () => {
  const frontend = await import(
    pathToFileURL(
      path.join(__dirname, "..", "..", "frontend", "src", "utils", "fixEmployeeSalary.js")
    ).href
  );
  const fixed = frontend.applyFixEmployeeEarnings({
    employeeType: "FIX",
    basicPay: 10,
    fixBasic: 40600,
    da: 5,
    hra: 5,
    ma: 5,
    ta: 5,
    cla: 5,
    specialAllowance: 5,
    washingAllowance: 5,
    otherEarnings: 5,
    nppa: 5,
  });
  check("frontend helper zeroes FIX allowances", fixed.da, 0);
  check("frontend helper keeps Fix Basic", fixed.fixBasic, 40600);
  const regular = { employeeType: "REGULAR", da: 15000 };
  check(
    "frontend helper leaves REGULAR rows alone",
    frontend.applyFixEmployeeEarnings(regular) === regular,
    true
  );
  const preserved = frontend.applyFixEmployeeEarnings(
    { employeeType: "FIX", da: 21518, fixBasic: 40600 },
    { preserve: true }
  );
  check("frontend helper can preserve a historical DA", preserved.da, 21518);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(failures.join("\n"));
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
