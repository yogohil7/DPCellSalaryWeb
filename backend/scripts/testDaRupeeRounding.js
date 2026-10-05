/**
 * DA amount rounds to the nearest rupee, half up.
 * Other salary components keep their existing rounding.
 *
 * Usage: cd backend && npm run test:da-rupee-rounding
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

const {
  roundDaRupee,
  roundMoney,
  calculateSalaryAmounts,
  calculateNps,
} = require("../utils/salaryBasicCalc");
const { finalizeSnapshotAmounts } = require("../routes/salaryEntry");

const frontSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "utils", "salaryBasicCalc.js"),
  "utf8"
);
const frontFns = new Function(
  `${frontSrc.replace(/^export /gm, "")}
   return { roundDaRupee, roundMoney, calculateSalaryAmounts, calculateNps };`
)();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

function row(da, extra = {}) {
  return {
    employeeId: 1,
    employeeType: "REGULAR",
    basicPay: 34761,
    fixBasic: 0,
    da,
    daRate: 50,
    hra: 3128.49,
    hraRate: 9,
    ma: 1000,
    ta: 720,
    cla: 150.25,
    gpfSubscription: 500.5,
    nps: 0,
    incomeTax: 100,
    professionalTax: 200,
    otherDeduction: 0,
    pension: "GPF",
    ...extra,
  };
}

function main() {
  console.log("DA nearest-rupee rounding");
  const cases = [
    [17380.4, 17380],
    [17380.49, 17380],
    [17380.5, 17381],
    [17380.8, 17381],
    [17380, 17380],
    [0, 0],
    [-17380.49, -17380],
    [-17380.5, -17381],
    [-17380.8, -17381],
  ];
  for (const [input, expected] of cases) {
    check(`backend ${input} → ${expected}`, roundDaRupee(input), expected);
    check(`frontend ${input} → ${expected}`, frontFns.roundDaRupee(input), expected);
  }

  const halfUp = calculateSalaryAmounts({
    basic: 34761,
    fixBasic: 0,
    daPercentage: 50,
    hraPercentage: 9,
  });
  const frontHalf = frontFns.calculateSalaryAmounts({
    basic: 34761,
    fixBasic: 0,
    daPercentage: 50,
    hraPercentage: 9,
  });
  check("backend DA 17380.50 rounds up", halfUp.da, 17381);
  check("frontend DA matches backend", frontHalf.da, halfUp.da);
  check("HRA stays at paise, not nearest rupee", halfUp.hra, roundMoney((34761 * 9) / 100));
  check("frontend HRA matches backend paise", frontHalf.hra, halfUp.hra);
  check("NPS uses the rounded DA", halfUp.nps, calculateNps(34761, 17381));
  check("frontend NPS matches", frontHalf.nps, halfUp.nps);

  const justUnder = calculateSalaryAmounts({
    basic: 100,
    daPercentage: 17.49,
    hraPercentage: 10,
  });
  check(".49 calculated DA rounds down", justUnder.da, 17);
  check("HRA of that row is still 10.00 paise rounding", justUnder.hra, 10);

  const posted = finalizeSnapshotAmounts(row(17380.4), {
    pension: "GPF",
    hraForcedZero: false,
  });
  check("draft keeps posted DA rounded down", posted.row.da, 17380);
  check("HRA on the draft is not re-rounded to a rupee", posted.row.hra, 3128.49);
  check("GPF on the draft is unchanged", posted.row.gpfSubscription, 500.5);
  const gross =
    34761 + 17380 + 3128.49 + 1000 + 720 + 150.25;
  const deduction = 500.5 + 100 + 200;
  check("gross uses the rounded DA", posted.row.grossSalary, gross);
  check("net uses the rounded DA", posted.row.netSalary, gross - deduction);
  check(
    "cheque amount uses that net",
    posted.row.chequeAmount,
    Number((gross - deduction + 100 + 200).toFixed(2))
  );

  const up = finalizeSnapshotAmounts(
    row(0, { da: 0, recalcFromBasic: true, daRate: 50, pension: "NPS", nps: 1 }),
    { pension: "NPS", hraForcedZero: false }
  );
  check("basic-driven save stores the half-up DA", up.row.da, 17381);
  check("NPS on save uses the rounded DA", up.row.nps, Math.ceil((34761 + 17381) * 0.1));
  check(
    "save gross includes that DA",
    up.row.grossSalary,
    34761 + 17381 + 3128.49 + 1000 + 720 + 150.25
  );

  const entrySrc = fs.readFileSync(
    path.join(__dirname, "..", "routes", "salaryEntry.js"),
    "utf8"
  );
  check(
    "approved bills are still blocked before save",
    /assertInstituteEditable/.test(entrySrc),
    true
  );

  console.log(`\nPassed: ${passed}    Failed: ${failed}`);
  if (failed) {
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
}

main();
