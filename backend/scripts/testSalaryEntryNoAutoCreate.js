/**
 * DECISION (2026-09-23): Salary Entry never inserts into
 * dbo.SalaryBillCodes, and — as of this revision — never even SEARCHES
 * for a separate Bill-Month variant for the general flow either. Opening
 * Salary Entry for Salary Month AUG-2026 with Bill Month JUL-2026 (via
 * plain billCode "AUG-2026") always resolves directly to the AUG-2026
 * master row: no lookup miss, no "not found" message, no new row — Bill
 * Month is informational only. Salary Bill Code Master
 * (routes/salaryBillCodes.js) remains the only place a new Bill Code can
 * ever be created. A pre-existing Bill-Month variant (created before this
 * decision) is left alone and stays reachable only by requesting its
 * exact code directly (e.g. Returned Bills reopen) — never by the general
 * Salary-Month-code + Bill Month lookup.
 *
 * Runs offline: the database layer is stubbed, so no SQL Server is needed.
 *
 * Usage:  cd backend && node scripts/testSalaryEntryNoAutoCreate.js
 */

const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */

const MASTER = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
};

const BILLS = [MASTER];
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

async function main() {
  console.log("=".repeat(72));
  console.log("Salary Entry: always resolves to the master bill, never auto-creates (AUG-2026 / JUL-2026)");
  console.log("=".repeat(72));

  section("TEST 1 — mismatched Bill Month resolves straight to the master, no insert, no error");

  const before = BILLS.length;
  const resolved = await resolveSalaryEntryBill({
    billCode: "AUG-2026",
    billMonth: "JUL-2026",
    salaryMonth: "AUG-2026",
    createIfMissing: false,
    actor: { fullName: "SYSTEM" },
  });
  check("1. resolves to the master bill", resolved.bill.BillCode, "AUG-2026");
  check("1. master BillCodeId", resolved.bill.BillCodeId, 1018);
  check("1. created is false", resolved.created, false);
  check("1. NOTHING was inserted", BILLS.length, before);
  check("1. no -BM- row exists anywhere", BILLS.some((b) => /-BM-/i.test(b.BillCode || "")), false);
  check("1. Bill Month is reported back for display only", resolved.canonicalBillMonth, "JUL-2026");

  section("TEST 2 — createIfMissing:true (Save Draft/Submit path) still never inserts for this flow");

  const beforeSave = BILLS.length;
  const saved = await resolveSalaryEntryBill({
    billCode: "AUG-2026",
    billMonth: "JUL-2026",
    salaryMonth: "AUG-2026",
    createIfMissing: true,
    actor: { fullName: "SYSTEM" },
  });
  check("2. still resolves to the master bill", saved.bill.BillCode, "AUG-2026");
  check("2. created is false", saved.created, false);
  check("2. still no new row", BILLS.length, beforeSave);

  section("TEST 3 — normal same-month bill (AUG-2026) still resolves correctly");

  const normal = await resolveSalaryEntryBill({
    billCode: "AUG-2026",
    billMonth: "AUG-2026",
    salaryMonth: "AUG-2026",
    createIfMissing: false,
    actor: { fullName: "SYSTEM" },
  });
  check("3. resolves to the master bill", normal.bill.BillCode, "AUG-2026");
  check("3. created is false", normal.created, false);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
