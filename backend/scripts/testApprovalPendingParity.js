/**
 * Dashboard "Pending Approval" vs Salary Approval list parity.
 *
 * ROOT CAUSE (live data, AUG-2026 salary month):
 *   SUBMITTED | AUG-2026 | MR-29 | BillMonth JUL-2026 | sed=0 | sebd=8
 * The Dashboard counts every SUBMITTED/RESUBMITTED/VERIFIED workflow row of
 * the current salary month. The approval PENDING list additionally required
 * SalaryEmployeeDetails rows (sed > 0), but a submitted NON-canonical Bill
 * Month instance snapshots into SalaryEntryBillEmployeeDetails scoped to the
 * workflow row's own BillMonth (sebd) — so MR-29/JUL-2026 was counted (1)
 * yet invisible (0). Fix: the non-DA eligibility arm accepts sed > 0 OR
 * the instance-scoped sebd > 0 (the same sebd the totals already use).
 *
 * Runs offline (fixture mirrors the live rows). Usage:
 *   cd backend && npm run test:approval-pending-parity
 */

const fs = require("fs");
const path = require("path");

const approvalSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "salaryBillApproval.js"),
  "utf8"
);
const dashboardSrc = fs.readFileSync(
  path.join(__dirname, "..", "routes", "dashboard.js"),
  "utf8"
);

/* Fixture: status, billCode, institute, billMonth, sedCnt, sebdCnt, dadCnt, category, isOpenMonth */
const ROWS = [
  ["SUBMITTED", "AUG-2026", "PLAN-10", "AUG-2026", 5, 0, 0, "Salary", true], // canonical -> listed
  ["SUBMITTED", "AUG-2026", "MR-29", "JUL-2026", 0, 8, 0, "Salary", true], // the live phantom -> listed
  ["SUBMITTED", "AUG-2026", "EMPTY-1", "AUG-2026", 0, 0, 0, "Salary", true], // genuinely empty -> hidden
  ["RESUBMITTED", "AUG-2026", "PLAN-11", "AUG-2026", 3, 0, 0, "Salary", true],
  ["VERIFIED", "AUG-2026", "PLAN-12", "AUG-2026", 2, 0, 0, "Salary", true],
  ["RETURNED", "AUG-2026", "PLAN-13", "AUG-2026", 4, 0, 0, "Salary", true],
  ["REJECTED", "AUG-2026", "PLAN-14", "AUG-2026", 4, 0, 0, "Salary", true],
  ["DRAFT", "AUG-2026", "PLAN-16", "AUG-2026", 4, 0, 0, "Salary", true],
  ["LOCKED", "AUG-2026", "PLAN-18", "AUG-2026", 4, 0, 0, "Salary", true],
  ["APPROVED", "JUN-2026", "PLAN-07", "JUN-2026", 4, 0, 0, "Salary", false], // historic approved -> hidden
  ["SUBMITTED", "DA-2026", "DDRS-01", "JUL-2026", 0, 0, 0, "Difference", true], // DA w/o dad rows -> hidden
  ["SUBMITTED", "DA-2026", "DDRS-02", "JUL-2026", 0, 0, 6, "Difference", true], // DA with dad rows -> listed
];

/* Mirrors the fixed PENDING WHERE clause (non-DA arm: sed>0 OR sebd>0). */
function pendingListed([status, , , , sed, sebd, dad, category, openMonth]) {
  const st = String(status).toUpperCase();
  const isDA = String(category).toUpperCase() === "DIFFERENCE";
  const activeQueue = ["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(st);
  const approvedArm = st === "APPROVED" && (isDA || openMonth === true);
  if (!activeQueue && !approvedArm) return false;
  if (isDA) return dad > 0;
  return sed > 0 || sebd > 0;
}

/* Old (buggy) predicate: sed-only. */
function oldPendingListed([status, , , , sed, category]) {
  const st = String(status).toUpperCase();
  if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(st)) return false;
  if (String(category).toUpperCase() === "DIFFERENCE") return false;
  return sed > 0;
}

/* Dashboard metric: SUBMITTED + RESUBMITTED + VERIFIED (all rows here). */
function dashboardCount(rows) {
  return rows.filter((r) =>
    ["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(String(r[0]).toUpperCase())
  ).length;
}

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
function section(t) {
  console.log(`\n${t}`);
  console.log("-".repeat(t.length));
}

function main() {
  console.log("=".repeat(72));
  console.log("Dashboard vs Approval list parity (MR-29/JUL-2026 case)");
  console.log("=".repeat(72));

  section("A — Mismatch reproduced on the old predicate");
  check("A. dashboard counts 7 actionable rows", dashboardCount(ROWS), 7);
  const oldListed = ROWS.filter(oldPendingListed).map((r) => r[2]);
  check("A. old PENDING list omits MR-29", oldListed.includes("MR-29"), false);
  check("A. old list count differs from dashboard", oldListed.length !== dashboardCount(ROWS), true);

  section("B — Fix present in the approval query");
  check(
    "B. non-DA arm accepts instance sebd rows",
    /ISNULL\(sed\.EmployeeCount, 0\) > 0\s+OR ISNULL\(sebd\.EmployeeCount, 0\) > 0/.test(approvalSrc),
    true
  );
  check("B. DA arm still requires dad rows", /ISNULL\(dad\.EmployeeCount, 0\) > 0/.test(approvalSrc), true);
  check("B. route still Account-Officer gated", /router\.get\("\/", accountOfficerOnly/.test(approvalSrc), true);
  check(
    "B. PENDING status set unchanged (SUBMITTED/RESUBMITTED/VERIFIED)",
    /UPPER\(w\.Status\) IN \(N'SUBMITTED', N'RESUBMITTED', N'VERIFIED'\)/.test(approvalSrc),
    true
  );

  section("C — New predicate: valid bills listed, others still excluded");
  const listed = ROWS.filter(pendingListed).map((r) => r[2]);
  check("C. canonical submitted listed", listed.includes("PLAN-10"), true);
  check("C. MR-29 non-canonical instance listed", listed.includes("MR-29"), true);
  check("C. genuinely empty submitted still hidden", listed.includes("EMPTY-1"), false);
  check("C. historic APPROVED salary bill hidden", listed.includes("PLAN-07"), false);
  check("C. RETURNED/REJECTED/DRAFT/LOCKED hidden", ["PLAN-13", "PLAN-14", "PLAN-16", "PLAN-18"].every((c) => !listed.includes(c)), true);
  check("C. DA without dad rows hidden", listed.includes("DDRS-01"), false);
  check("C. DA with dad rows listed", listed.includes("DDRS-02"), true);

  section("D — Workflow rules and dashboard untouched");
  check(
    "D. dashboard still counts SUBMITTED+RESUBMITTED+VERIFIED",
    /byStatus\.SUBMITTED[^;]*byStatus\.RESUBMITTED[^;]*byStatus\.VERIFIED/.test(dashboardSrc),
    true
  );
  check("D. no test-only status values introduced", !/MAGIC|FAKE_STATUS/.test(approvalSrc), true);

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main();
