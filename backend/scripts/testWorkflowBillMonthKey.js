/*
  BUSINESS RULE (2026-09-24, migration 51 — user-approved architectural
  decision: "Make workflow Bill-Month-specific"):

  dbo.SalaryBillInstituteWorkflow is now keyed by (SalaryBillCodeId,
  InstituteCode, BillMonth) instead of just (SalaryBillCodeId,
  InstituteCode). This proves utils/salaryBillInstituteWorkflow.js's new
  behavior directly, offline, against a stubbed db.js:

    1. Two Bill Month instances of the SAME bill+institute get their own
       independent workflow rows — locking/approving one never touches
       the other (this is what makes a JUL-2026 bill and an AUG-2026 bill
       of the same AUG-2026 salary independently DRAFT -> ... -> LOCKED).
    2. A caller that has no Bill Month concept of its own (e.g. DA
       Difference) and omits billMonth falls back to
       canonicalBillMonthFromBill(bill) — exactly the single value every
       existing workflow row already meant before this migration, so
       existing DA Difference / single-instance callers keep working
       unchanged.
    3. Existing single-row-per-bill+institute behavior (the pre-migration-51
       shape) is unaffected when only one Bill Month is ever used.

  Runs offline: db.js is stubbed with an in-memory
  dbo.SalaryBillInstituteWorkflow table; SalaryBillApprovalHistory writes
  are accepted and ignored (fire-and-forget in the real code too).

  Usage: cd backend && npm run test:workflow-bill-month-key
*/

const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

let WORKFLOW = [];

function captureParen(text, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return { content: text.slice(startIdx + 1, i), end: i };
    }
  }
  return null;
}
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function nextId(arr, field) {
  return arr.reduce((max, r) => Math.max(max, Number(r[field]) || 0), 0) + 1;
}

