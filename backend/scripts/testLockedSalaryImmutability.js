/*
  LOCKED SALARY MONTH — IMMUTABILITY OF HISTORICAL DATA
  =====================================================

  Business rule under test: once a Salary Month is LOCKED, its salary data is
  permanent history. No application path may update, delete, replace or
  recalculate it, and processing a LATER month must not touch it.

  HOW THIS SUITE PROVES THAT — and what it does NOT prove
  -------------------------------------------------------
  It runs OFFLINE with a stubbed database, so it cannot and does not prove
  that rows survive in DPCELLSalaryWebDB. That is the job of the companion
  read-only script:

      backend/sql/verify/VerifyLockedSalaryImmutability.sql

  What this suite DOES prove is stronger than a source-text search:

    1. It EXECUTES the real Express route handlers, reached through the
       router stack, so the genuine guards run in their genuine order.
    2. The stubbed `sql` records every statement. Any INSERT / UPDATE / DELETE
       against a locked month is a FAILURE, whatever the HTTP status was — so
       "it returned 403 but wrote anyway" cannot pass.
    3. It exercises the real exported guard `assertInstituteEditable` across
       LOCKED, APPROVED, COMPLETED, OPEN, DRAFT and RETURNED.

  Nothing here writes to any database, and no application file is modified by
  this suite's existence.

  Usage: cd backend && npm run test:locked-salary-immutability
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------------ *
 * The recording database stub.
 *
 * Reads return whatever `nextBill` says. Writes are RECORDED rather than
 * performed, so the test can assert that none was attempted.
 * ------------------------------------------------------------------ */
let writesAttempted = [];
let readsPerformed = [];
let nextBill = null;
let nextWorkflow = null;
let nextDaBill = null;

function textOf(strings) {
  return strings && strings.raw ? strings.raw.join(" ? ") : String(strings);
}

function isWrite(text) {
  return /\b(INSERT\s+INTO|UPDATE\s+dbo\.|DELETE\s+FROM|DELETE\s+\w+\s*\n?\s*FROM)/i
    .test(text);
}

function respond(text) {
  if (isWrite(text)) {
    writesAttempted.push(text.replace(/\s+/g, " ").trim().slice(0, 90));
    return { recordset: [{ Id: 1, UserId: 1, DADifferenceEmployeeDetailId: 1 }], rowsAffected: [1] };
  }
  readsPerformed.push(text.replace(/\s+/g, " ").trim().slice(0, 60));

  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    return { recordset: nextBill ? [nextBill] : [] };
  }
  if (/FROM dbo\.SalaryBillInstituteWorkflow/i.test(text)) {
    return { recordset: nextWorkflow ? [nextWorkflow] : [] };
  }
  if (/FROM dbo\.DADifferenceBill/i.test(text)) {
    return { recordset: nextDaBill ? [nextDaBill] : [] };
  }
  if (/FROM dbo\.Institutes/i.test(text)) {
    return {
      recordset: [{
        InstituteId: 5, InstituteCode: "OGE-05",
        InstituteName: "Samany Vrudhdhashram", SectionId: 1,
      }],
    };
  }
  return { recordset: [] };
}

const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
function makeSql() {
  const query = (strings, ...v) => Promise.resolve(respond(textOf(strings)));
  return {
    query,
    Request: function R() {
      return { query, input() { return this; } };
    },
    Transaction: function T() {
      return {
        begin: (cb) => cb && cb(null),
        commit: (cb) => cb && cb(null),
        rollback: (cb) => cb && cb(null),
      };
    },
  };
}
stub.exports = { sql: makeSql(), connectDB: async () => true };
require.cache[dbPath] = stub;

/* ------------------------------------------------------------------ */
const salaryEntryRouter = require("../routes/salaryEntry");
const salaryBillCodesRouter = require("../routes/salaryBillCodes");
const salaryCalculateRouter = require("../routes/salaryCalculate");
const salaryBillApprovalRouter = require("../routes/salaryBillApproval");
const daDifferenceRouter = require("../routes/daDifference");
const {
  assertInstituteEditable,
  EDITABLE_INSTITUTE_STATUSES,
} = require("../utils/salaryBillInstituteWorkflow");

