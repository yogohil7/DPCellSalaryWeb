/**
 * Phase 9 — DA Period Overlap Validation tests (offline).
 *
 * Mirrors the same-calendar-month check added to POST and PUT in
 * daMaster.js. No live server or database required.
 *
 * Requirement: only one Active DA Master record may have an EffectiveFrom
 * date in a given calendar year/month. Inactive records are excluded.
 *
 * Tests:
 *   1 — same EffectiveFrom date → rejected (existing exact-date check)
 *   2 — different day, same month → rejected (new month check)
 *   3 — different calendar months → allowed
 *   4 — PUT same record without changing month → allowed (self-excluded)
 *   5 — PUT moving record into a month with another active record → rejected
 *   6 — Inactive record in same month → allowed (inactive excluded)
 *   7 — two records in different months, both Active → allowed
 *   8 — new record in month that only has an Inactive record → allowed
 *
 * Usage: cd backend && npm run test:da-overlap
 */

"use strict";

/* ====== Mirror of the validation logic in daMaster.js (Fix G) ====== */

/**
 * Check whether creating a new record with `effectiveFrom` would conflict
 * with any existing Active record in the same calendar year/month.
 *
 * @param {Array}  existingRecords  — rows from dbo.DAMaster
 * @param {string} effectiveFrom    — "YYYY-MM-DD"
 * @param {number|null} excludeId  — DAId to exclude (for PUT self-check)
 * @returns {{ conflict: boolean, existingDate?: string }}
 */
function checkMonthOverlap(existingRecords, effectiveFrom, excludeId = null) {
  const d = new Date(effectiveFrom);
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-based

  for (const row of existingRecords) {
    if (excludeId != null && Number(row.DAId) === Number(excludeId)) continue;
    const status = String(row.Status || "Active").trim();
    /* Inactive records do not participate in salary calculation */
    if (status.toUpperCase() === "INACTIVE") continue;

    const existingD = new Date(row.EffectiveFrom);
    const existingYear  = existingD.getUTCFullYear();
    const existingMonth = existingD.getUTCMonth() + 1;

    if (existingYear === year && existingMonth === month) {
      return { conflict: true, existingDate: String(row.EffectiveFrom).slice(0, 10) };
    }
  }

  return { conflict: false };
}

/**
 * Exact-date duplicate check (existing logic, mirrors daMaster.js).
 * For POST (excludeId = null) and PUT (excludeId = current DAId).
 */
function checkExactDup(existingRecords, effectiveFrom, excludeId = null) {
  for (const row of existingRecords) {
    if (excludeId != null && Number(row.DAId) === Number(excludeId)) continue;
    if (String(row.EffectiveFrom).slice(0, 10) === String(effectiveFrom).slice(0, 10)) {
      return { conflict: true };
    }
  }
  return { conflict: false };
}

/* ======================== TEST DATA ======================== */

const records = [
  { DAId: 1, EffectiveFrom: "2026-04-01", Status: "Active"   },  /* April 2026   */
  { DAId: 2, EffectiveFrom: "2026-07-01", Status: "Active"   },  /* July 2026    */
  { DAId: 3, EffectiveFrom: "2026-10-01", Status: "Inactive" },  /* Oct 2026 (inactive) */
];

/* ======================== TEST RUNNER ======================== */

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push({ name, expected: e, actual: a });
    console.log(`  FAIL  ${name}`);
    console.log(`         expected: ${e}`);
    console.log(`         actual:   ${a}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function main() {
  console.log("=".repeat(70));
  console.log("Phase 9 — DA Period Overlap Validation (offline tests)");
  console.log("=".repeat(70));

  /* ---- 1: same EffectiveFrom date → rejected (exact-date check) ---- */
  section("Test 1 — same EffectiveFrom date → rejected");
  const t1exact = checkExactDup(records, "2026-07-01");
  check("1a. exact-date dup detected", t1exact.conflict, true);
  /* Month check would also fire but exact-date check runs first */
  const t1month = checkMonthOverlap(records, "2026-07-01");
  check("1b. month overlap also detected", t1month.conflict, true);
  check("1c. existingDate is 2026-07-01", t1month.existingDate, "2026-07-01");

  /* ---- 2: different day, same month → rejected by month check ---- */
  section("Test 2 — different day same calendar month → rejected");
  const t2exact = checkExactDup(records, "2026-07-15");
  check("2a. exact-date dup NOT detected for different day", t2exact.conflict, false);
  const t2month = checkMonthOverlap(records, "2026-07-15");
  check("2b. month overlap detected", t2month.conflict, true);
  check("2c. existingDate is 2026-07-01", t2month.existingDate, "2026-07-01");

  /* ---- 3: different calendar months → allowed ---- */
  section("Test 3 — different calendar months → allowed");
  const t3 = checkMonthOverlap(records, "2026-08-01");
  check("3a. no overlap for August (no existing Aug record)", t3.conflict, false);

  /* ---- 4: PUT self-update same month → allowed (self excluded) ---- */
  section("Test 4 — PUT self-update without changing month → allowed");
  const t4 = checkMonthOverlap(records, "2026-07-01", /*excludeId=*/ 2);
  check("4a. no conflict when excluding own DAId=2", t4.conflict, false);
  const t4exact = checkExactDup(records, "2026-07-01", /*excludeId=*/ 2);
  check("4b. exact-date check also passes for self-update", t4exact.conflict, false);

  /* ---- 5: PUT moving into a month with another active record → rejected ---- */
  section("Test 5 — PUT moves record into occupied month → rejected");
  /* Simulate moving DAId=3 (was Oct) into July (occupied by DAId=2) */
  const recordsWithActive3 = [
    { DAId: 1, EffectiveFrom: "2026-04-01", Status: "Active" },
    { DAId: 2, EffectiveFrom: "2026-07-01", Status: "Active" },
    { DAId: 3, EffectiveFrom: "2026-10-01", Status: "Active" }, /* Active now */
  ];
  const t5 = checkMonthOverlap(recordsWithActive3, "2026-07-15", /*excludeId=*/ 3);
  check("5a. conflict detected (July already has DAId=2)", t5.conflict, true);
  check("5b. existingDate is 2026-07-01", t5.existingDate, "2026-07-01");

  /* ---- 6: Inactive record in same month → allowed ---- */
  section("Test 6 — Inactive record in same month → allowed");
  /* Oct is Inactive in records fixture */
  const t6 = checkMonthOverlap(records, "2026-10-15");
  check("6a. no conflict (existing Oct record is Inactive)", t6.conflict, false);

  /* ---- 7: two records in different months, both Active → allowed ---- */
  section("Test 7 — two different months, both Active → allowed");
  const t7a = checkMonthOverlap(records, "2026-04-01", /*excludeId=*/ 1);
  check("7a. self-update April still allowed", t7a.conflict, false);
  const t7b = checkMonthOverlap(records, "2026-05-01");
  check("7b. new record in May allowed (no existing May record)", t7b.conflict, false);

  /* ---- 8: new record in month with only an Inactive record → allowed ---- */
  section("Test 8 — month has only Inactive record → allowed");
  const t8 = checkMonthOverlap(records, "2026-10-01");
  check("8a. no conflict for Oct (existing record is Inactive)", t8.conflict, false);

  /* ======================== SUMMARY ======================== */
  console.log("\n" + "=".repeat(70));
  console.log(`DA OVERLAP: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailed tests:");
    failures.forEach((f) => console.log(`  - ${f.name}`));
  }
  console.log("=".repeat(70));
  if (failed > 0) process.exit(1);
}

main();
