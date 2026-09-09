/**
 * Phase 9 — REJECTED Bill Workflow tests (offline).
 *
 * Verifies the correctable-REJECTED workflow end-to-end using in-memory
 * state machines that mirror the real backend logic, so no live server or
 * database is required.
 *
 * Tests:
 *   A — AO can reject a SUBMITTED bill (SUBMITTED → REJECTED)
 *   B — rejected bill appears in GET /returned queue for the assigned auditor
 *   C — assigned auditor can open/edit (assertInstituteEditable returns null)
 *   D — save-draft on REJECTED preserves REJECTED (not DRAFT)
 *   E — auditor can resubmit (REJECTED → RESUBMITTED)
 *   F — a DIFFERENT auditor cannot see the rejected bill in their own queue
 *   G — reject requires a reason (empty reason blocked)
 *   H — reject is blocked when status is APPROVED (wrong state)
 *   I — resubmitted bill leaves the auditor queue (back with AO)
 *   J — assertInstituteEditable returns 403 for SUBMITTED (still blocked)
 *   K — ReturnedToAuditorId is set from SubmittedByUserId when no other id present
 *
 * Usage: cd backend && npm run test:rejected-workflow
 */

"use strict";

/* ======================== FIXTURE ======================== */

const BILL = { BillCodeId: 200, BillCode: "AUG-2026", BillMonth: "AUG-2026" };
const INSTITUTE = "GHM-03";
const AUDITOR_A = 11;   /* submitting auditor  */
const AUDITOR_B = 12;   /* different auditor   */
const AO        = 99;   /* account officer     */

/*
 * In-memory workflow row — mirrors dbo.SalaryBillInstituteWorkflow columns
 * used by the Phase 9 logic.
 */
let workflowRow = null;

function resetWorkflow(initialStatus = "SUBMITTED") {
  workflowRow = {
    WorkflowId: 501,
    SalaryBillCodeId: BILL.BillCodeId,
    InstituteCode: INSTITUTE,
    Status: initialStatus,
    SubmittedByUserId: AUDITOR_A,
    ReturnedToAuditorId: null,
    AssignedAuditorId: null,
    RejectedBy: null,
    RejectReason: null,
    ResubmittedDate: null,
  };
}

/* ====== Mirror of updated assertInstituteEditable (Fix A) ====== */
const EDITABLE_INSTITUTE_STATUSES = new Set(["OPEN", "DRAFT", "RETURNED", "REJECTED"]);

function assertInstituteEditable(workflow, billCode, instituteCode) {
  if (!workflow) return null;
  const status = String(workflow.Status || "").toUpperCase();
  if (status === "LOCKED")
    return { status: 409, message: "This institute salary bill is locked." };
  if (EDITABLE_INSTITUTE_STATUSES.has(status)) return null;
  return {
    status: 403,
    message: `Bill ${billCode} / Institute ${instituteCode} is ${status} and cannot be modified.`,
  };
}

/* ====== Mirror of updated POST /reject extrasBuilder (Fix C) ====== */
function buildRejectExtras(requestBody, workflow) {
  const current = String(workflow?.Status || "").toUpperCase();
  if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(current)) {
    return { error: { status: 409, message: `Bill status ${current} cannot be rejected.` } };
  }
  const reason = String(requestBody?.rejectReason || requestBody?.reason || "").trim();
  if (!reason) {
    return { error: { status: 400, message: "Reject reason is required." } };
  }
  /* Fix C: resolve the auditor to assign back to */
  const rejectedToAuditorId =
    requestBody?.rejectedToAuditorId != null
      ? Number(requestBody.rejectedToAuditorId)
      : workflow?.ReturnedToAuditorId != null
        ? Number(workflow.ReturnedToAuditorId)
        : workflow?.AssignedAuditorId != null
          ? Number(workflow.AssignedAuditorId)
          : workflow?.SubmittedByUserId != null
            ? Number(workflow.SubmittedByUserId)
            : null;
  return { rejectReason: reason, rejectedToAuditorId };
}

