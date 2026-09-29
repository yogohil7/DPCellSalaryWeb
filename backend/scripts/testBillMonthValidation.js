/**
 * BUSINESS RULE (2026-09-24): Bill Month and Salary Month are independent
 * and both persisted (migration 45, dbo.SalaryBillInstituteWorkflow.BillMonth),
 * EXCEPT Bill Month must never be LATER than Salary Month. Salary Month
 * alone still determines the SalaryBillCodes master row (and therefore the
 * employee data used) — Bill Month never changes bill resolution and never
 * creates a "-BM-" variant.
 *
 * Tests resolveSalaryEntryBill()'s new validation directly, offline (the
 * database layer is stubbed — no SQL Server needed).
 *
 * Usage:  cd backend && node scripts/testBillMonthValidation.js
 */

const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */

const AUG = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
};
const SEP = {
  BillCodeId: 1020, BillCode: "SEP-2026", BillMonth: "September",
  SalaryMonth: "September", SalaryMonthNumber: "09", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
};
const BILLS = [AUG, SEP];
let insertCount = 0;

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");

  if (/INSERT INTO dbo\.SalaryBillCodes/i.test(text)) {
    insertCount++;
    const row = { BillCodeId: 900 + insertCount };
    BILLS.push(row);
    return Promise.resolve({ recordset: [row] });
  }

  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    if (/WHERE BillCode = \?/i.test(text)) {
      return Promise.resolve({
        recordset: BILLS.filter((b) => b.BillCode === String(values[0])),
      });
    }
    return Promise.resolve({ recordset: BILLS.slice() });
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

/* ===================== MODULE UNDER TEST ===================== */

const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

async function expectRejected(name, promise) {
  try {
    await promise;
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected rejection, but it resolved`);
  } catch (err) {
    const ok = err.status === 400 && err.code === "BILL_MONTH_AFTER_SALARY_MONTH";
    if (ok) { passed++; console.log(`  PASS  ${name}`); }
    else {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        expected status 400 / BILL_MONTH_AFTER_SALARY_MONTH`);
      console.log(`        actual status=${err.status} code=${err.code} message=${err.message}`);
    }
  }
}

async function main() {
  console.log("=".repeat(72));
  console.log("Salary Entry: Bill Month cannot be later than Salary Month");
  console.log("=".repeat(72));

  section("TEST 1 — Bill Month JUL-2026, Salary Month AUG-2026 -> VALID");
  const t1 = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "JUL-2026", salaryMonth: "AUG-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  check("1. resolves to AUG-2026 master (Salary Month decides the data)", t1.bill.BillCode, "AUG-2026");
  check("1. canonicalBillMonth is JUL-2026", t1.canonicalBillMonth, "JUL-2026");
  check("1. canonicalSalaryMonth is AUG-2026", t1.canonicalSalaryMonth, "AUG-2026");
  check("1. created is false (no new Bill Code)", t1.created, false);

  section("TEST 2 — Bill Month AUG-2026, Salary Month AUG-2026 -> VALID");
  const t2 = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "AUG-2026", salaryMonth: "AUG-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  check("2. canonicalBillMonth is AUG-2026", t2.canonicalBillMonth, "AUG-2026");

  section("TEST 3 — Bill Month SEP-2026, Salary Month AUG-2026 -> INVALID (rejected)");
  await expectRejected(
    "3. Get Data (createIfMissing:false) rejects SEP after AUG",
    resolveSalaryEntryBill({
      billCode: "AUG-2026", billMonth: "SEP-2026", salaryMonth: "AUG-2026",
      createIfMissing: false, actor: { fullName: "SYSTEM" },
    })
  );
  await expectRejected(
    "3b. Save/Submit (createIfMissing:true) also rejects SEP after AUG",
    resolveSalaryEntryBill({
      billCode: "AUG-2026", billMonth: "SEP-2026", salaryMonth: "AUG-2026",
      createIfMissing: true, actor: { fullName: "SYSTEM" },
    })
  );

  section("TEST 4 — Bill Month AUG-2026, Salary Month SEP-2026 -> VALID (earlier bill month, later salary month)");
  const t4 = await resolveSalaryEntryBill({
    billCode: "SEP-2026", billMonth: "AUG-2026", salaryMonth: "SEP-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  check("4. resolves to SEP-2026 master (loads September salary data)", t4.bill.BillCode, "SEP-2026");
  check("4. canonicalBillMonth is AUG-2026", t4.canonicalBillMonth, "AUG-2026");

  section("TEST 5 — Bill Month SEP-2026, Salary Month SEP-2026 -> VALID");
  const t5 = await resolveSalaryEntryBill({
    billCode: "SEP-2026", billMonth: "SEP-2026", salaryMonth: "SEP-2026",
    createIfMissing: false, actor: { fullName: "SYSTEM" },
  });
  check("5. canonicalBillMonth is SEP-2026", t5.canonicalBillMonth, "SEP-2026");

  section("TEST 6 — Bill Month OCT-2026, Salary Month SEP-2026 -> INVALID (rejected)");
  await expectRejected(
    "6. rejects OCT after SEP",
    resolveSalaryEntryBill({
      billCode: "SEP-2026", billMonth: "OCT-2026", salaryMonth: "SEP-2026",
      createIfMissing: false, actor: { fullName: "SYSTEM" },
    })
  );

  section("TEST 7 — no -BM- Bill Code was created by any valid or invalid case above");
  check("7. no rows were ever inserted into SalaryBillCodes", insertCount, 0);
  check("7. no -BM- code exists anywhere", BILLS.some((b) => /-BM-/i.test(b.BillCode || "")), false);
  check("7. BILLS still only has the two original masters", BILLS.length, 2);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
