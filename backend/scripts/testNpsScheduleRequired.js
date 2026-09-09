/*
  NPS SCHEDULE NO. — CONDITIONAL MANDATORY RULE (Salary Entry)

  Rule: if ANY employee in the bill has an NPS deduction > 0, the bill-level
  NPS Schedule No. is required for BOTH Save Draft and Submit. If every
  employee has no NPS, a blank schedule is allowed.

  Runs offline. The db module is stubbed, and the backend guard is EXECUTED
  through the real Express routes rather than pattern-matched: the stub throws
  a sentinel the moment any query is attempted, so "the guard let this through"
  and "the guard blocked this" are distinguishable without a database.

  Usage: cd backend && npm run test:nps-schedule-required
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

/* ---- db stub: any query means execution got PAST the validation ---- */
const DB_SENTINEL = "DB_REACHED_PAST_VALIDATION";
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: () => {
      throw new Error(DB_SENTINEL);
    },
    Request: function R() {
      return {
        query: () => {
          throw new Error(DB_SENTINEL);
        },
        input() {
          return this;
        },
      };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const salaryEntryRouter = require("../routes/salaryEntry");
const routeSrc = fs.readFileSync(path.join(ROOT, "routes", "salaryEntry.js"), "utf8");
const calcSrc = fs.readFileSync(path.join(ROOT, "utils", "salaryBasicCalc.js"), "utf8");
const daSrc = fs.readFileSync(path.join(ROOT, "utils", "daDifference.js"), "utf8");
const pageSrc = fs.readFileSync(
  path.join(ROOT, "..", "frontend", "src", "pages", "SalaryEntry.jsx"),
  "utf8"
);

/* ---- runner ---- */
let passed = 0;
let failed = 0;
const failures = [];
function section(t) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
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

/* ---- invoke a real route handler ---- */
function handlerFor(routePath) {
  const layer = salaryEntryRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods.post
  );
  if (!layer) throw new Error(`route ${routePath} not found`);
  return layer.route.stack[0].handle;
}

const NPS_MESSAGE =
  "NPS Schedule No. is required because at least one employee has an NPS deduction.";

/**
 * Runs the real handler and reports what happened:
 *   "BLOCKED_NPS"  the NPS Schedule guard rejected it with 400
 *   "ALLOWED"      it passed every validation and reached the database
 *   other          some different validation rejected it first
 */
async function run(routePath, { employees, npsScheduleNo }) {
  const req = {
    body: {
      billCode: "JUN-2026",
      instituteCode: "CPD-06",
      billMonth: "JUN-2026",
      salaryMonth: "JUN-2026",
      billNo: "BN-1",
      billDate: "2026-06-30",
      npsScheduleNo,
      employees,
      user: { userName: "tester", fullName: "Tester" },
    },
    user: { userName: "tester" },
  };
  let status = 200;
  let body = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  await handlerFor(routePath)(req, res);
  const message = String(body?.message || "");
  if (status === 400 && message === NPS_MESSAGE) return "BLOCKED_NPS";
  if (message.includes(DB_SENTINEL)) return "ALLOWED";
  return `OTHER(${status}): ${message}`;
}

const SAVE = "/save-draft";
const SUBMIT = "/submit";
const emp = (over) => ({ employeeId: 1, employeeName: "Test", nps: 0, ...over });

