/**
 * NPS Schedule No. persistence + Bill-Month isolation tests (A-I).
 *
 * Simulates dbo.SalaryBillInstituteWorkflow in memory with the same key the
 * route uses — (SalaryBillCodeId, InstituteCode) — and replays the exact
 * read/write the Salary Entry load and save paths perform, so the isolation
 * guarantee is proven rather than assumed.
 *
 * Runs offline. Usage: cd backend && npm run test:nps-schedule-no
 */

const fs = require("fs");
const path = require("path");

/* ===================== FIXTURE ===================== */

/* Two independent bills for the same Salary Month. */
const JUN_MASTER = { billCodeId: 100, billCode: "JUN-2026", billMonth: "JUN-2026" };
const MAY_VARIANT = { billCodeId: 101, billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026" };
const INSTITUTE = "OGE-05";
const OTHER_INSTITUTE = "CPD-25";

/* dbo.SalaryBillInstituteWorkflow, keyed (SalaryBillCodeId, InstituteCode). */
const workflowRows = new Map();
const key = (billCodeId, instituteCode) => `${billCodeId}|${instituteCode}`;

function ensureWorkflowRow(billCodeId, instituteCode, status = "DRAFT") {
  const k = key(billCodeId, instituteCode);
  if (!workflowRows.has(k)) {
    workflowRows.set(k, {
      SalaryBillCodeId: billCodeId,
      InstituteCode: instituteCode,
      Status: status,
      BillNo: null,
      BillDate: null,
      NPSScheduleNo: null,
    });
  }
  return workflowRows.get(k);
}

/** Mirrors the UPDATE in saveEmployeesHandler. */
function saveHeader({ billCodeId, instituteCode, billNo, billDate, npsScheduleNo, status }) {
  const row = ensureWorkflowRow(billCodeId, instituteCode);
  if (status) row.Status = status;
  row.BillNo = String(billNo || "").trim() || null;
  row.BillDate = billDate || null;
  row.NPSScheduleNo = String(npsScheduleNo || "").trim() || null;
  return row;
}

/** Mirrors the getInstituteWorkflow read in GET /employees. */
function loadHeader({ billCodeId, instituteCode }) {
  const row = workflowRows.get(key(billCodeId, instituteCode));
  return {
    billNo: row?.BillNo != null ? String(row.BillNo) : "",
    billDate: row?.BillDate || null,
    npsScheduleNo: row?.NPSScheduleNo != null ? String(row.NPSScheduleNo) : "",
    status: String(row?.Status || "DRAFT").toUpperCase(),
  };
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
  console.log("NPS Schedule No. — persistence and Bill-Month isolation");
  console.log("=".repeat(70));

  /* ---------------- A ---------------- */
  section("A — Save Draft then reload returns the same value");

  saveHeader({
    billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-1", billDate: "2026-05-31",
    npsScheduleNo: "NPS-MAY-001", status: "DRAFT",
  });
  check("A. reload gives the saved schedule",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    "NPS-MAY-001");
  check("A. bill no is untouched by the change",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE }).billNo, "B-1");

  /* ---------------- B ---------------- */
  section("B — Submit preserves the value");

  saveHeader({
    billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-1", billDate: "2026-05-31",
    npsScheduleNo: "NPS-MAY-001", status: "SUBMITTED",
  });
  const afterSubmit = loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE });
  check("B. schedule survives submit", afterSubmit.npsScheduleNo, "NPS-MAY-001");
  check("B. status advanced to SUBMITTED", afterSubmit.status, "SUBMITTED");

  /* ---------------- C ---------------- */
  section("C — Two bills, two schedules, same Salary Month");

  saveHeader({
    billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-9", billDate: "2026-06-30",
    npsScheduleNo: "SCHEDULE-A", status: "LOCKED",
  });
  saveHeader({
    billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-1", billDate: "2026-05-31",
    npsScheduleNo: "SCHEDULE-B", status: "SUBMITTED",
  });

  check("C. JUN-2026 shows SCHEDULE-A",
    loadHeader({ billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    "SCHEDULE-A");
  check("C. JUN-2026-BM-MAY shows SCHEDULE-B",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    "SCHEDULE-B");
  check("C. the two values differ",
    loadHeader({ billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo !==
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    true);

  /* ---------------- D ---------------- */
  section("D — Returned bill reopens with its own schedule");

  const returned = ensureWorkflowRow(MAY_VARIANT.billCodeId, INSTITUTE);
  returned.Status = "RETURNED";                       /* AO returns the MAY bill */
  const reopened = loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE });
  check("D. auditor sees SCHEDULE-B", reopened.npsScheduleNo, "SCHEDULE-B");
  check("D. status is RETURNED", reopened.status, "RETURNED");
  check("D. it is NOT blank", reopened.npsScheduleNo !== "", true);

  /* ---------------- E ---------------- */
  section("E — Auditor edits the schedule and resubmits");

  saveHeader({
    billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-1", billDate: "2026-05-31",
    npsScheduleNo: "SCHEDULE-C", status: "RESUBMITTED",
  });
  const afterEdit = loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE });
  check("E. updated to SCHEDULE-C", afterEdit.npsScheduleNo, "SCHEDULE-C");
  check("E. status is RESUBMITTED", afterEdit.status, "RESUBMITTED");
  check("E. the JUN master still shows SCHEDULE-A",
    loadHeader({ billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    "SCHEDULE-A");

  /* ---------------- F ---------------- */
  section("F — The MAY bill never reads the JUN master's schedule");

  check("F. MAY value is its own", afterEdit.npsScheduleNo, "SCHEDULE-C");
  check("F. MAY is not the master's value", afterEdit.npsScheduleNo !== "SCHEDULE-A", true);

  /* A variant with no saved value must come back blank, not inherit. */
  ensureWorkflowRow(MAY_VARIANT.billCodeId, OTHER_INSTITUTE);
  check("F. another institute on the same bill starts blank",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: OTHER_INSTITUTE }).npsScheduleNo,
    "");
  check("F. and does not inherit OGE-05's value",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: OTHER_INSTITUTE }).npsScheduleNo !== "SCHEDULE-C",
    true);

  /* Requirement 8: blank stays blank. */
  saveHeader({
    billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
    billNo: "B-1", billDate: "2026-05-31", npsScheduleNo: "", status: "RESUBMITTED",
  });
  check("F. a deliberately cleared schedule stays cleared",
    loadHeader({ billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo, "");
  check("F. clearing MAY did not touch the JUN master",
    loadHeader({ billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE }).npsScheduleNo,
    "SCHEDULE-A");
  check("F. whitespace-only is treated as blank",
    (saveHeader({
      billCodeId: MAY_VARIANT.billCodeId, instituteCode: INSTITUTE,
      billNo: "B-1", billDate: null, npsScheduleNo: "   ",
    }).NPSScheduleNo),
    null);

  /* ---------------- G ---------------- */
  section("G — No salary value or formula was touched");

  const entrySrc = read("routes/salaryEntry.js");
  for (const col of ["IncomeTax", "ProfessionalTax", "OtherDeduction", "NPSManual"]) {
    check(`G. ${col} is still persisted`,
      new RegExp(`${col}\\s*=\\s*\\$\\{`).test(entrySrc), true);
  }
  check("G. manual NPS preservation rule intact",
    /preserveSavedNps\s*=\s*[\s\S]{0,80}npsManual/.test(entrySrc), true);
  check("G. cheque amount still uses the shared helper",
    entrySrc.includes("calculateChequeAmount"), true);
  /* Every SQL write of the column must target SalaryBillInstituteWorkflow —
     never SalaryEmployeeDetails or SalaryBillCodes. */
  const scheduleWriteTables = [];
  for (const m of entrySrc.matchAll(/NPSScheduleNo\s*=\s*\$\{/g)) {
    const before = entrySrc.slice(0, m.index);
    const tables = [...before.matchAll(/(?:UPDATE|INSERT\s+INTO)\s+dbo\.(\w+)/g)];
    scheduleWriteTables.push(tables.length ? tables[tables.length - 1][1] : "(none)");
  }
  check("G. the only SQL write targets SalaryBillInstituteWorkflow",
    scheduleWriteTables, ["SalaryBillInstituteWorkflow"]);
  check("G. never written to SalaryEmployeeDetails",
    scheduleWriteTables.includes("SalaryEmployeeDetails"), false);
  check("G. never written to SalaryBillCodes",
    scheduleWriteTables.includes("SalaryBillCodes"), false);

  /* ---------------- H ---------------- */
  section("H — Same-month LOCKED bill remains protected");

  check("H. the JUN master is LOCKED",
    loadHeader({ billCodeId: JUN_MASTER.billCodeId, instituteCode: INSTITUTE }).status, "LOCKED");
  check("H. statusGateBill still exists in the entry route",
    entrySrc.includes("statusGateBill"), true);
  check("H. save still gates on the exact resolved bill",
    /assertBillEditable\(statusGateBill\(resolved\)\)/.test(entrySrc), true);

  /* ---------------- I ---------------- */
  section("I — Storage follows the existing design, no duplication");

  const migration = read("sql/schema/45_SalaryBillInstituteWorkflow_NPSScheduleNo.sql");
  check("I. column added to SalaryBillInstituteWorkflow",
    /ALTER TABLE dbo\.SalaryBillInstituteWorkflow[\s\S]{0,60}ADD NPSScheduleNo/.test(migration), true);
  check("I. guarded by COL_LENGTH (idempotent)",
    /COL_LENGTH\(N'dbo\.SalaryBillInstituteWorkflow', N'NPSScheduleNo'\) IS NULL/.test(migration), true);
  check("I. migration drops nothing", /DROP\s+(TABLE|COLUMN)/i.test(migration), false);
  check("I. no new table is created", /CREATE TABLE/i.test(migration), false);

  /* Exactly one storage location across the whole backend. */
  const backendFiles = ["routes/salaryEntry.js", "routes/salaryBillApproval.js",
                        "utils/salaryBillInstituteWorkflow.js"];
  const writers = backendFiles.filter((f) => /NPSScheduleNo\s*=\s*\$\{/.test(read(f)));
  check("I. exactly one writer of the column", writers, ["routes/salaryEntry.js"]);

  /* Wiring: sent by both save paths and restored on load. */
  const uiSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8"
  );
  check("I. frontend sends it twice (Save Draft + Submit)",
    (uiSrc.match(/npsScheduleNo:\s*npsScheduleNo\.trim\(\)/g) || []).length, 2);
  check("I. frontend restores it on load",
    /result\?\.bill\?\.npsScheduleNo\s*!=\s*null/.test(uiSrc), true);
  check("I. backend returns it on load",
    /npsScheduleNo:\s*entryNpsScheduleNo/.test(entrySrc), true);
  check("I. backend reads it from the request",
    /req\.body\?\.npsScheduleNo/.test(entrySrc), true);
  check("I. write is scoped to the exact bill + institute",
    /NPSScheduleNo = \$\{npsScheduleNo \|\| null\}[\s\S]{0,300}WHERE SalaryBillCodeId = \$\{Number\(bill\.BillCodeId\)\}[\s\S]{0,120}AND InstituteCode/.test(entrySrc),
    true);

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