function handleInsert(text, values) {
  const mTable = text.match(/INSERT INTO\s+dbo\.(\w+)/i);
  const table = mTable ? mTable[1] : "UNKNOWN";
  if (!/VALUES\s*\(/i.test(text)) return Promise.resolve({ recordset: [] });

  const colsMatch = text.match(/INSERT INTO\s+dbo\.\w+\s*\(/i);
  const colsOpenIdx = colsMatch.index + colsMatch[0].length - 1;
  const colsCap = captureParen(text, colsOpenIdx);
  const afterCols = text.slice(colsCap.end + 1);
  const valuesKw = afterCols.match(/VALUES\s*\(/i);
  const valuesOpenIdx = valuesKw.index + valuesKw[0].length - 1;
  const valuesCap = captureParen(afterCols, valuesOpenIdx);
  const cols = splitTopLevel(colsCap.content);
  const valTokens = splitTopLevel(valuesCap.content);

  const obj = {};
  let vi = 0;
  cols.forEach((col, idx) => {
    const tok = valTokens[idx];
    obj[col] = tok === "?" ? values[vi++] : undefined;
  });

  if (table === "SalaryBillInstituteWorkflow") {
    const id = nextId(WORKFLOW, "WorkflowId");
    WORKFLOW.push({ WorkflowId: id, ...obj });
    return Promise.resolve({ recordset: [] });
  }
  /* SalaryBillApprovalHistory — fire-and-forget, not modeled. */
  return Promise.resolve({ recordset: [] });
}

function handleUpdate(text, values) {
  const mTable = text.match(/UPDATE\s+dbo\.(\w+)\s+SET\s+/i);
  if (!mTable) return Promise.resolve({ recordset: [] });
  const table = mTable[1];
  const rest = text.slice(mTable.index + mTable[0].length);
  const whereMatch = rest.match(/\bWHERE\b/i);
  const setPart = whereMatch ? rest.slice(0, whereMatch.index) : rest;
  const wherePart = whereMatch ? rest.slice(whereMatch.index + whereMatch[0].length) : "";

  let vi = 0;
  function consume(segment, target) {
    for (let i = 0; i < segment.length; i++) {
      if (segment[i] === "?") {
        const before = segment.slice(0, i);
        const m = before.match(/(\w+)\s*=\s*$/);
        const val = values[vi++];
        if (m) target[m[1]] = val;
      }
    }
  }
  const setObj = {};
  const whereObj = {};
  consume(setPart, setObj);
  consume(wherePart, whereObj);

  /* Literal quoted-string SET assignments (e.g. Status = N'SUBMITTED')
     carry no '?' placeholder — they are baked directly into the query
     text via string interpolation, not a bound param — so consume()
     above never sees them. Extract them separately by name. */
  const literalRe = /(\w+)\s*=\s*N'([^']*)'/g;
  let lm;
  while ((lm = literalRe.exec(setPart))) {
    setObj[lm[1]] = lm[2];
  }

  if (table === "SalaryBillInstituteWorkflow") {
    const row = WORKFLOW.find((r) => Number(r.WorkflowId) === Number(whereObj.WorkflowId));
    if (row) Object.assign(row, setObj);
  }
  return Promise.resolve({ recordset: [] });
}

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();

  if (/SELECT TOP 1 \*\s+FROM dbo\.SalaryBillInstituteWorkflow/i.test(text)) {
    if (/BillMonth = \?/i.test(text)) {
      const [billCodeId, instituteCode, billMonth] = values;
      const row = WORKFLOW.find(
        (w) => w.SalaryBillCodeId === billCodeId && w.InstituteCode === instituteCode && w.BillMonth === billMonth
      );
      return Promise.resolve({ recordset: row ? [row] : [] });
    }
    const [billCodeId, instituteCode] = values;
    const rows = WORKFLOW.filter((w) => w.SalaryBillCodeId === billCodeId && w.InstituteCode === instituteCode);
    return Promise.resolve({ recordset: rows.length ? [rows[rows.length - 1]] : [] });
  }

  if (/^INSERT INTO/i.test(text)) return handleInsert(text, values);
  if (/^UPDATE/i.test(text)) return handleUpdate(text, values);

  console.warn("[STUB] Unhandled query:\n  " + text);
  return Promise.resolve({ recordset: [] });
}

function RequestCtor() {
  return {
    query,
    input() {
      return this;
    },
  };
}

function installDbStub() {
  const dbPath = require.resolve(path.join(ROOT, "db.js"));
  const stub = new Module(dbPath, null);
  stub.filename = dbPath;
  stub.loaded = true;
  stub.exports = { sql: { query, Request: RequestCtor }, connectDB: async () => true };
  require.cache[dbPath] = stub;
}
installDbStub();

const {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
  canonicalBillMonthFromBill,
} = require("../utils/salaryBillInstituteWorkflow");

let passed = 0;
let failed = 0;
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
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

const BILL_CODE_ID = 1018;
const INSTITUTE_CODE = "DDRS-16";
const bill = { BillCodeId: BILL_CODE_ID, SalaryMonth: "August", SalaryYear: "2026", SalaryMonthNumber: "08" };
const institute = { InstituteId: 16, InstituteCode: INSTITUTE_CODE };
const actor = { fullName: "TESTER" };