/* ====== Mirror of upsertInstituteWorkflow REJECTED branch (Fix D) ====== */
function applyReject(extras, actor) {
  if (extras.error) return extras;
  const rejectedAuditorId =
    extras.rejectedToAuditorId != null
      ? Number(extras.rejectedToAuditorId)
      : workflowRow.ReturnedToAuditorId != null
        ? Number(workflowRow.ReturnedToAuditorId)
        : null;
  workflowRow.Status = "REJECTED";
  workflowRow.RejectedBy = actor;
  workflowRow.RejectReason = extras.rejectReason;
  /* Fix D: populate ReturnedToAuditorId for queue visibility */
  if (rejectedAuditorId != null) {
    workflowRow.ReturnedToAuditorId = rejectedAuditorId;
    workflowRow.AssignedAuditorId   = rejectedAuditorId;
  }
  return workflowRow;
}

/* ====== Mirror of updated GET /returned predicate (Fix B) ====== */
function listReturned({ isAuditor, isAdmin, userId, queryAuditorUserId }) {
  const auditorUserId = isAuditor
    ? Number(userId)
    : Number(queryAuditorUserId);

  /* The single workflow row stands in for the database result set */
  const rows = [workflowRow].filter(Boolean);

  return rows.filter((w) => {
    const s = String(w.Status || "").toUpperCase();
    const inScope =
      s === "RETURNED" ||
      (s === "DRAFT" && w.ReturnedToAuditorId != null) ||
      /* Fix B: REJECTED rows with an assigned auditor */
      (s === "REJECTED" && w.ReturnedToAuditorId != null);
    if (!inScope) return false;
    if (Number.isFinite(auditorUserId) && auditorUserId > 0 && !isAdmin) {
      return Number(w.ReturnedToAuditorId) === auditorUserId;
    }
    return true;
  });
}

/* ====== Mirror of salaryEntry AUDITOR_ACTIONABLE_STATUSES save logic ====== */
const AUDITOR_ACTIONABLE = new Set(["RETURNED", "REJECTED"]);

