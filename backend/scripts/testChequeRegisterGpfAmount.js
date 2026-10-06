/**
 * Cheque Register GPF AMT = saved GPFSubscription + saved GPFAdvance.
 * Offline. Usage: cd backend && npm run test:cheque-register-gpf
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const { mapAggregateRow, XLSX_COLUMNS } = require("../routes/chequeRegister");

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "chequeRegister.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "pages", "ChequeRegister.jsx"),
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

function main() {
  console.log("=".repeat(72));
  console.log("Cheque Register GPF AMT = GPF Subscription + GPF Advance");
  console.log("=".repeat(72));

  check("subscription 0 + advance 0 = 0", gpfOf({ GPFSubscription: 0, GPFAdvance: 0 }), 0);
  check(
    "subscription 1000 + advance 12000 = 13000",
    gpfOf({ GPFSubscription: 1000, GPFAdvance: 12000 }),
    13000
  );

  const employees = [
    { GPFSubscription: 1000, GPFAdvance: 12000 },
    { GPFSubscription: 2500, GPFAdvance: 500 },
    { GPFSubscription: 0, GPFAdvance: 0 },
  ];
  const summed = employees.reduce(
    (acc, row) => ({
      GPFSubscription: acc.GPFSubscription + row.GPFSubscription,
      GPFAdvance: acc.GPFAdvance + row.GPFAdvance,
    }),
    { GPFSubscription: 0, GPFAdvance: 0 }
  );
  const multi = mapAggregateRow(billRow({ ...summed, EmpCount: employees.length }));
  check(
    "multiple employees: both components are summed",
    multi.gpfAmount,
    16000
  );
  check("multiple employees: headcount is the included employees", multi.emp, 3);

  check(
    "a row with no advance keeps the subscription",
    gpfOf({ GPFSubscription: 2500 }),
    2500
  );

  const sample = mapAggregateRow(
    billRow({ GPFSubscription: 1000, GPFAdvance: 12000, NPS: 40, IncomeTax: 5, ProfessionalTax: 7, OtherDeduction: 3, NetSalary: 100 })
  );
  check("NPS is unchanged", sample.nps, 40);
  check("Income Tax is unchanged", sample.incomeTax, 5);
  check("Professional Tax is unchanged", sample.professionalTax, 7);
  check("Other deductions are unchanged", sample.otherDeductions, 3);
  check("Net Amount is unchanged", sample.netAmount, 100);
  check("Cheque Amount stays Net + IT + PT", sample.chequeAmount, 112);

  const xlsxGpf = XLSX_COLUMNS.find((c) => c.key === "gpfAmount");
  check("Excel writes the same gpfAmount field", xlsxGpf && xlsxGpf.key, "gpfAmount");
  check(
    "Excel numeric cell equals the screen value",
    Number(sample.gpfAmount || 0),
    sample.gpfAmount
  );
  check(
    "the screen column is the same gpfAmount field",
    /\{ key: "gpfAmount", label: "GPF AMT" \}/.test(pageSrc),
    true
  );
  check(
    "Excel export uses the same report builder",
    /const data = await buildChequeRegisterReport\(req\.query\)/.test(routeSrc),
    true
  );

  const subSums = routeSrc.match(/ISNULL\(SUM\(d\.GPFSubscription\), 0\) AS GPFSubscription/g) || [];
  const advSums = routeSrc.match(/ISNULL\(SUM\(d\.GPFAdvance\), 0\) AS GPFAdvance/g) || [];
  check("both salary instance queries sum GPFSubscription", subSums.length, 2);
  check("both salary instance queries sum GPFAdvance", advSums.length, 2);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  if (failures.length) failures.forEach((f) => console.log("  - " + f));
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main();
