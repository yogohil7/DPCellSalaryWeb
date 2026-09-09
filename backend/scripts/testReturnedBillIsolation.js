/**
 * Returned-bill / Bill-Month isolation tests.
 *
 * Scenario from the field report:
 *   JUN-2026        BillMonth JUN-2026  SalaryMonth JUN-2026  OGE-05  LOCKED
 *   JUN-2026-BM-MAY BillMonth MAY-2026  SalaryMonth JUN-2026  OGE-05  RETURNED
 *
 * These are two independent bills. The LOCKED master must never gate the
 * RETURNED variant.
 *
 * Runs offline: the database layer is stubbed.
 *
 * Usage:  cd backend && npm run test:returned-isolation
 */

const path = require("path");
const Module = require("module");

/* ========================= FIXTURE ========================= */

const MASTER = {
  BillCodeId: 100,
  BillCode: "JUN-2026",
  BillMonth: "JUN-2026",
  SalaryMonth: "June",
  SalaryMonthNumber: "06",
  SalaryYear: "2026",
  BillCategory: "Salary",
  BillType: "Regular Salary",
  Status: "LOCKED",
  IsArchived: 0,
};

const VARIANT = {
  BillCodeId: 101,
  BillCode: "JUN-2026-BM-MAY",
  BillMonth: "MAY-2026",
  SalaryMonth: "June",
  SalaryMonthNumber: "06",
  SalaryYear: "2026",
  BillCategory: "Salary",
  BillType: "Regular Salary",
  Status: "RETURNED",
  IsArchived: 0,
};

const BILLS = [MASTER, VARIANT];

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ");
  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    if (/WHERE BillCode = \?/i.test(text)) {
      const code = String(values[0]);
      return Promise.resolve({
        recordset: BILLS.filter((b) => b.BillCode === code),
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

const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");

/* ========================= RUNNER ========================= */

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

/* Mirror of statusGateBill() in routes/salaryEntry.js. */
function statusGateBill(resolved) {
  const bill = resolved?.bill;
  const sourceBill = resolved?.sourceBill || bill;
  if (!bill) return sourceBill;
  return String(bill.BillCode) !== String(sourceBill.BillCode) ? bill : sourceBill;
}

const CORRECTION = new Set(["RETURNED", "REJECTED"]);
function billUsableInSalaryEntry(bill) {
  const status = String(bill?.Status || "").toUpperCase();
  return status === "OPEN" || CORRECTION.has(status);
}

async function main() {
  console.log("=".repeat(68));
  console.log("Returned-bill / Bill-Month isolation");
  console.log("=".repeat(68));

  section("Resolution — the exact returned bill must be selected");

  const byExactCode = await resolveSalaryEntryBill({
    billCode: "JUN-2026-BM-MAY",
    billMonth: "MAY-2026",
    salaryMonth: "June",
    createIfMissing: false,
  });
  check("resolves to the BM variant", byExactCode.bill.BillCode, "JUN-2026-BM-MAY");
  check("keeps BillMonth MAY-2026", byExactCode.bill.BillMonth, "MAY-2026");
  check("keeps SalaryMonth June", byExactCode.bill.SalaryMonth, "June");
  check("carries status RETURNED", byExactCode.bill.Status, "RETURNED");
  check("master is reported separately", byExactCode.sourceBill.BillCode, "JUN-2026");
  check("and the master is still LOCKED", byExactCode.sourceBill.Status, "LOCKED");

  /* The reported failure: billMonth omitted by the caller. */
  const noBillMonth = await resolveSalaryEntryBill({
    billCode: "JUN-2026-BM-MAY",
    createIfMissing: false,
  });
  check(
    "still resolves to the variant when billMonth is omitted",
    noBillMonth.bill.BillCode,
    "JUN-2026-BM-MAY"
  );
  check(
    "does NOT collapse to the JUN-2026 master",
    noBillMonth.bill.BillCode !== "JUN-2026",
    true
  );
  check("BillMonth is not derived from SalaryMonth", noBillMonth.bill.BillMonth, "MAY-2026");

  /* A wrong billMonth from the caller must not redirect to the master. */
  const wrongBillMonth = await resolveSalaryEntryBill({
    billCode: "JUN-2026-BM-MAY",
    billMonth: "JUN-2026",
    salaryMonth: "June",
    createIfMissing: false,
  });
  check(
    "a mis-sent billMonth cannot redirect to the master",
    wrongBillMonth.bill.BillCode,
    "JUN-2026-BM-MAY"
  );

  section("Status gate — the LOCKED master must not block the variant");

  check(
    "gate uses the variant, not the master",
    statusGateBill(byExactCode).BillCode,
    "JUN-2026-BM-MAY"
  );
  check(
    "gate status is RETURNED, not LOCKED",
    statusGateBill(byExactCode).Status,
    "RETURNED"
  );
  check(
    "so the returned bill IS usable in Salary Entry",
    billUsableInSalaryEntry(statusGateBill(byExactCode)),
    true
  );
  check(
    "whereas gating on the master would have blocked it",
    billUsableInSalaryEntry(byExactCode.sourceBill),
    false
  );

  section("Normal bills are unaffected");

  const plain = await resolveSalaryEntryBill({
    billCode: "JUN-2026",
    billMonth: "JUN-2026",
    salaryMonth: "June",
    createIfMissing: false,
  });
  check("same-month bill resolves to itself", plain.bill.BillCode, "JUN-2026");
  check(
    "gate falls back to that same row",
    statusGateBill(plain).BillCode,
    "JUN-2026"
  );
  check(
    "and its LOCKED status is still enforced",
    billUsableInSalaryEntry(statusGateBill(plain)),
    false
  );

  section("Identity is preserved end to end");

  const identity = (r) => ({
    billCodeId: r.bill.BillCodeId,
    billCode: r.bill.BillCode,
    billMonth: r.bill.BillMonth,
    salaryMonth: r.bill.SalaryMonth,
    salaryYear: r.bill.SalaryYear,
  });
  check("returned bill identity", identity(byExactCode), {
    billCodeId: 101,
    billCode: "JUN-2026-BM-MAY",
    billMonth: "MAY-2026",
    salaryMonth: "June",
    salaryYear: "2026",
  });
  check("master identity is untouched", identity(plain), {
    billCodeId: 100,
    billCode: "JUN-2026",
    billMonth: "JUN-2026",
    salaryMonth: "June",
    salaryYear: "2026",
  });
  check("the two bills have different ids", identity(byExactCode).billCodeId !== identity(plain).billCodeId, true);
  check("master status unchanged after resolving the variant", MASTER.Status, "LOCKED");
  check("variant status unchanged after resolving the master", VARIANT.Status, "RETURNED");

  console.log(`\n${"=".repeat(68)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(68));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
