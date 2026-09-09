/**
 * Phase 9 — Month Closure Completeness Gate tests (offline).
 *
 * Mirrors the logic added to POST /:id/complete and POST /:id/lock in
 * salaryBillCodes.js. No live server or database required.
 *
 * Tests:
 *   A — all APPROVED  → complete succeeds
 *   B — all LOCKED    → complete succeeds
 *   C — mixed APPROVED+LOCKED → complete succeeds
 *   D — any DRAFT     → complete blocked
 *   E — any SUBMITTED → complete blocked
 *   F — any RETURNED  → complete blocked
 *   G — any REJECTED  → complete blocked
 *   H — any VERIFIED  → complete blocked
 *   I — partial (some APPROVED, some DRAFT) → complete blocked with count
 *   J — zero workflow rows → complete blocked (empty month)
 *   K — all LOCKED    → lock succeeds
 *   L — any APPROVED (not yet LOCKED) → lock blocked
 *   M — zero workflow rows → lock not blocked (COMPLETED → LOCKED is admin action)
 *
 * Usage: cd backend && npm run test:month-closure
 */

"use strict";

const BILL_CODE = "SEP-2026";
const BILL_ID   = 300;

/* ====== Mirror of POST /:id/complete completeness check (Fix E) ====== */
function checkCompleteGate(workflowRows) {
  if (workflowRows.length === 0) {
    return {
      blocked: true,
      status: 400,
      message:
        `Bill Code ${BILL_CODE} cannot be completed: ` +
        `no institute workflow entries exist. ` +
        `At least one institute must have submitted and been approved before closing the month.`,
      incompleteCount: 0,
      incompleteInstitutes: [],
    };
  }

  const COMPLETE_STATUSES = new Set(["APPROVED", "LOCKED"]);
  const incomplete = workflowRows.filter(
    (r) => !COMPLETE_STATUSES.has(String(r.status || "").toUpperCase())
  );

  if (incomplete.length > 0) {
    return {
      blocked: true,
      status: 400,
      message:
        `Bill Code ${BILL_CODE} cannot be completed: ` +
        `${incomplete.length} of ${workflowRows.length} institute(s) ` +
        `have not been approved.`,
      incompleteCount: incomplete.length,
      totalCount: workflowRows.length,
      incompleteInstitutes: incomplete.map((r) => ({
        instituteCode: r.instituteCode,
        instituteName: r.instituteName,
        status: r.status,
      })),
    };
  }

  return { blocked: false };
}

/* ====== Mirror of POST /:id/lock completeness check (Fix F) ====== */
function checkLockGate(workflowRows) {
  const notLocked = workflowRows.filter(
    (r) => String(r.status || "").toUpperCase() !== "LOCKED"
  );

  if (notLocked.length > 0) {
    return {
      blocked: true,
      status: 400,
      message:
        `Bill Code ${BILL_CODE} cannot be locked: ` +
        `${notLocked.length} institute(s) have not been locked yet.`,
      incompleteCount: notLocked.length,
      incompleteInstitutes: notLocked.map((r) => ({
        instituteCode: r.instituteCode,
        instituteName: r.instituteName,
        status: r.status,
      })),
    };
  }

  return { blocked: false };
}

/* ======================== HELPERS ======================== */

