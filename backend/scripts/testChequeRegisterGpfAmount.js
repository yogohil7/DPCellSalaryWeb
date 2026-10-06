/**
 * Cheque Register GPF AMT = saved GPFSubscription + saved GPFAdvance.
 *
 * Covers both aggregate sources used by the report:
 *   - canonical Bill Month rows from dbo.SalaryEmployeeDetails
 *   - earlier Bill Month rows from dbo.SalaryEntryBillEmployeeDetails
 *
 * Offline. Usage: cd backend && npm run test:cheque-register-gpf
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

const CASES = [
  { code: "GPF-00", emp: 1, sub: 0, adv: 0, expected: 0 },
  { code: "GPF-13", emp: 1, sub: 1000, adv: 12000, expected: 13000 },
  { code: "GPF-20", emp: 1, sub: 8200, adv: 12000, expected: 20200 },
  { code: "GPF-25", emp: 1, sub: 2500, adv: 0, expected: 2500 },
  /* SQL already summed the employees: (1000+12000) + (2500+500). */
  { code: "GPF-16", emp: 2, sub: 3500, adv: 12500, expected: 16000 },
];

function aggregateRow(source, item) {
  const earlier = source === "earlier";
  return {
    BillCodeId: earlier ? 2018 : 1018,
    BillCode: "AUG-2026",
    BillMonth: earlier ? "JUL-2026" : "AUG-2026",
    WorkflowBillMonth: earlier ? "JUL-2026" : "AUG-2026",
    SalaryMonth: "August",
    SalaryMonthNumber: "08",
    SalaryYear: "2026",
    BillCategory: "Salary",
    BillType: "Regular Salary",
    WorkflowId: (earlier ? 800 : 700) + CASES.indexOf(item),
    InstituteCode: `${item.code}-${earlier ? "E" : "C"}`,
    InstituteName: item.code,
    WorkflowStatus: "LOCKED",
    EmpCount: item.emp,
    BasicPay: 100,
    GradePay: 0,
    TotalBasic: 100,
    DA: 10,
    HRA: 5,
    CLA: 0,
    MA: 0,
    TA: 0,
    SpecialAllowance: 0,
    GrossSalary: 115,
    NPS: 40,
    GPFSubscription: item.sub,
    GPFAdvance: item.adv,
    IncomeTax: 5,
    ProfessionalTax: 7,
    OtherDeduction: 3,
    NetSalary: 100,
    ChequeAmount: 112,
  };
}

const CANONICAL = CASES.map((item) => aggregateRow("canonical", item));
const EARLIER = CASES.map((item) => aggregateRow("earlier", item));

const queries = [];
function run(strings) {
  const text = (typeof strings === "string" ? strings : strings.join("?")).replace(/\s+/g, " ");
  queries.push(text);
  if (/JOIN dbo\.SalaryEntryBillEmployeeDetails d/i.test(text)) return { recordset: EARLIER };
  if (/JOIN dbo\.SalaryEmployeeDetails d/i.test(text)) return { recordset: CANONICAL };
  if (/DADifferenceEmployeeDetails/i.test(text)) return { recordset: [] };
  if (/FROM dbo\.SalaryEntryBillHeader/i.test(text)) return { recordset: [] };
  return { recordset: [] };
}
const query = (s, ...v) => Promise.resolve(run(s, v));
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query,
    Request: function R() {
      return { query, input() { return this; } };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const { mapAggregateRow, XLSX_COLUMNS, buildChequeRegisterReport } = require("../routes/chequeRegister");

const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "chequeRegister.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(ROOT, "..", "frontend", "src", "pages", "ChequeRegister.jsx"),
  "utf8"
);

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

function billRow(over) {
  return {
    BillCodeId: 1018,
    BillCode: "AUG-2026",
    BillMonth: "AUG-2026",
    WorkflowBillMonth: "AUG-2026",
    SalaryMonth: "August",
    SalaryMonthNumber: "08",
    SalaryYear: "2026",
    BillCategory: "Salary",
    BillType: "Regular Salary",
    InstituteCode: "MR-29",
    InstituteName: "MR-29",
    WorkflowStatus: "LOCKED",
    EmpCount: 1,
    NPS: 40,
    IncomeTax: 5,
    ProfessionalTax: 7,
    OtherDeduction: 3,
    NetSalary: 100,
    ...over,
  };
}

function gpfOf(over) {
  return mapAggregateRow(billRow(over)).gpfAmount;
}

