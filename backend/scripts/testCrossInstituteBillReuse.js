/**
 * DECISION (2026-09-23): Salary Entry no longer searches for or creates a
 * Bill-Month variant (e.g. AUG-2026-BM-JUL) at all. Any institute
 * resolving Salary Month AUG-2026 / Bill Month JUL-2026 through the plain
 * "AUG-2026" bill code now resolves directly to the AUG-2026 master row,
 * regardless of Bill Month and regardless of whether a Bill-Month variant
 * already exists from before this change. This test was originally about
 * a second institute (DDRS-16) reusing a first institute's (DDRS-10)
 * Bill-Month-variant row rather than duplicating it; that mechanism has
 * been retired for the general flow, so this now proves the CURRENT
 * behavior: both institutes resolve to the SAME master BillCodeId, no
 * SalaryBillCodes row is ever inserted by this path, and a pre-existing
 * variant row from before this change is left untouched (not deleted,
 * just no longer used by this general lookup).
 *
 * Runs offline: the database layer is stubbed, so no SQL Server is needed.
 *
 * Usage:  cd backend && node scripts/testCrossInstituteBillReuse.js
 */

const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */

const MASTER = {
  BillCodeId: 500, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
};

/* Pre-existing variant from BEFORE this decision (e.g. BillCodeId 1019 in
   production) — must be left alone, but no longer used by the general
   Salary-Month-code lookup. */
const OLD_VARIANT = {
  BillCodeId: 501, BillCode: "AUG-2026-BM-JUL", BillMonth: "JUL-2026",
  SalaryMonth: "AUG-2026", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "OPEN", IsArchived: 0,
  Description: "Auto-created for Bill Month JUL-2026 / Salary Month AUG-2026",
};

const BILLS = [MASTER, OLD_VARIANT];
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
  console.log("Cross-institute Bill Month resolution (DDRS-10 / DDRS-16) — no variant");
  console.log("=".repeat(72));

  /* ---------------- TEST 1 ---------------- */
  section("TEST 1 — DDRS-10 resolves AUG-2026/JUL-2026 to the MASTER bill");

  const before = BILLS.length;
  const ddrs10 = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "JUL-2026", salaryMonth: "AUG-2026",
    createIfMissing: true, actor: { fullName: "DDRS-10-USER" },
  });
  check("1. resolves to the master AUG-2026 bill", ddrs10.bill.BillCode, "AUG-2026");
  check("1. master BillCodeId", ddrs10.bill.BillCodeId, 500);
  check("1. no new row created", ddrs10.created, false);
  check("1. BILLS table did not grow", BILLS.length, before);

  /* ---------------- TEST 2 ---------------- */
  section("TEST 2 — DDRS-16 with the same period resolves to the SAME master bill");

  const beforeCount = BILLS.length;
  const ddrs16 = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "JUL-2026", salaryMonth: "AUG-2026",
    createIfMissing: true, actor: { fullName: "DDRS-16-USER" },
  });
  check("2. DDRS-16 resolves to the SAME master bill as DDRS-10", ddrs16.bill.BillCode, "AUG-2026");
  check("2. SAME BillCodeId as DDRS-10's resolution", ddrs16.bill.BillCodeId, ddrs10.bill.BillCodeId);
  check("2. no row was inserted", ddrs16.created, false);
  check("2. BILLS table still did not grow", BILLS.length, beforeCount);

  /* ---------------- TEST 3 ---------------- */
  section("TEST 3 — a genuinely different Bill Month still resolves to the SAME master, no new row");

  const beforeCount3 = BILLS.length;
  const otherMonth = await resolveSalaryEntryBill({
    billCode: "AUG-2026", billMonth: "JUN-2026", salaryMonth: "AUG-2026",
    createIfMissing: true, actor: { fullName: "DDRS-16-USER" },
  });
  check("3. still resolves to the master, not a new variant", otherMonth.bill.BillCode, "AUG-2026");
  check("3. no row created for this Bill Month either", otherMonth.created, false);
  check("3. BILLS table did not grow", BILLS.length, beforeCount3);

  /* ---------------- TEST 4 ---------------- */
  section("TEST 4 — the pre-existing AUG-2026-BM-JUL row is left untouched, not deleted or reused");

  check("4. old variant row still exists, unchanged",
    BILLS.find((b) => b.BillCodeId === 501)?.BillCode, "AUG-2026-BM-JUL");
  check("4. old variant row's Description unchanged",
    BILLS.find((b) => b.BillCodeId === 501)?.Description, OLD_VARIANT.Description);
  check("4. it can still be reached by requesting its exact code directly",
    (await resolveSalaryEntryBill({
      billCode: "AUG-2026-BM-JUL", createIfMissing: false,
    })).bill.BillCodeId, 501);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