function salaryEntrySave(submitted) {
  const previous = String(workflowRow?.Status || "DRAFT").toUpperCase();
  let next = "DRAFT";
  if (submitted) {
    next = AUDITOR_ACTIONABLE.has(previous) ? "RESUBMITTED" : "SUBMITTED";
  } else if (AUDITOR_ACTIONABLE.has(previous)) {
    next = previous;           /* preserve RETURNED or REJECTED on save-draft */
  }
  workflowRow.Status = next;
  return next;
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
  console.log("Phase 9 — REJECTED Bill Workflow (offline state-machine tests)");
  console.log("=".repeat(70));

  /* ---- A: AO rejects a SUBMITTED bill ---- */
  section("A — AO rejects a SUBMITTED bill");
  resetWorkflow("SUBMITTED");

  const extrasA = buildRejectExtras({ rejectReason: "Missing documents" }, workflowRow);
  check("A1. no error from buildRejectExtras", extrasA.error, undefined);
  check("A2. rejectReason set",   extrasA.rejectReason,      "Missing documents");
  check("A3. rejectedToAuditorId resolved from SubmittedByUserId", extrasA.rejectedToAuditorId, AUDITOR_A);

  applyReject(extrasA, "Account Officer");
  check("A4. workflow status is REJECTED", workflowRow.Status, "REJECTED");
  check("A5. RejectReason stored",         workflowRow.RejectReason, "Missing documents");
  check("A6. ReturnedToAuditorId set",     workflowRow.ReturnedToAuditorId, AUDITOR_A);
  check("A7. AssignedAuditorId set",       workflowRow.AssignedAuditorId, AUDITOR_A);

  /* ---- B: rejected bill appears in GET /returned for assigned auditor ---- */
  section("B — rejected bill appears in auditor queue");

  const queueB = listReturned({ isAuditor: true, userId: AUDITOR_A });
  check("B1. queue length is 1", queueB.length, 1);
  check("B2. bill is the REJECTED row", queueB[0]?.Status, "REJECTED");

  /* ---- C: assigned auditor can open/edit the rejected bill ---- */
  section("C — assigned auditor can edit REJECTED bill");

  const editableC = assertInstituteEditable(workflowRow, BILL.BillCode, INSTITUTE);
  check("C1. assertInstituteEditable returns null (editable)", editableC, null);

  /* ---- D: save-draft on REJECTED preserves REJECTED ---- */
  section("D — save-draft preserves REJECTED status");

  const statusD = salaryEntrySave(false /* not submitted */);
  check("D1. status remains REJECTED after save-draft", statusD, "REJECTED");
  check("D2. workflowRow.Status is still REJECTED", workflowRow.Status, "REJECTED");

  /* ---- E: auditor resubmits (REJECTED → RESUBMITTED) ---- */
  section("E — auditor resubmits (REJECTED → RESUBMITTED)");

  const statusE = salaryEntrySave(true /* submitted */);
  check("E1. status becomes RESUBMITTED", statusE, "RESUBMITTED");
  check("E2. workflowRow.Status is RESUBMITTED", workflowRow.Status, "RESUBMITTED");

  /* ---- F: a different auditor cannot see the rejected bill in their queue ---- */
  section("F — different auditor cannot see rejected bill");
  resetWorkflow("SUBMITTED");
  applyReject(buildRejectExtras({ rejectReason: "Incorrect amounts" }, workflowRow), "AO");

  const queueF = listReturned({ isAuditor: true, userId: AUDITOR_B });
  check("F1. AUDITOR_B queue length is 0", queueF.length, 0);

  /* ---- G: reject requires a reason ---- */
  section("G — empty reason is blocked");
  resetWorkflow("SUBMITTED");

  const extrasG = buildRejectExtras({ rejectReason: "" }, workflowRow);
  check("G1. error returned for empty reason", extrasG.error != null, true);
  check("G2. error status is 400", extrasG.error?.status, 400);
  check("G3. workflow status unchanged (still SUBMITTED)", workflowRow.Status, "SUBMITTED");

  /* ---- H: reject blocked when status is APPROVED ---- */
  section("H — reject blocked for APPROVED bill");
  resetWorkflow("APPROVED");

  const extrasH = buildRejectExtras({ rejectReason: "Audit query" }, workflowRow);
  check("H1. error returned for APPROVED status", extrasH.error != null, true);
  check("H2. error status is 409", extrasH.error?.status, 409);

  /* ---- I: resubmitted bill leaves the auditor queue ---- */
  section("I — resubmitted bill no longer in auditor queue");
  resetWorkflow("SUBMITTED");
  applyReject(buildRejectExtras({ rejectReason: "Needs correction" }, workflowRow), "AO");
  salaryEntrySave(true); /* REJECTED → RESUBMITTED */

  const queueI = listReturned({ isAuditor: true, userId: AUDITOR_A });
  check("I1. queue is empty after resubmission (RESUBMITTED excluded)", queueI.length, 0);

  /* ---- J: assertInstituteEditable still blocks SUBMITTED ---- */
  section("J — assertInstituteEditable still blocks SUBMITTED");
  resetWorkflow("SUBMITTED");

  const blockedJ = assertInstituteEditable(workflowRow, BILL.BillCode, INSTITUTE);
  check("J1. SUBMITTED returns 403 error (not editable)", blockedJ?.status, 403);

  /* ---- K: ReturnedToAuditorId resolved from SubmittedByUserId ---- */
  section("K — rejectedToAuditorId falls back to SubmittedByUserId");
  resetWorkflow("RESUBMITTED");
  workflowRow.SubmittedByUserId    = AUDITOR_A;
  workflowRow.ReturnedToAuditorId  = null;
  workflowRow.AssignedAuditorId    = null;

  const extrasK = buildRejectExtras({ rejectReason: "Still incorrect" }, workflowRow);
  check("K1. rejectedToAuditorId = SubmittedByUserId", extrasK.rejectedToAuditorId, AUDITOR_A);
  applyReject(extrasK, "AO");
  check("K2. ReturnedToAuditorId populated after reject", workflowRow.ReturnedToAuditorId, AUDITOR_A);

  /* ======================== SUMMARY ======================== */
  console.log("\n" + "=".repeat(70));
  console.log(`REJECTED WORKFLOW: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailed tests:");
    failures.forEach((f) => console.log(`  - ${f.name}`));
  }
  console.log("=".repeat(70));
  if (failed > 0) process.exit(1);
}

main();
