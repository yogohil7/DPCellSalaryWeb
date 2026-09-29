/**
 * DECISION (2026-09-24, superseded same day): Bill Month is no longer just
 * echoed back for display — migration 45 persists it on
 * dbo.SalaryBillInstituteWorkflow.BillMonth (see resolveSalaryEntryBill's
 * new "Bill Month <= Salary Month" validation and saveEmployeesHandler's
 * write of resolved.canonicalBillMonth). resolveDisplayBillMonth's job
 * narrowed to picking WHICH value to show back to the caller:
 *   1. the value the caller explicitly requested THIS call, else
 *   2. whatever was last persisted for this exact bill + institute, else
 *   3. elseValue (a caller-supplied final fallback).
 *
 * Tests routes/salaryEntry.js's exported resolveDisplayBillMonth() directly
 * — no HTTP server or live SQL Server required.
 *
 * Usage:  cd backend && node scripts/testSalaryEntryBillMonthDisplay.js
 */

const path = require("path");
const Module = require("module");

/* resolveDisplayBillMonth doesn't touch the DB, but salaryEntry.js does
   `require("../db")` at module load time, so the DB layer still needs a
   stub for the require to succeed. */
const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: async () => ({ recordset: [] }),
    Request: function R() { return { query: async () => ({ recordset: [] }), input() { return this; } }; },
  },
  connectDB: async () => true,
};

const { resolveDisplayBillMonth } = require("../routes/salaryEntry");

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

console.log("=".repeat(72));
console.log("Salary Entry: Bill Month display precedence (requested > persisted > elseValue)");
console.log("=".repeat(72));

section("TEST 1 — caller explicitly requests a Bill Month this call: it wins, even over a persisted one");

check(
  "1. requested (canonicalized) wins over persisted",
  resolveDisplayBillMonth({
    requestedBillMonth: "JUL-2026",
    canonicalBillMonth: "JUL-2026",
    persistedBillMonth: "AUG-2026",
    elseValue: "August",
  }),
  "JUL-2026"
);

section("TEST 2 — same-month bill, requested this call: echoes canonical, not a mismatched elseValue label");

check(
  "2. requested AUG-2026 == Salary Month still echoes canonical AUG-2026",
  resolveDisplayBillMonth({
    requestedBillMonth: "AUG-2026",
    canonicalBillMonth: "AUG-2026",
    persistedBillMonth: "",
    elseValue: "August",
  }),
  "AUG-2026"
);

section("TEST 3 — reopen: caller omits billMonth, but a value was previously saved for this bill+institute");

check(
  "3. falls back to the persisted value, not elseValue",
  resolveDisplayBillMonth({
    requestedBillMonth: undefined,
    canonicalBillMonth: "AUG-2026",
    persistedBillMonth: "JUL-2026",
    elseValue: "August",
  }),
  "JUL-2026"
);

section("TEST 4 — brand new bill: nothing requested, nothing persisted yet");

check(
  "4. falls back to canonicalBillMonth over elseValue",
  resolveDisplayBillMonth({
    requestedBillMonth: undefined,
    canonicalBillMonth: "AUG-2026",
    persistedBillMonth: "",
    elseValue: "August",
  }),
  "AUG-2026"
);

check(
  "4b. with no canonicalBillMonth either, falls all the way back to elseValue",
  resolveDisplayBillMonth({
    requestedBillMonth: undefined,
    canonicalBillMonth: "",
    persistedBillMonth: "",
    elseValue: "August",
  }),
  "August"
);

section("TEST 5 — Save Draft / Submit always supplies billMonth explicitly: same precedence, no persisted needed");

check(
  "5. Save/Submit reports the just-saved JUL-2026, not the master's own August",
  resolveDisplayBillMonth({
    requestedBillMonth: "JUL-2026",
    canonicalBillMonth: "JUL-2026",
    persistedBillMonth: "",
    elseValue: "August",
  }),
  "JUL-2026"
);

console.log("\n" + "=".repeat(72));
console.log(`Passed: ${passed}    Failed: ${failed}`);
console.log("=".repeat(72));
process.exit(failed ? 1 : 0);