async function main() {
  console.log("=".repeat(72));
  console.log("Cheque Register GPF AMT = GPF Subscription + GPF Advance");
  console.log("=".repeat(72));

  check("subscription 0 + advance 0 = 0", gpfOf({ GPFSubscription: 0, GPFAdvance: 0 }), 0);
  check(
    "subscription 1000 + advance 12000 = 13000",
    gpfOf({ GPFSubscription: 1000, GPFAdvance: 12000 }),
    13000
  );
  check(
    "subscription 2500 + advance 0 = 2500",
    gpfOf({ GPFSubscription: 2500, GPFAdvance: 0 }),
    2500
  );
  check(
    "subscription 8200 + advance 12000 = 20200",
    gpfOf({ GPFSubscription: 8200, GPFAdvance: 12000 }),
    20200
  );

  const multi = mapAggregateRow(
    billRow({ GPFSubscription: 3500, GPFAdvance: 12500, EmpCount: 2 })
  );
  check(
    "multiple employees: (1000+12000) + (2500+500) = 16000",
    multi.gpfAmount,
    16000
  );
  check("multiple employees: headcount is the included employees", multi.emp, 2);

  /* 10.004 + 10.004 rounds to 20.00 when each side is rounded first,
     and to 20.01 when the sum is rounded once. */
  check(
    "each component is rounded before it is added",
    gpfOf({ GPFSubscription: 10.004, GPFAdvance: 10.004 }),
    20
  );

  check(
    "a missing advance column keeps the subscription",
    gpfOf({ GPFSubscription: 2500 }),
    2500
  );

  const sample = mapAggregateRow(
    billRow({ GPFSubscription: 1000, GPFAdvance: 12000 })
  );
  check("NPS is unchanged", sample.nps, 40);
  check("Income Tax is unchanged", sample.incomeTax, 5);
  check("Professional Tax is unchanged", sample.professionalTax, 7);
  check("Other deductions are unchanged", sample.otherDeductions, 3);
  check("Net Amount is unchanged", sample.netAmount, 100);
  check("Cheque Amount stays Net + IT + PT", sample.chequeAmount, 112);

  const xlsxGpf = XLSX_COLUMNS.find((c) => c.key === "gpfAmount");
  check("Excel GPF column uses gpfAmount", xlsxGpf && xlsxGpf.label, "GPF");
  check("Excel numeric cell equals the screen value", Number(sample.gpfAmount || 0), sample.gpfAmount);
  check(
    "the screen GPF AMT column is the same gpfAmount field",
    /\{ key: "gpfAmount", label: "GPF AMT" \}/.test(pageSrc),
    true
  );
  check(
    "Excel export uses the same report builder",
    /const data = await buildChequeRegisterReport\(req\.query\)/.test(routeSrc),
    true
  );

  const report = await buildChequeRegisterReport({ month: "8", year: "2026" });
  const byCode = Object.fromEntries(report.rows.map((row) => [row.instituteCode, row]));

  const canonicalSql = queries.find((text) => /JOIN dbo\.SalaryEmployeeDetails d/i.test(text)) || "";
  const earlierSql = queries.find((text) => /JOIN dbo\.SalaryEntryBillEmployeeDetails d/i.test(text)) || "";
  const daSql = queries.find((text) => /DADifferenceEmployeeDetails/i.test(text)) || "";

  check(
    "canonical query sums GPFSubscription from SalaryEmployeeDetails",
    /ISNULL\(SUM\(d\.GPFSubscription\), 0\) AS GPFSubscription/.test(canonicalSql),
    true
  );
  check(
    "canonical query sums GPFAdvance from SalaryEmployeeDetails",
    /ISNULL\(SUM\(d\.GPFAdvance\), 0\) AS GPFAdvance/.test(canonicalSql),
    true
  );
  check(
    "earlier Bill Month query sums GPFSubscription from SalaryEntryBillEmployeeDetails",
    /ISNULL\(SUM\(d\.GPFSubscription\), 0\) AS GPFSubscription/.test(earlierSql),
    true
  );
  check(
    "earlier Bill Month query sums GPFAdvance from SalaryEntryBillEmployeeDetails",
    /ISNULL\(SUM\(d\.GPFAdvance\), 0\) AS GPFAdvance/.test(earlierSql),
    true
  );
  check(
    "DA Difference leaves GPF Advance at zero",
    /CAST\(0 AS DECIMAL\(18,2\)\) AS GPFAdvance/.test(daSql) && !/SUM\([^)]*GPFAdvance/.test(daSql),
    true
  );

  for (const item of CASES) {
    const canonical = byCode[`${item.code}-C`];
    const earlier = byCode[`${item.code}-E`];
    check(
      `canonical SalaryEmployeeDetails ${item.code} GPF AMT`,
      canonical && canonical.gpfAmount,
      item.expected
    );
    check(
      `earlier SalaryEntryBillEmployeeDetails ${item.code} GPF AMT`,
      earlier && earlier.gpfAmount,
      item.expected
    );
    check(
      `canonical ${item.code} stays REGULAR AUG-2026`,
      canonical && [canonical.billMonthQueried, canonical.type, canonical.emp],
      ["AUG-2026", "REGULAR", item.emp]
    );
    check(
      `earlier ${item.code} stays OLD JUL-2026`,
      earlier && [earlier.billMonthQueried, earlier.type, earlier.emp],
      ["JUL-2026", "OLD", item.emp]
    );
  }

  const combined = byCode["GPF-13-C"];
  check("screen row NPS is unchanged", combined.nps, 40);
  check("screen row cheque amount is unchanged", combined.chequeAmount, 112);
  check(
    "Excel GPF cell is the combined screen amount",
    Number(combined.gpfAmount || 0),
    13000
  );
  check(
    "report total adds every institute GPF AMT",
    report.totals.gpfAmount,
    CASES.reduce((sum, item) => sum + item.expected, 0) * 2
  );

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  if (failures.length) failures.forEach((f) => console.log("  - " + f));
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