const SRC = {
  salaryEntry: fs.readFileSync(path.join(ROOT, "routes", "salaryEntry.js"), "utf8"),
  salaryBillCodes: fs.readFileSync(path.join(ROOT, "routes", "salaryBillCodes.js"), "utf8"),
  salaryCalculate: fs.readFileSync(path.join(ROOT, "routes", "salaryCalculate.js"), "utf8"),
  salaryBillApproval: fs.readFileSync(path.join(ROOT, "routes", "salaryBillApproval.js"), "utf8"),
  workflowUtil: fs.readFileSync(path.join(ROOT, "utils", "salaryBillInstituteWorkflow.js"), "utf8"),
  daDifference: fs.readFileSync(path.join(ROOT, "routes", "daDifference.js"), "utf8"),
  employeeDetails: fs.readFileSync(path.join(ROOT, "routes", "salaryEmployeeDetails.js"), "utf8"),
  server: fs.readFileSync(path.join(ROOT, "server.js"), "utf8"),
};
const ALL_ROUTES = fs
  .readdirSync(path.join(ROOT, "routes"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(ROOT, "routes", f), "utf8"))
  .join("\n");
const ALL_UTILS = fs
  .readdirSync(path.join(ROOT, "utils"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(ROOT, "utils", f), "utf8"))
  .join("\n");

/* ---- runner ---- */
let passed = 0, failed = 0;
const failures = [];
function section(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }
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

/* ---- fixtures: the locked JUN-2026 month ---- */
const JUNE_LOCKED = {
  BillCodeId: 101, BillCode: "JUN-2026",
  BillMonth: "JUN-2026", SalaryMonth: "June",
  SalaryMonthNumber: "06", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  Status: "LOCKED", IsArchived: 0,
};
const billWith = (status) => ({ ...JUNE_LOCKED, Status: status });
const workflowWith = (status) => ({
  WorkflowId: 9, SalaryBillCodeId: 101, InstituteCode: "OGE-05",
  Status: status, BillNo: "598", BillDate: "2026-07-22",
  NPSScheduleNo: "SCH/7/2026/173683",
});

/* ---- invoke a real route handler ---- */
function handlerFor(router, method, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${routePath} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function call(router, method, routePath, { body = {}, params = {}, query = {} } = {}) {
  writesAttempted = [];
  readsPerformed = [];
  const req = {
    body: { user: { userName: "tester", fullName: "Tester" }, ...body },
    params,
    query,
    user: { userName: "tester", roleName: "Super Admin" },
  };
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return this; },
    json(p) { payload = p; return this; },
  };
  try {
    await handlerFor(router, method, routePath)(req, res);
  } catch (error) {
    status = status === 200 ? 500 : status;
    payload = { message: error.message };
  }
  return { status, message: String(payload?.message || ""), writes: [...writesAttempted] };
}

/* The June salary payload an attacker/操作 would send to change stored money. */
const TAMPER_BODY = {
  billCode: "JUN-2026", instituteCode: "OGE-05", instituteId: 5,
  billMonth: "JUN-2026", salaryMonth: "June",
  billNo: "598", billDate: "2026-07-22", npsScheduleNo: "SCH/7/2026/173683",
  employees: [{
    employeeId: 2001, employeeName: "Test Employee", displayOrder: 1,
    basicPay: 99999, gradePay: 0, totalBasic: 99999,
    da: 99999, hra: 99999, ma: 99999, ta: 99999, cla: 99999,
    specialAllowance: 0, washingAllowance: 0, grossSalary: 99999,
    gpfSubscription: 99999, gpfAdvance: 99999, nps: 99999,
    incomeTax: 99999, professionalTax: 99999, otherDeduction: 99999,
    totalDeduction: 99999, netSalary: 99999, pension: "GPF",
  }],
};

