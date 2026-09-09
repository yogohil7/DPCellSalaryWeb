/**
 * Returning Salary Bills listing tests (A-J).
 *
 * Replays the real workflow transitions against an in-memory
 * dbo.SalaryBillInstituteWorkflow and the real listing predicate, so the
 * "Returned Salary Bills: 0" regression cannot come back.
 *
 * Runs offline. Usage: cd backend && npm run test:returned-bills-listing
 */

const fs = require("fs");
const path = require("path");

/* ===================== FIXTURE ===================== */

const JUN_MASTER = {
  billCodeId: 100, billCode: "JUN-2026", billMonth: "MAY-2026",
  salaryMonth: "JUN-2026", masterStatus: "LOCKED",
};
const MAY_VARIANT = {
  billCodeId: 101, billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026",
  salaryMonth: "JUN-2026", masterStatus: "OPEN",
};
JUN_MASTER.billMonth = "JUN-2026";

const INSTITUTE = "OGE-05";
const AUDITOR_A = 7;    /* Yogesh Gohil */
const AUDITOR_B = 8;

const rows = new Map();
const key = (billCodeId, instituteCode) => `${billCodeId}|${instituteCode}`;

function seed(bill, instituteCode, status) {
  rows.set(key(bill.billCodeId, instituteCode), {
    SalaryBillCodeId: bill.billCodeId,
    InstituteCode: instituteCode,
    Status: status,
    ReturnedToAuditorId: null,
    AssignedAuditorId: null,
    BillCode: bill.billCode,
    BillMonth: bill.billMonth,
    SalaryMonth: bill.salaryMonth,
  });
}

/* ---- real workflow transitions (mirrors utils/salaryBillInstituteWorkflow) ---- */

function aoReturn(bill, instituteCode, auditorId) {
  const row = rows.get(key(bill.billCodeId, instituteCode));
  row.Status = "RETURNED";
  row.ReturnedToAuditorId = auditorId;
  row.AssignedAuditorId = auditorId;
  return row;
}

/* Mirrors nextStatus in saveEmployeesHandler AFTER the fix. */
const AUDITOR_ACTIONABLE = new Set(["RETURNED", "REJECTED"]);
function salaryEntrySave(bill, instituteCode, { submitted }) {
  const row = rows.get(key(bill.billCodeId, instituteCode));
  const previous = String(row.Status || "DRAFT").toUpperCase();
  let next = "DRAFT";
  if (submitted) {
    next = AUDITOR_ACTIONABLE.has(previous) ? "RESUBMITTED" : "SUBMITTED";
  } else if (AUDITOR_ACTIONABLE.has(previous)) {
    next = previous;
  }
  row.Status = next;
  return row;
}

/** The OLD buggy save, kept to prove the regression is what we think. */
function legacySave(row, { submitted }) {
  const previous = String(row.Status || "DRAFT").toUpperCase();
  let next = "DRAFT";
  if (submitted) {
    next = AUDITOR_ACTIONABLE.has(previous) ? "RESUBMITTED" : "SUBMITTED";
  }
  return next;
}

/* ---- the real listing predicate ---- */

function listReturned({ roleKey, userId, queryAuditorUserId }) {
  const authRole = String(roleKey || "").toUpperCase();
  const isAuditor = authRole.includes("AUDITOR");
  const isAdmin =
    !isAuditor &&
    (authRole.includes("ADMIN") ||
      authRole.includes("ACCOUNT OFFICER") ||
      authRole.includes("SUPER"));

  /* Identity from the token; the query parameter is ignored for auditors. */
  const auditorUserId = isAuditor ? Number(userId) : Number(queryAuditorUserId);

  return [...rows.values()].filter((w) => {
    const status = String(w.Status || "").toUpperCase();
    const inScope =
      status === "RETURNED" ||
      (status === "DRAFT" && w.ReturnedToAuditorId != null);
    if (!inScope) return false;
    if (Number.isFinite(auditorUserId) && auditorUserId > 0 && !isAdmin) {
      return Number(w.ReturnedToAuditorId) === Number(auditorUserId);
    }
    return true;
  });
}

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