function makeInstitutes(statuses) {
  return statuses.map((s, i) => ({
    instituteCode: `INST-${String(i + 1).padStart(2, "0")}`,
    instituteName: `Institute ${i + 1}`,
    status: s,
  }));
}

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
  console.log("Phase 9 — Month Closure Completeness Gate (offline tests)");
  console.log("=".repeat(70));

  /* ---- A: all APPROVED → complete succeeds ---- */
  section("A — all APPROVED → complete succeeds");
  const a = checkCompleteGate(makeInstitutes(["APPROVED", "APPROVED", "APPROVED"]));
  check("A1. not blocked", a.blocked, false);

  /* ---- B: all LOCKED → complete succeeds ---- */
  section("B — all LOCKED → complete succeeds");
  const b = checkCompleteGate(makeInstitutes(["LOCKED", "LOCKED"]));
  check("B1. not blocked", b.blocked, false);

  /* ---- C: mixed APPROVED+LOCKED → complete succeeds ---- */
  section("C — mixed APPROVED + LOCKED → complete succeeds");
  const c = checkCompleteGate(makeInstitutes(["APPROVED", "LOCKED", "APPROVED"]));
  check("C1. not blocked", c.blocked, false);

  /* ---- D: any DRAFT → complete blocked ---- */
  section("D — any DRAFT → complete blocked");
  const d = checkCompleteGate(makeInstitutes(["APPROVED", "DRAFT"]));
  check("D1. blocked", d.blocked, true);
  check("D2. incompleteCount is 1", d.incompleteCount, 1);
  check("D3. incomplete institute status is DRAFT", d.incompleteInstitutes[0]?.status, "DRAFT");

  /* ---- E: any SUBMITTED → complete blocked ---- */
  section("E — any SUBMITTED → complete blocked");
  const e = checkCompleteGate(makeInstitutes(["APPROVED", "SUBMITTED"]));
  check("E1. blocked", e.blocked, true);
  check("E2. incompleteCount is 1", e.incompleteCount, 1);

  /* ---- F: any RETURNED → complete blocked ---- */
  section("F — any RETURNED → complete blocked");
  const f = checkCompleteGate(makeInstitutes(["RETURNED", "APPROVED"]));
  check("F1. blocked", f.blocked, true);
  check("F2. incompleteCount is 1", f.incompleteCount, 1);

  /* ---- G: any REJECTED → complete blocked ---- */
  section("G — any REJECTED → complete blocked");
  const g = checkCompleteGate(makeInstitutes(["REJECTED", "APPROVED"]));
  check("G1. blocked", g.blocked, true);
  check("G2. incompleteCount is 1", g.incompleteCount, 1);
  check("G3. incomplete institute status is REJECTED", g.incompleteInstitutes[0]?.status, "REJECTED");

  /* ---- H: any VERIFIED → complete blocked ---- */
  section("H — any VERIFIED → complete blocked");
  const h = checkCompleteGate(makeInstitutes(["VERIFIED", "APPROVED"]));
  check("H1. blocked", h.blocked, true);
  check("H2. incompleteCount is 1", h.incompleteCount, 1);

  /* ---- I: partial (some APPROVED, some DRAFT) → blocked with correct counts ---- */
  section("I — partial APPROVED/DRAFT → blocked with correct count");
  const i = checkCompleteGate(makeInstitutes(["APPROVED", "APPROVED", "DRAFT", "SUBMITTED"]));
  check("I1. blocked", i.blocked, true);
  check("I2. incompleteCount is 2", i.incompleteCount, 2);
  check("I3. totalCount is 4",      i.totalCount, 4);
  check("I4. first incomplete is DRAFT", i.incompleteInstitutes[0]?.status, "DRAFT");
  check("I5. second incomplete is SUBMITTED", i.incompleteInstitutes[1]?.status, "SUBMITTED");
  check("I6. blocked message mentions 2 of 4", i.message.includes("2 of 4"), true);

  /* ---- J: zero workflow rows → complete blocked (empty month) ---- */
  section("J — zero workflow rows → complete blocked (empty month)");
  const j = checkCompleteGate([]);
  check("J1. blocked", j.blocked, true);
  check("J2. incompleteCount is 0", j.incompleteCount, 0);
  check("J3. message mentions no workflow entries", j.message.includes("no institute workflow entries"), true);

  /* ---- K: all LOCKED → lock succeeds ---- */
  section("K — all LOCKED → lock succeeds");
  const k = checkLockGate(makeInstitutes(["LOCKED", "LOCKED", "LOCKED"]));
  check("K1. not blocked", k.blocked, false);

  /* ---- L: any APPROVED (not yet per-institute LOCKED) → lock blocked ---- */
  section("L — any APPROVED not yet LOCKED → lock blocked");
  const l = checkLockGate(makeInstitutes(["LOCKED", "APPROVED"]));
  check("L1. blocked", l.blocked, true);
  check("L2. incompleteCount is 1", l.incompleteCount, 1);
  check("L3. incomplete status is APPROVED", l.incompleteInstitutes[0]?.status, "APPROVED");

  /* ---- M: zero workflow rows for lock → not blocked ---- */
  section("M — zero workflow rows → lock not blocked (COMPLETED bill with no institutes)");
  const m = checkLockGate([]);
  check("M1. not blocked (zero rows)", m.blocked, false);

  /* ======================== SUMMARY ======================== */
  console.log("\n" + "=".repeat(70));
  console.log(`MONTH CLOSURE: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailed tests:");
    failures.forEach((f) => console.log(`  - ${f.name}`));
  }
  console.log("=".repeat(70));
  if (failed > 0) process.exit(1);
}

main();