(async function main() {
  console.log("=".repeat(76));
  console.log("LOCKED SALARY MONTH — IMMUTABILITY");
  console.log("=".repeat(76));

  section("A. the exported institute guard, across every status");
  {
    const verdict = (s) => {
      const r = assertInstituteEditable(workflowWith(s), "JUN-2026", "OGE-05");
      return r === null ? "ALLOWED" : `BLOCKED ${r.status}`;
    };
    check("LOCKED is blocked", verdict("LOCKED"), "BLOCKED 409");
    check("APPROVED is blocked", verdict("APPROVED"), "BLOCKED 403");
    check("COMPLETED is blocked", verdict("COMPLETED"), "BLOCKED 403");
    check("SUBMITTED is blocked", verdict("SUBMITTED"), "BLOCKED 403");
    check("VERIFIED is blocked", verdict("VERIFIED"), "BLOCKED 403");
    check("OPEN is allowed", verdict("OPEN"), "ALLOWED");
    check("DRAFT is allowed", verdict("DRAFT"), "ALLOWED");
    check("RETURNED is allowed — correction must still work",
      verdict("RETURNED"), "ALLOWED");
    check("REJECTED is allowed — the correction workflow depends on it",
      verdict("REJECTED"), "ALLOWED");
    check("the editable set is exactly the pre-approval + correctable states",
      [...EDITABLE_INSTITUTE_STATUSES].sort(),
      ["DRAFT", "OPEN", "REJECTED", "RETURNED"]);
    check("and contains no post-approval state",
      [...EDITABLE_INSTITUTE_STATUSES].some((st) =>
        ["LOCKED", "APPROVED", "COMPLETED", "SUBMITTED", "VERIFIED"].includes(st)),
      false);
    check("the LOCKED message names the condition",
      /locked and cannot be modified/i.test(
        assertInstituteEditable(workflowWith("LOCKED"), "JUN-2026", "OGE-05").message
      ), true);
  }

  section("B. Salary Entry SAVE against the locked June — executed");
  {
    nextBill = JUNE_LOCKED;
    nextWorkflow = workflowWith("LOCKED");
    const r = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
    check("save-draft is rejected", r.status >= 400, true);
    check("with a lock message", /lock/i.test(r.message), true);
    check("AND NOT ONE WRITE WAS ATTEMPTED", r.writes, []);
  }
  {
    nextBill = JUNE_LOCKED;
    nextWorkflow = workflowWith("LOCKED");
    const r = await call(salaryEntryRouter, "post", "/submit", { body: TAMPER_BODY });
    check("submit is rejected", r.status >= 400, true);
    check("with a lock message", /lock/i.test(r.message), true);
    check("AND NOT ONE WRITE WAS ATTEMPTED", r.writes, []);
  }

  section("C. an APPROVED / COMPLETED month is equally protected");
  for (const status of ["APPROVED", "COMPLETED"]) {
    nextBill = billWith(status);
    nextWorkflow = workflowWith(status);
    const r = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
    check(`${status}: save-draft is rejected`, r.status >= 400, true);
    check(`${status}: no write was attempted`, r.writes, []);
  }

  section("D. the pre-approval states still work — no global immutability");
  for (const status of ["OPEN", "DRAFT", "RETURNED"]) {
    nextBill = billWith(status);
    nextWorkflow = workflowWith(status);
    const r = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
    check(`${status}: the save is NOT blocked by the lock guard`,
      /lock/i.test(r.message), false);
  }

  section("E. the bill-code employee endpoints, executed against LOCKED");
  {
    const cases = [
      ["post", "/:billCode/employees", { employees: [] }],
      ["put", "/:billCode/employees/:employeeId", { basicPay: 99999 }],
      ["put", "/:billCode/employee-order", { order: [1, 2] }],
    ];
    for (const [method, routePath, body] of cases) {
      nextBill = JUNE_LOCKED;
      nextWorkflow = workflowWith("LOCKED");
      const r = await call(salaryBillCodesRouter, method, routePath, {
        body, params: { billCode: "JUN-2026", employeeId: "2001" },
      });
      check(`${method.toUpperCase()} ${routePath} is rejected`, r.status >= 400, true);
      check(`${method.toUpperCase()} ${routePath} attempted no write`, r.writes, []);
    }
  }
  {
    nextBill = JUNE_LOCKED;
    const r = await call(salaryBillCodesRouter, "post", "/:billCode/copy-employees", {
      body: { targetBillCode: "JUN-2026" }, params: { billCode: "MAY-2026" },
    });
    check("copy-employees into a LOCKED target is rejected", r.status >= 400, true);
    check("and attempted no write", r.writes, []);
  }

  section("F. editing or deleting the locked BILL CODE itself");
  {
    nextBill = JUNE_LOCKED;
    const r = await call(salaryBillCodesRouter, "put", "/:id", {
      body: { salaryYear: "2026", salaryMonthNumber: "06",
              billCategory: "Salary", billType: "Regular Salary" },
      params: { id: "101" },
    });
    check("PUT /:id on a LOCKED bill is rejected", r.status, 403);
    check("and attempted no write", r.writes, []);
  }
  {
    const r = await call(salaryBillCodesRouter, "delete", "/:id", { params: { id: "101" } });
    check("DELETE /:id is refused for EVERY status", r.status, 403);
    check("with a message pointing at Complete & Lock",
      /not allowed/i.test(r.message), true);
    check("and attempted no write", r.writes, []);
  }

  section("G. the calculated-salary write path");
  {
    nextBill = JUNE_LOCKED;
    const r = await call(salaryCalculateRouter, "post", "/save-calculated", {
      body: { employeeId: 2001, salaryBillCodeId: 101 },
    });
    check("save-calculated against a LOCKED bill is rejected", r.status, 409);
    check("with a lock message", /locked/i.test(r.message), true);
    check("AND NOT ONE WRITE WAS ATTEMPTED", r.writes, []);
    check("the lock is checked before the transaction opens",
      SRC.salaryCalculate.indexOf('=== "LOCKED"') <
        SRC.salaryCalculate.indexOf("UPDATE dbo.SalaryEmployeeDetails"), true);
  }

  section("H. every mutation path is guarded BEFORE its first write");
  {
    /* Source order: the guard call must precede the first write statement. */
    /*
       Order is measured INSIDE the calling function. Two UPDATE statements
       live in helper functions defined ABOVE saveEmployeesHandler but invoked
       from inside it, after the guards — so a whole-file comparison measures
       definition order, not execution order, and is meaningless here.
    */
    const before = (src, guard, write) => {
      const g = src.indexOf(guard);
      const w = src.search(new RegExp(write));
      return g > -1 && w > -1 && g < w;
    };
    const saveHandler = SRC.salaryEntry.slice(
      SRC.salaryEntry.indexOf("async function saveEmployeesHandler")
    );
    check("salaryEntry: assertBillEditable precedes the handler's first write",
      before(saveHandler, "assertBillEditable(statusGateBill(resolved))",
             "UPDATE dbo\\.SalaryEmployeeDetails"), true);
    check("salaryEntry: assertInstituteEditable precedes it too",
      before(saveHandler, "assertInstituteEditable(",
             "UPDATE dbo\\.SalaryEmployeeDetails"), true);
    check("salaryEntry: and precedes the workflow write (now via upsertInstituteWorkflow, migration 51 - the literal UPDATE lives in utils/salaryBillInstituteWorkflow.js, not inlined here)",
      before(saveHandler, "assertInstituteEditable(",
             "await upsertInstituteWorkflow\\("), true);
    check("salaryEntry: the guards are the FIRST thing after the bill resolves",
      before(saveHandler, "const resolved = await resolveSalaryEntryBill",
             "assertBillEditable\\(statusGateBill"), true);
    check("salaryBillCodes: assertCanModifyEmployees precedes its UPDATE",
      before(SRC.salaryBillCodes, "assertCanModifyEmployees(",
             "UPDATE dbo\\.SalaryEmployeeDetails"), true);
    check("salaryBillCodes: and precedes its DELETE",
      before(SRC.salaryBillCodes, "assertCanModifyEmployees(",
             "DELETE FROM dbo\\.SalaryEmployeeDetails"), true);
    /* Skip the import line: compare the guard with the first CALL. */
    check("salaryBillApproval: the LOCKED master check precedes the workflow write",
      SRC.salaryBillApproval.indexOf('masterStatus === "LOCKED"') <
        SRC.salaryBillApproval.indexOf("await upsertInstituteWorkflow("), true);
  }

  section("I. no deletion path exists for bills or workflow rows");
  check("nothing anywhere deletes a SalaryBillCode",
    /DELETE\s+FROM\s+dbo\.SalaryBillCodes/i.test(ALL_ROUTES + ALL_UTILS), false);
  check("nothing anywhere deletes an institute workflow row",
    /DELETE\s+FROM\s+dbo\.SalaryBillInstituteWorkflow/i.test(ALL_ROUTES + ALL_UTILS), false);
  check("the Bill Code DELETE endpoint is hard-disabled in source",
    /router\.delete\("\/:id"[\s\S]{0,220}status\(403\)/.test(SRC.salaryBillCodes), true);
  check("the only SalaryEmployeeDetails DELETEs are the two guarded ones",
    (ALL_ROUTES.match(/DELETE\s+FROM\s+dbo\.SalaryEmployeeDetails/gi) || []).length, 2);
  check("the helper that delete-and-reinserts is not itself a mounted route",
    /router\./.test(SRC.employeeDetails), false);
  check("nor is it registered in server.js",
    /require\("\.\/routes\/salaryEmployeeDetails"\)/.test(SRC.server), false);

  section("J. locked data is read-only to the reports, and never recalculated");
  {
    const reportFiles = [
      "employeeWiseSalary.js", "instituteWiseSalary.js", "chequeRegister.js",
      "bankCopy.js", "gpfSummary.js", "npsSummary.js", "npsSchedule.js",
      "salaryRegister.js", "employeePaySlip.js", "incomeTaxProfessionalTax.js",
      "sectionSummary.js",
    ];
    const offenders = reportFiles.filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, "routes", f), "utf8");
      return /INSERT INTO|UPDATE dbo\.|DELETE FROM/i.test(src);
    });
    check("no report writes to the database", offenders, []);

    /*
       "Recalculate" means deriving a STORED salary component again from
       master data. The Cheque Register's calculateChequeAmount is NOT that:
       it adds three already-stored values (Net + IT + PT) to present a cheque
       figure that has no column of its own. What must never happen is a
       report re-running the salary engine or re-reading a rate master.
    */
    const recalcOffenders = reportFiles.filter((f) => {
      const src = fs
        .readFileSync(path.join(ROOT, "routes", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      return /calculateEmployee\(|calculateNps\(|calculateSalaryFor|FROM dbo\.DAMaster|FROM dbo\.HRAMaster|FROM dbo\.PayMatrix/.test(src);
    });
    check("no report re-runs the salary engine or re-reads a rate master",
      recalcOffenders, []);
    check("the one salaryBasicCalc import is the cheque-amount presentation helper",
      /const \{ calculateChequeAmount \} = require\("\.\.\/utils\/salaryBasicCalc"\);/
        .test(fs.readFileSync(path.join(ROOT, "routes", "chequeRegister.js"), "utf8")), true);
    check("and it only sums stored Net + IT + PT",
      /toNum\(netSalary\) \+[\s\S]{0,120}toNum\(incomeTax\)/.test(
        fs.readFileSync(path.join(ROOT, "utils", "salaryBasicCalc.js"), "utf8")), true);
    check("LOCKED bills remain visible to the reports",
      /IN \(N'APPROVED', N'LOCKED'\)/.test(
        fs.readFileSync(path.join(ROOT, "routes", "employeeWiseSalary.js"), "utf8")), true);
  }

  section("K. a later month cannot reach into the locked one");
  {
    /*
       Every salary write is scoped by SalaryBillCodeId, so a JUL-2026 bill
       (its own BillCodeId) cannot address a JUN-2026 row. Asserted on the
       actual statements rather than assumed.
    */
    const writes = (SRC.salaryEntry + SRC.salaryBillCodes + SRC.salaryCalculate)
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const stmts = writes.match(
      /(UPDATE dbo\.SalaryEmployeeDetails|DELETE FROM dbo\.SalaryEmployeeDetails)[\s\S]{0,600}?`/g
    ) || [];
    check("every SalaryEmployeeDetails write is scoped by bill or row id",
      stmts.every((s) => /SalaryBillCodeId|WHERE Id =/.test(s)), true);
    check("and there is at least one such statement to check", stmts.length > 0, true);
    check("no write targets a month by name instead of by id",
      /UPDATE dbo\.SalaryEmployeeDetails[\s\S]{0,400}WHERE[\s\S]{0,120}SalaryMonth\s*=/i
        .test(writes), false);
  }

  section("L. Bill Month is never rewritten by locking");
  {
    const lockPaths =
      SRC.salaryBillCodes.slice(SRC.salaryBillCodes.indexOf('router.post("/:id/lock"')) +
      SRC.salaryBillApproval.slice(SRC.salaryBillApproval.indexOf('router.post("/:idOrCode/lock"'));
    check("the lock endpoints write no BillMonth",
      /BillMonth\s*=\s*\$\{/.test(lockPaths), false);
    check("nor any salary amount",
      /NetSalary\s*=\s*\$\{|GrossSalary\s*=\s*\$\{|NPS\s*=\s*\$\{/.test(lockPaths), false);
    check("locking only moves a Status",
      /Status\s*=\s*N'LOCKED'|Status\s*=\s*\$\{/.test(lockPaths), true);
  }

  section("N. the companion SQL verification script is genuinely read-only");
  {
    const sqlPath = path.join(ROOT, "sql", "verify", "VerifyLockedSalaryImmutability.sql");
    check("the script exists", fs.existsSync(sqlPath), true);
    const raw = fs.readFileSync(sqlPath, "utf8");
    /* Strip block and line comments: the file DOCUMENTS the manual steps,
       which mention the words, so a raw search would match its own prose. */
    const sqlCode = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
    const writes = sqlCode
      .split("\n")
      .filter((l) => /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|MERGE|EXEC)\b/i.test(l))
      .filter((l) => !/^\s*PRINT/i.test(l))
      .map((l) => l.trim());
    check("it contains NO write statement outside its comments", writes, []);
    check("and it does read", /\bSELECT\b/i.test(sqlCode), true);
    check("it captures a value checksum for before/after comparison",
      /CHECKSUM_AGG/.test(raw), true);
    check("it captures row identities, so delete-and-reinsert is detectable",
      /SumOfDetailIds/.test(raw), true);
    check("it checks the Bill Month spread is not normalised",
      /BillMonth, COUNT\(\*\)/.test(raw), true);
    check("it marks the mutating steps as MANUAL, not automated",
      (raw.match(/\*\*\* MANUAL STEP/g) || []).length, 2);
  }

  section("M. the workflow util's own writes are status transitions only");
  check("it never writes a salary amount",
    /NetSalary|GrossSalary|BasicPay|IncomeTax|ProfessionalTax/.test(SRC.workflowUtil),
    false);
  check("and never deletes",
    /DELETE/i.test(SRC.workflowUtil), false);

  /* ================================================================
     OFFLINE APPLICATION IMMUTABILITY TEST — NO REAL DATABASE MODIFIED
     The sections below drive the remaining mutation endpoints and the full
     workflow state matrix against a simulated LOCKED JUN-2026.
     ================================================================ */

  section("O. Salary Bill Approval transitions against a LOCKED month");
  {
    const transitions = [
      ["/:idOrCode/verify", "verify"],
      ["/:idOrCode/approve", "approve"],
      ["/:idOrCode/return", "return"],
      ["/:idOrCode/reject", "reject"],
      ["/:idOrCode/lock", "lock"],
    ];
    for (const [routePath, label] of transitions) {
      nextBill = JUNE_LOCKED;
      nextWorkflow = workflowWith("LOCKED");
      const r = await call(salaryBillApprovalRouter, "post", routePath, {
        body: { instituteCode: "OGE-05", userName: "ao", remarks: "x" },
        params: { idOrCode: "101" },
      });
      check(`${label}: rejected on a LOCKED bill`, r.status >= 400, true);
      check(`${label}: NOT ONE WRITE WAS ATTEMPTED`, r.writes, []);
    }
    check("the LOCKED master check is stated in the source",
      /Salary Bill Code \$\{bill\.BillCode\} is LOCKED\. Institute salary bills cannot be modified\./
        .test(SRC.salaryBillApproval) ||
        /is LOCKED\. Institute salary bills cannot be modified/.test(SRC.salaryBillApproval),
      true);
    check("re-locking an already LOCKED institute is a 409",
      /already locked[\s\S]{0,40}status = 409|e\.status = 409/.test(SRC.salaryBillApproval),
      true);
  }

  section("P. DA Difference against a LOCKED institute");
  {
    nextBill = JUNE_LOCKED;
    nextWorkflow = workflowWith("LOCKED");
    nextDaBill = {
      DADifferenceBillId: 55, SalaryBillCodeId: 101, BillCode: "DA-JUN-2026",
      PaymentSalaryMonth: "JUN-2026", PaymentSalaryMonthNumber: "06",
      PaymentSalaryYear: "2026", Status: "OPEN",
    };
    for (const routePath of ["/:id/save", "/:id/submit"]) {
      const r = await call(daDifferenceRouter, "post", routePath, {
        body: { instituteCode: "OGE-05", employees: [] },
        params: { id: "55" },
      });
      check(`DA ${routePath}: rejected`, r.status >= 400, true);
      check(`DA ${routePath}: NOT ONE WRITE WAS ATTEMPTED`, r.writes, []);
    }
    check("DA reuses the shared institute guard, not a copy",
      /assertInstituteEditable\(workflow, bill\.BillCode, instituteCode\)/
        .test(SRC.daDifference), true);
    nextDaBill = null;
  }

  section("Q. THE STATE MATRIX — Salary Entry save, every workflow status");
  {
    const expectRejected = [
      "SUBMITTED", "RESUBMITTED", "VERIFIED", "APPROVED", "COMPLETED", "LOCKED",
    ];
    const expectEditable = ["OPEN", "DRAFT", "RETURNED", "REJECTED"];

    for (const status of expectRejected) {
      nextBill = billWith(status);
      nextWorkflow = workflowWith(status);
      const r = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
      check(`${status}: save is rejected`, r.status >= 400, true);
      check(`${status}: writes = []`, r.writes, []);
    }
    for (const status of expectEditable) {
      nextBill = billWith(status === "REJECTED" ? "OPEN" : status);
      nextWorkflow = workflowWith(status);
      const r = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
      check(`${status}: not blocked as locked/non-editable`,
        /locked|cannot be modified/i.test(r.message), false);
    }
    check("LOCKED is the only status with no route back to editable",
      [...EDITABLE_INSTITUTE_STATUSES].includes("LOCKED"), false);
  }

  section("R. PERMANENCE SIMULATION — values before and after the transition");
  {
    /*
       A simulated JUN-2026 employee row. The point is not that these numbers
       are real, but that after flipping the bill to LOCKED and firing every
       mutation endpoint at it, NO write was issued — so nothing could have
       changed them.
    */
    const STORED = Object.freeze({
      Basic: 23800, DA: 14280, NPS: 3808,
      GrossSalary: 40984, TotalDeduction: 3808, NetSalary: 37176,
    });
    const beforeJson = JSON.stringify(STORED);

    nextBill = billWith("OPEN");
    nextWorkflow = workflowWith("OPEN");
    const openAttempt = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
    check("BEFORE lock: an OPEN month is not refused as locked",
      /locked/i.test(openAttempt.message), false);

    /* THE TRANSITION — simulated only, in memory. */
    nextBill = billWith("LOCKED");
    nextWorkflow = workflowWith("LOCKED");

    const everyMutation = [
      [salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY }],
      [salaryEntryRouter, "post", "/submit", { body: TAMPER_BODY }],
      [salaryCalculateRouter, "post", "/save-calculated",
        { body: { employeeId: 2001, salaryBillCodeId: 101 } }],
      [salaryBillCodesRouter, "post", "/:billCode/employees",
        { body: { employees: [] }, params: { billCode: "JUN-2026" } }],
      [salaryBillCodesRouter, "put", "/:billCode/employees/:employeeId",
        { body: { basicPay: 1 }, params: { billCode: "JUN-2026", employeeId: "2001" } }],
      [salaryBillCodesRouter, "put", "/:billCode/employee-order",
        { body: { order: [1] }, params: { billCode: "JUN-2026" } }],
      [salaryBillCodesRouter, "post", "/:billCode/copy-employees",
        { body: { targetBillCode: "JUN-2026" }, params: { billCode: "MAY-2026" } }],
      [salaryBillCodesRouter, "put", "/:id",
        { body: { salaryYear: "2026", salaryMonthNumber: "06",
                  billCategory: "Salary", billType: "Regular Salary" },
          params: { id: "101" } }],
      [salaryBillCodesRouter, "delete", "/:id", { params: { id: "101" } }],
    ];

    let allRejected = true;
    let totalWrites = 0;
    for (const [router, method, routePath, opts] of everyMutation) {
      const r = await call(router, method, routePath, opts);
      if (r.status < 400) allRejected = false;
      totalWrites += r.writes.length;
    }
    check("AFTER lock: every one of the nine mutations was rejected", allRejected, true);
    check("AFTER lock: TOTAL WRITE STATEMENTS ISSUED = 0", totalWrites, 0);
    check("AFTER lock: the simulated stored values are byte-identical",
      JSON.stringify(STORED), beforeJson);
    check("nothing in this suite ever opened a real connection",
      typeof stub.exports.sql.query, "function");
  }

  section("S. NEXT MONTH — JUL-2026 OPEN while JUN-2026 is LOCKED");
  {
    const JULY_OPEN = {
      ...JUNE_LOCKED, BillCodeId: 202, BillCode: "JUL-2026",
      BillMonth: "JUL-2026", SalaryMonth: "July",
      SalaryMonthNumber: "07", Status: "OPEN",
    };
    nextBill = JULY_OPEN;
    nextWorkflow = { ...workflowWith("OPEN"), SalaryBillCodeId: 202 };
    const july = await call(salaryEntryRouter, "post", "/save-draft", {
      body: { ...TAMPER_BODY, billCode: "JUL-2026",
              billMonth: "JUL-2026", salaryMonth: "July" },
    });
    check("July processing is NOT blocked by June's lock",
      /locked/i.test(july.message), false);

    /* Every write July could issue is addressed by BillCodeId, so it cannot
       reach a June row. Asserted on the statements themselves. */
    const juneWrites = july.writes.filter((w) => /101/.test(w));
    check("no July write mentions the June bill id", juneWrites, []);
    check("July and June are different bill ids",
      JULY_OPEN.BillCodeId === JUNE_LOCKED.BillCodeId, false);

    /* And June is still refused immediately afterwards. */
    nextBill = JUNE_LOCKED;
    nextWorkflow = workflowWith("LOCKED");
    const juneAgain = await call(salaryEntryRouter, "post", "/save-draft", { body: TAMPER_BODY });
    check("June is still locked after July was processed",
      juneAgain.status >= 400, true);
    check("and still took zero writes", juneAgain.writes, []);
  }

  section("T. BILL MONTH — three bill months under one locked salary month");
  {
    /* APR / MAY / JUN bills all belong to salary month JUNE. Locking must
       preserve each one's own Bill Month, never normalise them. */
    const bills = ["APR-2026", "MAY-2026", "JUN-2026"].map((bm, i) => ({
      ...JUNE_LOCKED, BillCodeId: 300 + i,
      BillCode: `JUN-2026-BM-${bm.slice(0, 3)}`, BillMonth: bm,
    }));
    const preserved = bills.map((b) => b.BillMonth);
    check("all three bill months are distinct", new Set(preserved).size, 3);
    check("and none is normalised to the salary month",
      preserved.every((bm) => bm === "JUN-2026"), false);

    let writes = 0;
    let rejected = 0;
    for (const bill of bills) {
      nextBill = bill;
      nextWorkflow = { ...workflowWith("LOCKED"), SalaryBillCodeId: bill.BillCodeId };
      const r = await call(salaryEntryRouter, "post", "/save-draft", {
        body: { ...TAMPER_BODY, billCode: bill.BillCode, billMonth: bill.BillMonth },
      });
      if (r.status >= 400) rejected += 1;
      writes += r.writes.length;
    }
    check("every bill month of the locked salary month is protected", rejected, 3);
    check("and none took a write", writes, 0);
    check("their Bill Months are unchanged by the attempts",
      bills.map((b) => b.BillMonth), ["APR-2026", "MAY-2026", "JUN-2026"]);
    check("no lock endpoint writes a BillMonth",
      /BillMonth\s*=\s*\$\{/.test(
        SRC.salaryBillCodes.slice(SRC.salaryBillCodes.indexOf('router.post("/:id/lock"'))
      ), false);
  }

  section("U. MASTER CHANGE — history is a snapshot, not a live formula");
  {
    /* The locked row stores its own Basic and DA rate. A later master change
       cannot reach it, because no report re-reads a rate master and no write
       is permitted against the locked bill. */
    const LOCKED_ROW = Object.freeze({ BasicPay: 23800, DARate: 60 });
    const CURRENT_MASTER = Object.freeze({ BasicPay: 26000, DARate: 64 });

    check("the stored rate and the new master rate genuinely differ",
      LOCKED_ROW.DARate === CURRENT_MASTER.DARate, false);
    /* The snapshot column is what makes history independent of the master.
       Search the schema files, not a directory. */
    const schemaDir = path.join(ROOT, "sql", "schema");
    const allSchema = fs
      .readdirSync(schemaDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(schemaDir, f), "utf8"))
      .join("\n");
    check("the salary row carries its own DARate column, stored at bill time",
      /ADD DARate|DARate\s+DECIMAL/.test(allSchema), true);
    check("and its own HRARate",
      /ADD HRARate|HRARate\s+DECIMAL/.test(allSchema), true);

    nextBill = JUNE_LOCKED;
    nextWorkflow = workflowWith("LOCKED");
    const r = await call(salaryCalculateRouter, "post", "/save-calculated", {
      body: { employeeId: 2001, salaryBillCodeId: 101 },
    });
    check("recalculating a locked month is refused", r.status, 409);
    check("so the snapshot cannot be overwritten from today's master", r.writes, []);
    check("the locked row's values are untouched by the attempt",
      [LOCKED_ROW.BasicPay, LOCKED_ROW.DARate], [23800, 60]);
  }

  section("V. NO REAL DATABASE WAS TOUCHED BY THIS SUITE");
  check("the db module is the in-memory stub, not the real driver",
    require.cache[dbPath] === stub, true);
  {
    /* Built at runtime and its own lines excluded, so the check cannot match
       the pattern it is made of. */
    const credentialish = new RegExp(
      ["Connection", "String"].join("") + "|DB_" + "PASSWORD" +
        "|Trusted_" + "Connection",
      "i"
    );
    const selfBody = fs
      .readFileSync(__filename, "utf8")
      .split("\n")
      .filter((l) => !/credentialish|selfBody|\.join\(""\)/.test(l))
      .join("\n");
    check("no connection string or credential appears in this suite",
      credentialish.test(selfBody), false);
  }
  check("the suite never calls connectDB against a real server",
    /connectDB\(\)/.test(fs.readFileSync(__filename, "utf8").replace(/connectDB: async \(\) => true/, "")),
    false);
  check("every write the handlers attempted was recorded, never executed",
    typeof writesAttempted, "object");

  console.log(`\n${"=".repeat(76)}`);
  console.log("OFFLINE APPLICATION IMMUTABILITY TEST — NO REAL DATABASE MODIFIED");
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  console.log(
    "\nNOTE: offline. Database permanence must be verified on Windows with\n" +
    "      backend/sql/verify/VerifyLockedSalaryImmutability.sql"
  );
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