(async function main() {
  console.log("=".repeat(76));
  console.log("NPS SCHEDULE NO. — CONDITIONAL MANDATORY RULE");
  console.log("=".repeat(76));

  section("A-B. NPS > 0 with a blank schedule is blocked");
  check("A. Save Draft is blocked",
    await run(SAVE, { employees: [emp({ nps: 500 })], npsScheduleNo: "" }), "BLOCKED_NPS");
  check("B. Submit is blocked",
    await run(SUBMIT, { employees: [emp({ nps: 500 })], npsScheduleNo: "" }), "BLOCKED_NPS");

  section("C-D. all-zero NPS with a blank schedule is allowed");
  check("C. Save Draft proceeds",
    await run(SAVE, { employees: [emp({ nps: 0 })], npsScheduleNo: "" }), "ALLOWED");
  check("D. Submit proceeds",
    await run(SUBMIT, { employees: [emp({ nps: 0 })], npsScheduleNo: "" }), "ALLOWED");
  check("C-D. several zero-NPS employees are still allowed",
    await run(SAVE, {
      employees: [emp({ employeeId: 1 }), emp({ employeeId: 2 }), emp({ employeeId: 3 })],
      npsScheduleNo: "",
    }), "ALLOWED");

  section("E-F. ANY employee triggers it, not just the first");
  check("E. first 0, second > 0 is blocked",
    await run(SAVE, {
      employees: [emp({ employeeId: 1, nps: 0 }), emp({ employeeId: 2, nps: 300 })],
      npsScheduleNo: "",
    }), "BLOCKED_NPS");
  check("F. first > 0, second 0 is blocked",
    await run(SAVE, {
      employees: [emp({ employeeId: 1, nps: 300 }), emp({ employeeId: 2, nps: 0 })],
      npsScheduleNo: "",
    }), "BLOCKED_NPS");
  check("E-F. the last of many is enough",
    await run(SUBMIT, {
      employees: [emp({ employeeId: 1 }), emp({ employeeId: 2 }),
                  emp({ employeeId: 3 }), emp({ employeeId: 4, nps: 1 })],
      npsScheduleNo: "",
    }), "BLOCKED_NPS");

  section("G-J, M. values that must count as no NPS");
  check("G. null is treated as zero",
    await run(SAVE, { employees: [emp({ nps: null })], npsScheduleNo: "" }), "ALLOWED");
  check("H. undefined is treated as zero",
    await run(SAVE, { employees: [emp({ nps: undefined })], npsScheduleNo: "" }), "ALLOWED");
  check("H. a missing nps property is treated as zero",
    await run(SAVE, { employees: [{ employeeId: 1, employeeName: "No Field" }], npsScheduleNo: "" }),
    "ALLOWED");
  check("I. an empty string is treated as zero",
    await run(SAVE, { employees: [emp({ nps: "" })], npsScheduleNo: "" }), "ALLOWED");
  check("J. the string \"0\" is treated as zero",
    await run(SAVE, { employees: [emp({ nps: "0" })], npsScheduleNo: "" }), "ALLOWED");
  check("J. \"0.00\" is treated as zero",
    await run(SAVE, { employees: [emp({ nps: "0.00" })], npsScheduleNo: "" }), "ALLOWED");
  check("M. a negative NPS does not trigger the requirement",
    await run(SAVE, { employees: [emp({ nps: -100 })], npsScheduleNo: "" }), "ALLOWED");
  check("G-J. a mix of blank forms is still allowed",
    await run(SUBMIT, {
      employees: [emp({ employeeId: 1, nps: null }), emp({ employeeId: 2, nps: "" }),
                  emp({ employeeId: 3, nps: "0" }), emp({ employeeId: 4, nps: 0 })],
      npsScheduleNo: "",
    }), "ALLOWED");

  section("K-L, N-O. the schedule value itself");
  check("K. a whitespace-only schedule is blocked when NPS > 0",
    await run(SAVE, { employees: [emp({ nps: 500 })], npsScheduleNo: "   " }), "BLOCKED_NPS");
  check("K. and on submit too",
    await run(SUBMIT, { employees: [emp({ nps: 500 })], npsScheduleNo: "\t \n" }), "BLOCKED_NPS");
  check("L. a valid schedule is accepted on save",
    await run(SAVE, { employees: [emp({ nps: 500 })], npsScheduleNo: "SCH/2026/06/001" }), "ALLOWED");
  check("L. and on submit",
    await run(SUBMIT, { employees: [emp({ nps: 500 })], npsScheduleNo: "SCH/2026/06/001" }), "ALLOWED");
  check("L. a schedule with surrounding spaces still counts as supplied",
    await run(SAVE, { employees: [emp({ nps: 500 })], npsScheduleNo: "  SCH-1  " }), "ALLOWED");
  check("N. a decimal positive NPS triggers the requirement",
    await run(SAVE, { employees: [emp({ nps: 0.5 })], npsScheduleNo: "" }), "BLOCKED_NPS");
  check("N. a string decimal does too",
    await run(SAVE, { employees: [emp({ nps: "0.01" })], npsScheduleNo: "" }), "BLOCKED_NPS");
  check("O. many NPS employees still need only ONE bill-level schedule",
    await run(SUBMIT, {
      employees: [emp({ employeeId: 1, nps: 100 }), emp({ employeeId: 2, nps: 200 }),
                  emp({ employeeId: 3, nps: 300 })],
      npsScheduleNo: "SCH-1",
    }), "ALLOWED");

  section("the guard is enforced by the backend itself");
  check("both routes share one handler",
    /router\.post\("\/save-draft"[\s\S]*?saveEmployeesHandler\(req, res, \{ submitted: false \}\)/.test(routeSrc) &&
      /router\.post\("\/submit"[\s\S]*?saveEmployeesHandler\(req, res, \{ submitted: true \}\)/.test(routeSrc),
    true);
  check("the rule lives in that shared handler, stated once",
    (routeSrc.match(/const hasNpsDeduction = employees\.some/g) || []).length, 1);
  check("every employee row is examined, not just the first",
    /employees\.some\(\(e\) => Number\(e\?\.nps\) > 0\)/.test(routeSrc), true);
  {
    /* Scoped to saveEmployeesHandler: two other functions earlier in the file
       also call resolveSalaryEntryBill, so a whole-file indexOf compares
       against the wrong occurrence. */
    const handlerSrc = routeSrc.slice(routeSrc.indexOf("async function saveEmployeesHandler"));
    const guardAt = handlerSrc.indexOf("const hasNpsDeduction");
    const resolveAt = handlerSrc.indexOf("const resolved = await resolveSalaryEntryBill(");
    check("it runs before the bill is resolved or written",
      guardAt > -1 && resolveAt > -1 && guardAt < resolveAt, true);
    check("and before any INSERT or UPDATE in the handler",
      guardAt < handlerSrc.search(/INSERT INTO|UPDATE dbo\./), true);
  }
  check("a rejected bill performs no database write",
    await run(SAVE, { employees: [emp({ nps: 500 })], npsScheduleNo: "" }), "BLOCKED_NPS");

  section("existing validations are preserved");
  check("Bill Code is still required",
    (await run(SAVE, { employees: [emp({ nps: 0 })], npsScheduleNo: "" })) === "ALLOWED", true);
  {
    const req = { body: { instituteCode: "CPD-06", billMonth: "JUN-2026", employees: [emp({})] } };
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(p) { body = p; return this; } };
    await handlerFor(SAVE)(req, res);
    check("a missing Bill Code is still rejected first",
      [status, body.message], [400, "Salary Bill Code is required."]);
  }
  {
    const req = {
      body: { billCode: "JUN-2026", instituteCode: "CPD-06", billMonth: "JUN-2026",
              employees: [emp({ nps: 500 })], billDate: "2026-06-30", npsScheduleNo: "" },
    };
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(p) { body = p; return this; } };
    await handlerFor(SUBMIT)(req, res);
    check("Bill No. is still checked before the NPS rule on submit",
      [status, body.message], [400, "Bill No. is required."]);
  }
  check("the empty-employees rule still applies",
    (await run(SAVE, { employees: [], npsScheduleNo: "" })).startsWith("OTHER(400)"), true);

  section("the frontend blocks it too, on both actions");
  check("a shared helper exists",
    /const billHasNpsDeduction = \(\) =>\s*\n\s*employees\.some\(\(row\) => Number\(row\?\.nps\) > 0\);/.test(pageSrc),
    true);
  check("used in exactly two places — save and submit",
    (pageSrc.match(/billHasNpsDeduction\(\) && !npsScheduleNo\.trim\(\)/g) || []).length, 2);
  check("no unconditional required attribute was added",
    /required=\{?["']?required/.test(pageSrc), false);

  section("no calculation was changed");
  check("the regular NPS formula is untouched",
    /Math\.ceil\(\(toNum\(totalBasicPay\) \+ toNum\(da\)\) \* 0\.1\)/.test(calcSrc), true);
  check("the DA Difference NPS rule is untouched",
    /return Math\.ceil\(amount \* NPS_RATE\);/.test(daSrc), true);
  check("the guard does not compute or alter any NPS value",
    /hasNpsDeduction[\s\S]{0,400}?(calculateNps|Math\.ceil|nps =)/.test(routeSrc), false);
  check("NPSScheduleNo storage is unchanged",
    /NPSScheduleNo = \$\{npsScheduleNo \|\| null\}/.test(routeSrc), true);
  check("no schema statement was introduced",
    /ALTER TABLE|CREATE TABLE/.test(routeSrc), false);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error("SUITE ERROR:", e.message);
  process.exit(1);
});