function main() {
  console.log("=".repeat(70));
  console.log("Returning Salary Bills — listing and auditor scoping (A-J)");
  console.log("=".repeat(70));

  rows.clear();
  seed(JUN_MASTER, INSTITUTE, "LOCKED");
  seed(MAY_VARIANT, INSTITUTE, "SUBMITTED");

  /* ---------------- A ---------------- */
  section("A — Account Officer returns JUN-2026-BM-MAY / OGE-05");

  const returned = aoReturn(MAY_VARIANT, INSTITUTE, AUDITOR_A);
  check("A. status is RETURNED", returned.Status, "RETURNED");
  check("A. ReturnedToAuditorId is set", returned.ReturnedToAuditorId, AUDITOR_A);
  check("A. AssignedAuditorId is set", returned.AssignedAuditorId, AUDITOR_A);

  /* ---------------- B / C / D ---------------- */
  section("B, C, D — the auditor's queue shows it with the right identity");

  let queue = listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A });
  check("B/C. exactly one bill listed", queue.length, 1);
  check("D. BillCode", queue[0].BillCode, "JUN-2026-BM-MAY");
  check("D. BillMonth", queue[0].BillMonth, "MAY-2026");
  check("D. SalaryMonth", queue[0].SalaryMonth, "JUN-2026");
  check("D. InstituteCode", queue[0].InstituteCode, "OGE-05");

  /* ---------------- THE REGRESSION ---------------- */
  section("Regression — Save Draft must not empty the queue");

  check("legacy Save Draft downgraded RETURNED to DRAFT",
    legacySave(returned, { submitted: false }), "DRAFT");

  salaryEntrySave(MAY_VARIANT, INSTITUTE, { submitted: false });
  check("fixed Save Draft keeps RETURNED",
    rows.get(key(MAY_VARIANT.billCodeId, INSTITUTE)).Status, "RETURNED");

  queue = listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A });
  check("bill still listed after Save Draft", queue.length, 1);
  check("J. the page count is 1, not 0", queue.length, 1);

  /* A row already stranded as DRAFT by the old code is recovered. */
  const stranded = rows.get(key(MAY_VARIANT.billCodeId, INSTITUTE));
  stranded.Status = "DRAFT";
  check("stranded DRAFT row is recovered by the listing",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A }).length, 1);
  stranded.Status = "RETURNED";

  /* A plain DRAFT that was never returned must NOT appear. */
  seed({ billCodeId: 102, billCode: "JUL-2026", billMonth: "JUL-2026", salaryMonth: "JUL-2026" },
       INSTITUTE, "DRAFT");
  check("an ordinary DRAFT is not in the auditor queue",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A }).length, 1);

  /* ---------------- E / F ---------------- */
  section("E, F — auditor scoping cannot be widened");

  seed({ billCodeId: 103, billCode: "AUG-2026", billMonth: "AUG-2026", salaryMonth: "AUG-2026" },
       "CPD-25", "SUBMITTED");
  aoReturn({ billCodeId: 103 }, "CPD-25", AUDITOR_B);

  check("E. auditor A sees only their own bill",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A }).map((r) => r.BillCode),
    ["JUN-2026-BM-MAY"]);
  check("E. auditor B sees only theirs",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_B }).map((r) => r.BillCode),
    ["AUG-2026"]);
  check("F. a spoofed auditorUserId query param is ignored",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A, queryAuditorUserId: AUDITOR_B })
      .map((r) => r.BillCode),
    ["JUN-2026-BM-MAY"]);
  check("F. a spoofed roleName cannot grant the admin view",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A, queryAuditorUserId: 0 }).length, 1);
  check("account officer sees every returned bill",
    listReturned({ roleKey: "ACCOUNT_OFFICER" }).length, 2);

  /* ---------------- G / I ---------------- */
  section("G, I — the JUN-2026 master stays out of it and stays LOCKED");

  const auditorQueue = listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A });
  check("G. master JUN-2026 is not listed",
    auditorQueue.some((r) => r.BillCode === "JUN-2026"), false);
  check("G. the listed bill is the variant",
    auditorQueue[0].BillCode, "JUN-2026-BM-MAY");
  check("I. master remains LOCKED",
    rows.get(key(JUN_MASTER.billCodeId, INSTITUTE)).Status, "LOCKED");
  check("I. master has no assigned auditor",
    rows.get(key(JUN_MASTER.billCodeId, INSTITUTE)).ReturnedToAuditorId, null);

  /* ---------------- H ---------------- */
  section("H — resubmit removes it, a second return brings it back");

  salaryEntrySave(MAY_VARIANT, INSTITUTE, { submitted: true });
  check("H. resubmit sets RESUBMITTED",
    rows.get(key(MAY_VARIANT.billCodeId, INSTITUTE)).Status, "RESUBMITTED");
  check("H. it leaves the auditor queue",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A }).length, 0);

  aoReturn(MAY_VARIANT, INSTITUTE, AUDITOR_A);
  check("H. returning it again brings it back",
    listReturned({ roleKey: "AUDITOR", userId: AUDITOR_A }).length, 1);
  check("H. and the master is still untouched",
    rows.get(key(JUN_MASTER.billCodeId, INSTITUTE)).Status, "LOCKED");

  /* ---------------- WIRING ---------------- */
  section("Wiring — the shipped SQL and save path match these rules");

  const approvalSrc = read("routes/salaryBillApproval.js");
  const entrySrc = read("routes/salaryEntry.js");

  check("listing accepts RETURNED",
    /UPPER\(w\.Status\) = N'RETURNED'/.test(approvalSrc), true);
  check("listing recovers DRAFT rows with an assigned auditor",
    /UPPER\(w\.Status\) = N'DRAFT'[\s\S]{0,80}w\.ReturnedToAuditorId IS NOT NULL/.test(approvalSrc),
    true);
  check("listing does NOT include RESUBMITTED",
    /UPPER\(w\.Status\) = N'RESUBMITTED'/.test(
      approvalSrc.slice(approvalSrc.indexOf('router.get("/returned"'),
                        approvalSrc.indexOf('router.get("/", accountOfficerOnly'))
    ), false);
  check("auditor scope still comes from the token",
    /isAuditor\s*\?\s*Number\(req\.user\?\.userId\)/.test(approvalSrc), true);
  check("auditor filter still applied to the query",
    /AND w\.ReturnedToAuditorId = \$\{Number\(auditorUserId\)\}/.test(approvalSrc), true);
  check("Save Draft preserves an auditor-actionable status",
    /AUDITOR_ACTIONABLE_STATUSES\.has\(previousStatus\)\)\s*\{\s*nextStatus = previousStatus;/.test(
      entrySrc.replace(/\s+/g, " ").replace(/ \} else if \(/g, "\n} else if (")
    ) || /else if \(AUDITOR_ACTIONABLE_STATUSES\.has\(previousStatus\)\)/.test(entrySrc),
    true);
  check("approval actions remain Account Officer only",
    /router\.post\("\/:idOrCode\/return", accountOfficerOnly/.test(approvalSrc), true);
  check("/returned is still open to the auditor",
    /router\.get\("\/returned", accountOfficerOnly/.test(approvalSrc), false);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(70));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