async function main() {
  console.log("=".repeat(78));
  console.log("dbo.SalaryBillInstituteWorkflow — Bill-Month-specific key (migration 51)");
  console.log("=".repeat(78));

  section("canonicalBillMonthFromBill()");
  check("AUG-2026 bill's canonical label", canonicalBillMonthFromBill(bill), "AUG-2026");

  section("TEST 1 — a caller with no Bill Month concept (DA Difference-style) falls back to canonical");
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "SUBMITTED", actor });
  check("exactly one workflow row exists", WORKFLOW.length, 1);
  check("it was created under the bill's own canonical Bill Month", WORKFLOW[0]?.BillMonth, "AUG-2026");
  check("its status is SUBMITTED", WORKFLOW[0]?.Status, "SUBMITTED");

  /* No bill+institute-only fallback any more: "the most recent row" is a
     DIFFERENT Bill Month instance's row once JUL-2026 and AUG-2026 both
     exist - which is exactly how JUL-2026 used to inherit AUG's LOCKED. */
  for (const missing of ["", null, undefined, "   "]) {
    let code = null;
    try {
      await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, missing);
    } catch (err) {
      code = err.code;
    }
    check(`a lookup with Bill Month ${JSON.stringify(missing)} is rejected, never a fallback`, code, "WORKFLOW_BILL_MONTH_REQUIRED");
  }

  WORKFLOW = [];

  section("TEST 2 — two Bill Month instances of the SAME bill+institute get independent rows");
  const julRow = await upsertInstituteWorkflow(null, {
    bill,
    institute,
    nextStatus: "DRAFT",
    actor,
    billMonth: "JUL-2026",
  });
  const augRow = await upsertInstituteWorkflow(null, {
    bill,
    institute,
    nextStatus: "DRAFT",
    actor,
    billMonth: "AUG-2026",
  });
  check("two independent rows now exist", WORKFLOW.length, 2);
  check("JUL-2026 row is its own row", julRow?.BillMonth, "JUL-2026");
  check("AUG-2026 row is its own row", augRow?.BillMonth, "AUG-2026");
  check("they are different WorkflowIds", julRow?.WorkflowId !== augRow?.WorkflowId, true);

  section("TEST 3 — submitting/locking JUL-2026 never touches AUG-2026's row, and vice versa");
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "SUBMITTED", actor, billMonth: "JUL-2026" });
  let julNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "JUL-2026");
  let augNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "AUG-2026");
  check("JUL-2026 is now SUBMITTED", julNow?.Status, "SUBMITTED");
  check("AUG-2026 is still DRAFT, unaffected by JUL-2026's submit", augNow?.Status, "DRAFT");

  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "VERIFIED", actor, billMonth: "JUL-2026" });
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "APPROVED", actor, billMonth: "JUL-2026" });
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "LOCKED", actor, billMonth: "JUL-2026" });
  julNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "JUL-2026");
  augNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "AUG-2026");
  check("JUL-2026 reached LOCKED", julNow?.Status, "LOCKED");
  check("AUG-2026 is STILL DRAFT — locking JUL-2026 never locked AUG-2026", augNow?.Status, "DRAFT");
  check("still exactly two rows (no extra rows created by these transitions)", WORKFLOW.length, 2);

  section("TEST 4 — AUG-2026 can now independently progress and lock too");
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "SUBMITTED", actor, billMonth: "AUG-2026" });
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "APPROVED", actor, billMonth: "AUG-2026" });
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "LOCKED", actor, billMonth: "AUG-2026" });
  julNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "JUL-2026");
  augNow = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "AUG-2026");
  check("JUL-2026 remains LOCKED", julNow?.Status, "LOCKED");
  check("AUG-2026 is now ALSO LOCKED, independently", augNow?.Status, "LOCKED");
  check("still exactly two rows total", WORKFLOW.length, 2);

  section("TEST 5 — a different institute never collides with DDRS-16's rows");
  const otherInstitute = { InstituteId: 99, InstituteCode: "DDRS-99" };
  await upsertInstituteWorkflow(null, { bill, institute: otherInstitute, nextStatus: "DRAFT", actor, billMonth: "JUL-2026" });
  check("a third row was added for the other institute", WORKFLOW.length, 3);
  const ddrs16Jul = await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "JUL-2026");
  check("DDRS-16's JUL-2026 row is untouched (still LOCKED)", ddrs16Jul?.Status, "LOCKED");

  section("TEST 6 — an explicit billMonth that cannot be resolved to anything throws a clear error");
  let threw = false;
  try {
    await upsertInstituteWorkflow(null, {
      bill: { BillCodeId: BILL_CODE_ID },
      institute,
      nextStatus: "DRAFT",
      actor,
      billMonth: "",
    });
  } catch (err) {
    threw = /Unable to resolve a Bill Month/i.test(err.message);
  }
  check("rejects rather than silently writing an unidentified workflow row", threw, true);

  section("TEST 7 — a JUL lookup never returns the AUG row, even when AUG is the only row");
  WORKFLOW = [{ WorkflowId: 52, SalaryBillCodeId: BILL_CODE_ID, InstituteCode: INSTITUTE_CODE, BillMonth: "AUG-2026", Status: "LOCKED" }];
  check("JUL-2026 lookup finds nothing (JUL is DRAFT until first saved)",
    await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "JUL-2026"), null);
  check("AUG-2026 lookup finds row 52, LOCKED",
    (await getInstituteWorkflow(BILL_CODE_ID, INSTITUTE_CODE, "AUG-2026"))?.Status, "LOCKED");
  await upsertInstituteWorkflow(null, { bill, institute, nextStatus: "DRAFT", actor, billMonth: "JUL-2026" });
  check("first JUL save INSERTs a new DRAFT row, row 52 untouched",
    WORKFLOW.map((w) => `${w.WorkflowId}:${w.BillMonth}:${w.Status}`),
    ["52:AUG-2026:LOCKED", "53:JUL-2026:DRAFT"]);

  section("MIGRATION 51 / 52 — static guarantees (SQL cannot run offline)");
  const fs = require("fs");
  const m51 = fs.readFileSync(path.join(ROOT, "sql", "schema", "51_SalaryBillInstituteWorkflow_BillMonthKey.sql"), "utf8");
  const step1 = m51.slice(m51.indexOf("/* Step 1"), m51.indexOf("/* Step 2"));
  check("51: backfill runs only while the widened key does not exist (rerun cannot relabel a JUL instance)",
    /IF NOT EXISTS \([\s\S]*?UQ_SBIW_Bill_Institute_Month'[\s\S]*?\)\s*BEGIN[\s\S]*?UPDATE w[\s\S]*?UPDATE dbo\.SalaryBillInstituteWorkflow[\s\S]*?END/.test(step1), true);
  check("51: no unguarded UPDATE between Step 1 and Step 2",
    step1.split(/\bBEGIN\b/)[0].includes("UPDATE"), false);
  const m52 = fs.readFileSync(path.join(ROOT, "sql", "schema", "52_SalaryBillInstituteWorkflow_RepairLegacyBillMonth.sql"), "utf8");
  const m52Sql = m52.slice(m52.indexOf("*/") + 2);
  check("52: sets BillMonth only", (m52Sql.match(/\bSET\s+w\.(\w+)/g) || []), ["SET w.BillMonth"]);
  check("52: never touches Status", /SET[^;]*\bStatus\s*=/i.test(m52Sql), false);
  check("52: never deletes or inserts rows", /\bDELETE\b|INSERT INTO dbo\./i.test(m52Sql), false);
  check("52: only the ORIGINAL (lowest WorkflowId) row per bill+institute", /MIN\(o\.WorkflowId\)/.test(m52Sql), true);
  check("52: never when a canonical row already exists", /NOT EXISTS \([\s\S]*?c\.BillMonth = l\.CanonicalBillMonth/.test(m52Sql), true);
  check("52: never when per-Bill-Month employee data backs the label", /NOT EXISTS \([\s\S]*?SalaryEntryBillEmployeeDetails e[\s\S]*?e\.BillMonth = w\.BillMonth/.test(m52Sql), true);
  check("52: same canonical expression as migration 51",
    m52Sql.includes("UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))"), true);
  check("52: requires 51 first", /UQ_SBIW_Bill_Institute_Month is missing/.test(m52Sql), true);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(78));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
