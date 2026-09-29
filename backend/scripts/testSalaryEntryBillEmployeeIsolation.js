/*
  BUSINESS RULE (2026-09-24, "REDESIGN SALARY ENTRY FOR MULTIPLE BILL
  MONTHS WITHIN ONE SALARY MONTH") — REQUIRED TEST A-E (item 10) / item 16
  final isolation test.

  For ONE Salary Month (AUG-2026), Salary Entry must support several fully
  independent bill instances, one per Bill Month <= Salary Month, each
  independently saveable/reopenable without one instance's employee salary
  data ever overwriting another's:

    A. Bill Month JUL-2026 (earlier than Salary Month AUG-2026) — a
       NON-CANONICAL instance, stored in the new
       dbo.SalaryEntryBillEmployeeDetails table (migration 50).
    B. Bill Month AUG-2026 (equal to Salary Month AUG-2026) — the
       CANONICAL instance, stored exactly as before this feature in
       dbo.SalaryEmployeeDetails — zero regression risk to every existing
       consumer (Bank Copy, DA Difference, Cheque Register, Reports, ...).

  Required scenario (ticket's own TEST A-E):
    A. Select JUL-2026 (Bill Month) + AUG-2026 (Salary Month). Employee
       2070 Basic Pay = 11111. Save Draft.
    B. Select AUG-2026 (Bill Month) + AUG-2026 (Salary Month) — same
       salary data. Employee 2070 Basic Pay = 22222. Save Draft.
    C. Switch back to JUL-2026 + Get Data -> expect Basic Pay = 11111.
    D. Switch to AUG-2026 + Get Data -> expect Basic Pay = 22222.
    E. Simulate a backend restart (a fresh require of the route module
       against the SAME in-memory tables — a true OS process restart
       cannot be simulated inside one Node process; the in-memory tables
       standing in for SQL Server are what actually needs to "survive",
       exactly as real tables survive a real restart) and repeat C/D —
       values must remain independently correct.

  Runs entirely offline: db.js and routes/salaryCalculate.js are both
  stubbed with in-memory tables; the route handlers themselves
  (POST /save-draft, GET /employees) are invoked directly via the same
  handlerFor() pattern used by scripts/testNpsScheduleRequired.js, so the
  REAL isolation logic in routes/salaryEntry.js is what is being proven,
  not a re-implementation of it.

  Usage: cd backend && npm run test:salary-entry-bill-employee-isolation
*/

const path = require("path");
const Module = require("module");

/* Keep the Salary Entry trace out of the real backend/logs folder. */
process.env.SALARY_ENTRY_TRACE_FILE = "0";

const ROOT = path.join(__dirname, "..");

/* ===================== IN-MEMORY TABLES ===================== */

const MASTER = {
  BillCodeId: 1018,
  BillCode: "AUG-2026",
  BillMonth: "August",
  SalaryMonth: "August",
  SalaryMonthNumber: "08",
  SalaryYear: "2026",
  BillCategory: "Salary",
  BillType: "Regular Salary",
  Status: "OPEN",
  IsArchived: 0,
};
const BILLS = [MASTER];

const INSTITUTES = [
  { InstituteId: 16, InstituteCode: "DDRS-16", InstituteName: "Test Institute DDRS-16", SectionId: 1 },
];

const EMPLOYEES_MASTER = [
  {
    EmployeeId: 2070,
    EmployeeName: "Employee 2070",
    EmployeeCode: "E2070",
    InstituteId: 16,
    Status: "Active",
    IsActive: 1,
    GPFNPS: "GPF",
  },
];

/* dbo.SalaryEmployeeDetails (canonical) */
let SED = [];
/* dbo.SalaryEntryBillEmployeeDetails (non-canonical, migration 50) */
let SEBED = [];
/* dbo.SalaryBillInstituteWorkflow (migration 51 - keyed incl. BillMonth) */
let WORKFLOW = [];
/* dbo.SalaryEntryBillHeader (migration 49) */
let HEADERS = [];

/* ===================== SQL TEXT PARSING HELPERS ===================== */

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
    } else {
      cur += ch;
    }
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

  if (!/VALUES\s*\(/i.test(text)) {
    /* INSERT ... SELECT form (e.g. the submit-only SalaryEmployeeDetailHistory
       snapshot) — not exercised by this save-draft-only test. */
    return Promise.resolve({ recordset: [] });
  }

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

  if (table === "SalaryEntryBillEmployeeDetails") {
    const id = nextId(SEBED, "Id");
    SEBED.push({ Id: id, TAManual: 0, ...obj });
    return Promise.resolve({ recordset: [{ Id: id }] });
  }
  if (table === "SalaryEmployeeDetails") {
    const id = nextId(SED, "Id");
    SED.push({ Id: id, TAManual: 0, ...obj });
    return Promise.resolve({ recordset: [{ Id: id }] });
  }
  if (table === "SalaryBillInstituteWorkflow") {
    const id = nextId(WORKFLOW, "WorkflowId");
    WORKFLOW.push({ WorkflowId: id, ...obj });
    return Promise.resolve({ recordset: [] });
  }
  if (table === "SalaryEntryBillHeader") {
    const id = nextId(HEADERS, "HeaderId");
    HEADERS.push({ HeaderId: id, ...obj });
    return Promise.resolve({ recordset: [] });
  }
  /* SalaryEntryBillEmployeeComponentDetails / SalaryEmployeeComponentDetails /
     SalaryBillApprovalHistory / AuditLogs — not modeled (SalaryComponentMaster
     is stubbed empty so the component-sync loops never actually INSERT;
     approval history / audit log writes are fire-and-forget). */
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
  /* Literal string assignments (e.g. Status = N'LOCKED') carry no bound
     parameter, so consume() never sees them. */
  const literalRe = /(\w+)\s*=\s*N'([^']*)'/g;
  let lm;
  while ((lm = literalRe.exec(setPart))) setObj[lm[1]] = lm[2];

  let arr = null;
  let idField = null;
  if (table === "SalaryEntryBillEmployeeDetails") { arr = SEBED; idField = "Id"; }
  else if (table === "SalaryEmployeeDetails") { arr = SED; idField = "Id"; }
  else if (table === "SalaryBillInstituteWorkflow") { arr = WORKFLOW; idField = "WorkflowId"; }
  else if (table === "SalaryEntryBillHeader") { arr = HEADERS; idField = "HeaderId"; }

  if (arr && idField != null) {
    const idVal = whereObj[idField];
    const row = arr.find((r) => Number(r[idField]) === Number(idVal));
    if (row) Object.assign(row, setObj);
  }
  return Promise.resolve({ recordset: [] });
}

/* ===================== QUERY DISPATCH ===================== */

function query(strings, ...values) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();

  if (/FROM dbo\.SalaryBillCodes\b/i.test(text) && /WHERE BillCode = \?/i.test(text)) {
    return Promise.resolve({ recordset: BILLS.filter((b) => b.BillCode === String(values[0])) });
  }

  if (/FROM dbo\.Institutes\b/i.test(text) && /WHERE InstituteCode = \?/i.test(text)) {
    return Promise.resolve({ recordset: INSTITUTES.filter((i) => i.InstituteCode === String(values[0])) });
  }
  if (/FROM dbo\.Institutes\b/i.test(text) && /WHERE InstituteId = \?/i.test(text)) {
    return Promise.resolve({ recordset: INSTITUTES.filter((i) => Number(i.InstituteId) === Number(values[0])) });
  }

  if (/FROM dbo\.EmployeeMaster e\b/i.test(text) && /InstituteId = \?/i.test(text)) {
    const instId = Number(values[0]);
    return Promise.resolve({
      recordset: EMPLOYEES_MASTER.filter(
        (e) =>
          Number(e.InstituteId) === instId &&
          String(e.Status || "Active").toUpperCase() === "ACTIVE" &&
          (e.IsActive == null || Number(e.IsActive) === 1)
      ).map((e) => ({ EmployeeId: e.EmployeeId, EmployeeName: e.EmployeeName, EmployeeCode: e.EmployeeCode })),
    });
  }

  if (/SELECT TOP 1 GPFNPS FROM dbo\.EmployeeMaster/i.test(text)) {
    const empId = Number(values[0]);
    const row = EMPLOYEES_MASTER.find((e) => Number(e.EmployeeId) === empId);
    return Promise.resolve({ recordset: row ? [{ GPFNPS: row.GPFNPS || "" }] : [] });
  }

  if (/FROM dbo\.EmployeePayrollConfiguration/i.test(text)) {
    /* Fallback path (usp_EmployeePayrollConfiguration_GetByEmployee stubbed
       to throw) — empty means loadActivePayrollConfig() returns its
       documented default (HRA/MA/TA applicable, not forced zero). */
    return Promise.resolve({ recordset: [] });
  }

  if (/COL_LENGTH\(N'dbo\.SalaryEmployeeDetails', N'TAManual'\)/i.test(text)) {
    return Promise.resolve({ recordset: [{ Len: 1 }] });
  }

  if (/FROM dbo\.SalaryComponentMaster/i.test(text)) {
    return Promise.resolve({ recordset: [] });
  }

  if (/SELECT TOP 1 Id\s+FROM dbo\.SalaryEntryBillEmployeeDetails/i.test(text)) {
    const [billCodeId, employeeId, instituteCode, billMonth] = values;
    const row = SEBED.find(
      (r) =>
        r.SalaryBillCodeId === billCodeId &&
        r.EmployeeId === employeeId &&
        r.InstituteCode === instituteCode &&
        r.BillMonth === billMonth
    );
    return Promise.resolve({ recordset: row ? [{ Id: row.Id }] : [] });
  }

  if (/SELECT TOP 1 Id\s+FROM dbo\.SalaryEmployeeDetails\b/i.test(text)) {
    const [billCodeId, employeeId, instituteCode] = values;
    const row = SED.find(
      (r) => r.SalaryBillCodeId === billCodeId && r.EmployeeId === employeeId && r.InstituteCode === instituteCode
    );
    return Promise.resolve({ recordset: row ? [{ Id: row.Id }] : [] });
  }

  if (/SELECT \*\s+FROM dbo\.SalaryEntryBillEmployeeDetails/i.test(text)) {
    const [billCodeId, instituteCode, billMonth] = values;
    return Promise.resolve({
      recordset: SEBED.filter(
        (r) => r.SalaryBillCodeId === billCodeId && r.InstituteCode === instituteCode && r.BillMonth === billMonth
      ),
    });
  }

  if (/SELECT \*\s+FROM dbo\.SalaryEmployeeDetails\b/i.test(text) && /InstituteCode = \?/i.test(text)) {
    const [billCodeId, instituteCode] = values;
    return Promise.resolve({
      recordset: SED.filter((r) => r.SalaryBillCodeId === billCodeId && (r.InstituteCode === instituteCode || !r.InstituteCode)),
    });
  }

  if (/COUNT\(1\) AS Cnt\s+FROM dbo\.SalaryEmployeeDetails/i.test(text)) {
    const [billCodeId, instituteCode] = values;
    const cnt = SED.filter((r) => r.SalaryBillCodeId === billCodeId && r.InstituteCode === instituteCode).length;
    return Promise.resolve({ recordset: [{ Cnt: cnt }] });
  }

  if (/^INSERT INTO/i.test(text)) return handleInsert(text, values);
  if (/^UPDATE/i.test(text)) return handleUpdate(text, values);
  if (/^DELETE FROM/i.test(text)) return Promise.resolve({ recordset: [] });

  if (/SELECT TOP 1 \*\s+FROM dbo\.SalaryEntryBillHeader/i.test(text)) {
    const [billCodeId, instituteCode, billMonth] = values;
    const row = HEADERS.find(
      (h) => h.SalaryBillCodeId === billCodeId && h.InstituteCode === instituteCode && h.BillMonth === billMonth
    );
    return Promise.resolve({ recordset: row ? [row] : [] });
  }

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

  console.warn("[STUB] Unhandled query:\n  " + text);
  return Promise.resolve({ recordset: [] });
}

/* ===================== db.js STUB ===================== */

function RequestCtor() {
  return {
    query,
    input() {
      return this;
    },
    execute() {
      throw new Error("SP_NOT_AVAILABLE_IN_STUB");
    },
  };
}
function TransactionCtor() {
  return {
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
  };
}
const sqlStub = {
  query,
  Request: RequestCtor,
  Transaction: TransactionCtor,
  Int: "Int",
  Date: "Date",
  NVarChar: "NVarChar",
  VarChar: "VarChar",
  Decimal: "Decimal",
  Bit: "Bit",
};

function installDbStub() {
  const dbPath = require.resolve(path.join(ROOT, "db.js"));
  const stub = new Module(dbPath, null);
  stub.filename = dbPath;
  stub.loaded = true;
  stub.exports = { sql: sqlStub, connectDB: async () => true };
  require.cache[dbPath] = stub;
}

/* ===================== routes/salaryCalculate.js STUB =====================
   upsertEmployeeSalary unconditionally calls calculateForEmployee() (for TA
   derivation) on every save regardless of payload completeness. Stubbed
   with a fixed, valid calc object; loadEmployee() returns null so
   resolveIncrementForBill() short-circuits before touching the (unrelated,
   unstubbed) employeeIncrement DB calls. */
function installSalaryCalculateStub() {
  const calcPath = require.resolve(path.join(ROOT, "routes", "salaryCalculate.js"));
  const stub = new Module(calcPath, null);
  stub.filename = calcPath;
  stub.loaded = true;
  stub.exports = {
    calculateForEmployee: async () => ({
      employee: { employeeName: "Stub", designation: "Stub", employeeType: "REGULAR", cityClassName: "" },
      payRevision: { payRevisionId: 1 },
      level: "L1",
      cellNo: 1,
      payMatrixId: 1,
      daMasterId: 1,
      hraMasterId: 1,
      claMasterId: 1,
      daRate: 0,
      hraRate: 0,
      payrollConfig: { id: null },
      earnings: { ta: 0 },
      taMasterId: null,
      taPayLevelGroup: null,
    }),
    mapCalcToGridRow: (calc, extra) => ({ ...calc, ...extra }),
    toNum: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    },
    loadEmployee: async () => null,
    resolveBasicPay: async () => ({}),
  };
  require.cache[calcPath] = stub;
}

installDbStub();
installSalaryCalculateStub();

/* ===================== MODULE UNDER TEST ===================== */

function loadSalaryEntryRouterFresh() {
  const routePath = require.resolve(path.join(ROOT, "routes", "salaryEntry.js"));
  delete require.cache[routePath];
  return require(routePath);
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${routePath} not found`);
  return layer.route.stack[0].handle;
}

async function invoke(handler, { body, query: queryObj }) {
  const req = { body: body || {}, query: queryObj || {}, user: { userName: "tester" } };
  let status = 200;
  let payload = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(p) {
      payload = p;
      return this;
    },
  };
  await handler(req, res);
  return { status, body: payload };
}

const BILL_CODE = "AUG-2026";
const SALARY_MONTH = "AUG-2026";
const INSTITUTE = "DDRS-16";
const EMPLOYEE_ID = 2070;

function empRow(basicPay, overrides = {}) {
  return {
    employeeId: EMPLOYEE_ID,
    employeeName: "Employee 2070",
    designation: "Clerk",
    employeeType: "REGULAR",
    basicPay,
    fixBasic: 0,
    gradePay: 0,
    da: 0,
    hra: 0,
    ma: 0,
    ta: 0,
    taManual: true,
    cla: 0,
    specialAllowance: 0,
    washingAllowance: 0,
    otherEarnings: 0,
    nppa: 0,
    gpfSubscription: 0,
    gpfAdvance: 0,
    nps: 0,
    incomeTax: 0,
    professionalTax: 0,
    otherDeduction: 0,
    payRevisionId: 1,
    payLevel: "L1",
    payMatrixCellNo: 1,
    payMatrixId: 1,
    daMasterId: 1,
    hraMasterId: 1,
    claMasterId: 1,
    payrollConfigId: null,
    cityClass: "",
    daRate: 0,
    hraRate: 0,
    displayOrder: 1,
    ...overrides,
  };
}

async function saveDraft(router, { billMonth, basicPay, billNo = "", billDate = "", npsScheduleNo = "", billCode = BILL_CODE }) {
  const handler = handlerFor(router, "/save-draft", "post");
  return invoke(handler, {
    body: {
      billCode,
      instituteCode: INSTITUTE,
      billMonth,
      salaryMonth: SALARY_MONTH,
      billNo,
      billDate,
      npsScheduleNo,
      employees: [empRow(basicPay)],
      userName: "tester",
      fullName: "Tester",
    },
  });
}

async function getData(router, { billMonth, billCode = BILL_CODE }) {
  const handler = handlerFor(router, "/employees", "get");
  return invoke(handler, {
    query: {
      billCode,
      instituteCode: INSTITUTE,
      billMonth,
      salaryMonth: SALARY_MONTH,
    },
  });
}

/* The same function POST /api/salary-bill-approval/lock calls. */
const { upsertInstituteWorkflow } = require("../utils/salaryBillInstituteWorkflow");
async function lockInstance(billMonth) {
  return upsertInstituteWorkflow(null, {
    bill: MASTER,
    institute: INSTITUTES[0],
    nextStatus: "LOCKED",
    actor: { fullName: "ACCOUNT OFFICER" },
    billMonth,
  });
}

function resetTables({ workflow = [], sed = [] } = {}) {
  SED = sed.map((r) => ({ ...r }));
  SEBED = [];
  WORKFLOW = workflow.map((r) => ({ ...r }));
  HEADERS = [];
}

const basicOf = (res) => Number(res.body?.data?.[0]?.basicPay);
const statusOf = (res) => res.body?.bill?.status;

/* Row 52 exactly as it exists live AFTER migration 51: the pre-existing
   (only) workflow row for bill 1018 / DDRS-16, backfilled to the bill's own
   canonical Bill Month and LOCKED. Its salary data is in the canonical
   dbo.SalaryEmployeeDetails table. */
const LIVE_ROW_52 = {
  WorkflowId: 52,
  SalaryBillCodeId: 1018,
  InstituteId: 16,
  InstituteCode: "DDRS-16",
  BillMonth: "AUG-2026",
  Status: "LOCKED",
};
const LIVE_AUG_SNAPSHOT = {
  Id: 900,
  SalaryBillCodeId: 1018,
  InstituteCode: "DDRS-16",
  EmployeeId: EMPLOYEE_ID,
  EmployeeName: "Employee 2070",
  EmployeeType: "REGULAR",
  PensionType: "GPF",
  DisplayOrder: 1,
  BasicPay: 20000,
  GradePay: 0,
  DA: 0, HRA: 0, MA: 0, TA: 0, CLA: 0,
  SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0,
  GPFSubscription: 0, GPFAdvance: 0, NPS: 0, IncomeTax: 0,
  ProfessionalTax: 0, OtherDeduction: 0, TAManual: 1,
};

/* ===================== RUNNER ===================== */

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

async function main() {
  console.log("=".repeat(78));
  console.log("Salary Entry: independent JUL-2026 / AUG-2026 bill instances of the");
  console.log("same AUG-2026 Salary Month (employee data, header, workflow status)");
  console.log("=".repeat(78));

  let router = loadSalaryEntryRouterFresh();

  /* ------------------------------------------------------------------ */
  section("ROOT CAUSE — the only data state that renders JUL-2026 as LOCKED");
  /* Before migration 51 there was ONE workflow row per bill+institute. The
     migration-48 Save Draft stamped whatever Bill Month was being saved onto
     that single row (UPDATE ... SET BillMonth = <selected> WHERE bill AND
     institute). After a JUL-2026 test save, row 52 - the AUG bill's row -
     carried BillMonth = 'JUL-2026'. Keyed lookups then hand AUG's LOCKED
     status to JUL and report AUG as having no workflow at all. */
  resetTables({ workflow: [{ ...LIVE_ROW_52, BillMonth: "JUL-2026" }], sed: [LIVE_AUG_SNAPSHOT] });
  const rcJul = await getData(router, { billMonth: "JUL-2026" });
  const rcAug = await getData(router, { billMonth: "AUG-2026" });
  check("RC. a legacy row stamped 'JUL-2026' makes JUL show LOCKED (the reported screen)", statusOf(rcJul), "LOCKED");
  check("RC. ...with blank Bill No / Bill Date / NPS Schedule No (as reported)",
    [rcJul.body?.bill?.billNo, rcJul.body?.bill?.billDate, rcJul.body?.bill?.npsScheduleNo], ["", null, ""]);
  check("RC. ...and the real AUG instance then looks like it has no workflow (DRAFT)", statusOf(rcAug), "DRAFT");

  /* ------------------------------------------------------------------ */
  section("TEST 1 — JUL-2026 + AUG salary + DDRS-16 starts DRAFT and is editable (live row 52 = AUG-2026 LOCKED)");
  resetTables({ workflow: [LIVE_ROW_52], sed: [LIVE_AUG_SNAPSHOT] });
  const t1Get = await getData(router, { billMonth: "JUL-2026" });
  check("1. Get Data succeeds", t1Get.status, 200);
  check("1. JUL-2026 Institute Status is DRAFT, not AUG's LOCKED", statusOf(t1Get), "DRAFT");
  check("1. no workflow row supplied JUL's status (workflowBillMonth null)", t1Get.body?.bill?.workflowBillMonth, null);
  check("1. JUL-2026 does NOT load AUG-2026's saved Basic Pay", basicOf(t1Get) === 20000, false);
  check("1. GET created no workflow row (Get Data stays read-only)", WORKFLOW.length, 1);
  const t1Save = await saveDraft(router, { billMonth: "JUL-2026", basicPay: 11111 });
  check("1. JUL-2026 Save Draft is allowed", t1Save.status, 200);
  const julRow = WORKFLOW.find((w) => w.BillMonth === "JUL-2026");
  check("1. Save Draft created JUL-2026's OWN workflow row", Boolean(julRow), true);
  check("1. ...as DRAFT", julRow?.Status, "DRAFT");
  check("1. ...with a new WorkflowId (row 52 was not reused)", julRow?.WorkflowId !== 52, true);

  section("TEST 2 — AUG-2026 remains LOCKED independently");
  const row52 = WORKFLOW.find((w) => w.WorkflowId === 52);
  check("2. row 52 still AUG-2026", row52?.BillMonth, "AUG-2026");
  check("2. row 52 still LOCKED (JUL save never touched it)", row52?.Status, "LOCKED");
  const t2Get = await getData(router, { billMonth: "AUG-2026" });
  check("2. AUG-2026 Get Data shows LOCKED", statusOf(t2Get), "LOCKED");
  check("2. ...and that status came from the AUG-2026 row", t2Get.body?.bill?.workflowBillMonth, "AUG-2026");
  check("2. AUG-2026 still shows its own saved Basic Pay", basicOf(t2Get), 20000);
  const t2Save = await saveDraft(router, { billMonth: "AUG-2026", basicPay: 99999 });
  check("2. AUG-2026 Save Draft is rejected (locked)", t2Save.status, 409);
  check("2. AUG-2026 salary data unchanged by the rejected save", Number(SED[0].BasicPay), 20000);
  check("2. JUL-2026 salary data unchanged by the rejected AUG save", Number(SEBED[0].BasicPay), 11111);

  /* ------------------------------------------------------------------ */
  section("LIVE REGRESSION — workflow 52 = 1018/DDRS-16/AUG-2026/LOCKED, no JUL row: JUL Get Data -> Save Draft");
  resetTables({ workflow: [LIVE_ROW_52], sed: [LIVE_AUG_SNAPSHOT] });
  router = loadSalaryEntryRouterFresh();

  /* Same read-only rule as SalaryEntry.jsx (salaryReadOnly), applied to the
     Get Data response - asserted below to still match the page source. */
  const editableFrom = (resp) => {
    const master = String(resp.body?.bill?.resolvedMasterStatus || resp.body?.bill?.masterStatus || "").toUpperCase();
    const st = String(resp.body?.bill?.status || "").toUpperCase();
    const readOnly =
      master === "LOCKED" || master === "APPROVED" || master === "COMPLETED" ||
      st === "LOCKED" || st === "APPROVED" ||
      (["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(st) && st !== "RETURNED");
    return !readOnly;
  };
  const traced = [];
  const realLog = console.log;
  console.log = (...args) => {
    const first = String(args[0] ?? "");
    if (first.startsWith("[salary-entry-trace] ")) traced.push(JSON.parse(first.slice(21)));
    else realLog(...args);
  };
  const liveJul = await getData(router, { billMonth: "JUL-2026" });
  const liveAug = await getData(router, { billMonth: "AUG-2026" });
  console.log = realLog;

  check("LIVE. JUL response billCodeId = 1018", liveJul.body?.bill?.billCodeId, 1018);
  check("LIVE. JUL response billMonth = JUL-2026", liveJul.body?.bill?.billMonth, "JUL-2026");
  check("LIVE. JUL response status = DRAFT", liveJul.body?.bill?.status, "DRAFT");
  check("LIVE. JUL response workflowBillMonth = null (new instance, no row yet)", liveJul.body?.bill?.workflowBillMonth, null);
  check("LIVE. JUL response workflowId = null (row 52 was NOT read)", liveJul.body?.bill?.workflowId, null);
  check("LIVE. JUL response instanceBillMonth = JUL-2026", liveJul.body?.bill?.instanceBillMonth, "JUL-2026");
  check("LIVE. JUL master status is OPEN (bill code itself not locked)",
    [liveJul.body?.bill?.resolvedMasterStatus, liveJul.body?.bill?.masterStatus], ["OPEN", "OPEN"]);
  check("LIVE. JUL is EDITABLE by the page's own read-only rule", editableFrom(liveJul), true);
  check("LIVE. AUG response status = LOCKED from workflow 52",
    [liveAug.body?.bill?.status, liveAug.body?.bill?.workflowId, liveAug.body?.bill?.workflowBillMonth], ["LOCKED", 52, "AUG-2026"]);
  check("LIVE. AUG is READ-ONLY by the page's own read-only rule", editableFrom(liveAug), false);

  const julTrace = traced.find((x) => x.event === "GET /employees" && x.request?.billMonth === "JUL-2026");
  check("LIVE. trace logged for the JUL GET", Boolean(julTrace), true);
  check("LIVE. trace: resolved bill 1018, instance JUL-2026 non-canonical",
    [julTrace?.resolvedBill?.BillCodeId, julTrace?.instance?.instanceBillMonth, julTrace?.instance?.isCanonicalInstance],
    [1018, "JUL-2026", false]);
  check("LIVE. trace: no workflow row read, response DRAFT",
    [julTrace?.workflow, julTrace?.response?.status, julTrace?.response?.workflowBillMonth], [null, "DRAFT", null]);

  const liveSave = await saveDraft(router, { billMonth: "JUL-2026", basicPay: 11111 });
  check("LIVE. JUL Save Draft allowed while AUG is LOCKED", liveSave.status, 200);
  check("LIVE. JUL Save Draft response status DRAFT", liveSave.body?.bill?.status, "DRAFT");
  check("LIVE. exactly two workflow rows afterwards",
    WORKFLOW.map((w) => [w.WorkflowId, w.SalaryBillCodeId, w.InstituteCode, w.BillMonth, w.Status]),
    [[52, 1018, "DDRS-16", "AUG-2026", "LOCKED"], [53, 1018, "DDRS-16", "JUL-2026", "DRAFT"]]);
  const julAfterSave = await getData(router, { billMonth: "JUL-2026" });
  check("LIVE. reopening JUL now reads its own row 53, DRAFT, Basic 11111",
    [julAfterSave.body?.bill?.workflowId, julAfterSave.body?.bill?.status, basicOf(julAfterSave)], [53, "DRAFT", 11111]);
  check("LIVE. AUG still reads row 52 LOCKED with its own Basic",
    [(await getData(router, { billMonth: "AUG-2026" })).body?.bill?.workflowId, WORKFLOW[0].Status, Number(SED[0].BasicPay)],
    [52, "LOCKED", 20000]);

  {
    const fs = require("fs");
    const page = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8");
    check("LIVE. page read-only rule is the one this test mirrors (workflow status, not another Bill Month's)",
      /const salaryReadOnly =\s*isBillCodeLocked \|\|\s*isBillCodeCompleted \|\|\s*instituteEntryStatus === "LOCKED" \|\|\s*instituteEntryStatus === "APPROVED" \|\|\s*\(isBillSubmitted && !isReturnedBill\);/.test(page), true);
    check("LIVE. page badge + read-only status come from the Get Data response of the selected Bill Month",
      /setStatus\(String\(result\.bill\.status\)\.toUpperCase\(\)\)/.test(page), true);
  }

  /* ------------------------------------------------------------------ */
  section("TEST 5 + 6 — employee data and bill header are independent per Bill Month");
  resetTables();
  router = loadSalaryEntryRouterFresh();
  check("5. save JUL-2026 Basic 11111 + header",
    (await saveDraft(router, { billMonth: "JUL-2026", basicPay: 11111,
      billNo: "729", billDate: "2026-08-20", npsScheduleNo: "SCH/JUL/TEST" })).status, 200);
  check("5. save AUG-2026 Basic 22222 + header",
    (await saveDraft(router, { billMonth: "AUG-2026", basicPay: 22222,
      billNo: "849", billDate: "2026-09-03", npsScheduleNo: "SCH/AUG/TEST" })).status, 200);
  check("5. JUL stored in SalaryEntryBillEmployeeDetails", [SEBED.length, SEBED[0]?.BillMonth, Number(SEBED[0]?.BasicPay)], [1, "JUL-2026", 11111]);
  check("5. AUG stored in SalaryEmployeeDetails", [SED.length, Number(SED[0]?.BasicPay)], [1, 22222]);
  let jul = await getData(router, { billMonth: "JUL-2026" });
  let aug = await getData(router, { billMonth: "AUG-2026" });
  check("5. reload JUL -> 11111", basicOf(jul), 11111);
  check("5. reload AUG -> 22222", basicOf(aug), 22222);
  check("6. JUL header", [jul.body.bill.billNo, jul.body.bill.billDate, jul.body.bill.npsScheduleNo], ["729", "2026-08-20", "SCH/JUL/TEST"]);
  check("6. AUG header", [aug.body.bill.billNo, aug.body.bill.billDate, aug.body.bill.npsScheduleNo], ["849", "2026-09-03", "SCH/AUG/TEST"]);
  check("6. one header row per Bill Month", HEADERS.map((h) => h.BillMonth).sort(), ["AUG-2026", "JUL-2026"]);

  section("TEST 3 — locking AUG does not lock JUL");
  await lockInstance("AUG-2026");
  aug = await getData(router, { billMonth: "AUG-2026" });
  jul = await getData(router, { billMonth: "JUL-2026" });
  check("3. AUG-2026 is LOCKED", statusOf(aug), "LOCKED");
  check("3. JUL-2026 is still DRAFT", statusOf(jul), "DRAFT");
  check("3. JUL-2026 can still be saved", (await saveDraft(router, { billMonth: "JUL-2026", basicPay: 11500,
    billNo: "729", billDate: "2026-08-20", npsScheduleNo: "SCH/JUL/TEST" })).status, 200);
  check("3. AUG-2026 cannot be saved", (await saveDraft(router, { billMonth: "AUG-2026", basicPay: 1 })).status, 409);
  check("3. AUG-2026 data untouched", Number(SED[0].BasicPay), 22222);
  check("3. JUL-2026 correction applied", Number(SEBED[0].BasicPay), 11500);

  /* ------------------------------------------------------------------ */
  section("TEST 4 — locking JUL does not lock AUG");
  resetTables();
  router = loadSalaryEntryRouterFresh();
  await saveDraft(router, { billMonth: "JUL-2026", basicPay: 11111 });
  await saveDraft(router, { billMonth: "AUG-2026", basicPay: 22222 });
  await lockInstance("JUL-2026");
  jul = await getData(router, { billMonth: "JUL-2026" });
  aug = await getData(router, { billMonth: "AUG-2026" });
  check("4. JUL-2026 is LOCKED", statusOf(jul), "LOCKED");
  check("4. AUG-2026 is still DRAFT", statusOf(aug), "DRAFT");
  check("4. AUG-2026 can still be saved", (await saveDraft(router, { billMonth: "AUG-2026", basicPay: 22300 })).status, 200);
  check("4. JUL-2026 cannot be saved", (await saveDraft(router, { billMonth: "JUL-2026", basicPay: 1 })).status, 409);
  check("4. JUL-2026 data untouched", Number(SEBED[0].BasicPay), 11111);
  check("4. AUG-2026 update applied", Number(SED[0].BasicPay), 22300);
  check("4. exactly two workflow rows, one per Bill Month",
    WORKFLOW.map((w) => `${w.BillMonth}:${w.Status}`).sort(), ["AUG-2026:DRAFT", "JUL-2026:LOCKED"]);

  /* ------------------------------------------------------------------ */
  section("TEST 7 — simulated backend restart preserves both instances");
  /* A fresh require of routes/salaryEntry.js against the SAME in-memory
     tables: what must survive a restart is the data in its own table, which
     is exactly what this exercises (a real OS restart cannot be simulated
     inside one Node process). */
  router = loadSalaryEntryRouterFresh();
  jul = await getData(router, { billMonth: "JUL-2026" });
  aug = await getData(router, { billMonth: "AUG-2026" });
  check("7. JUL-2026 after restart: Basic 11111, LOCKED", [basicOf(jul), statusOf(jul)], [11111, "LOCKED"]);
  check("7. AUG-2026 after restart: Basic 22300, DRAFT", [basicOf(aug), statusOf(aug)], [22300, "DRAFT"]);

  /* ------------------------------------------------------------------ */
  section("A never-entered Bill Month shows a fresh grid and DRAFT, never copied data or status");
  const jun = await getData(router, { billMonth: "JUN-2026" });
  check("JUN-2026 Get Data succeeds", jun.status, 200);
  check("JUN-2026 status is DRAFT (not JUL's LOCKED)", statusOf(jun), "DRAFT");
  check("JUN-2026 Basic is not a copy of JUL/AUG", [11111, 22300].includes(basicOf(jun)), false);
  check("viewing JUN-2026 wrote nothing", [SEBED.length, SED.length, WORKFLOW.length], [1, 1, 2]);


  /* ------------------------------------------------------------------ */
  section("PRE-EXISTING -BM- VARIANT BILL (e.g. 1019 AUG-2026-BM-JUL from Returned Bills) is its own canonical bill");
  /* A -BM- row is a SEPARATE bill whose Bill Month is part of its own
     identity: its data has always been in dbo.SalaryEmployeeDetails under
     its own BillCodeId, and migration 51 labelled its workflow row with its
     canonical label - exactly as the approval routes read it. It must
     never be treated as a non-canonical JUL instance of itself. */
  const VARIANT = {
    BillCodeId: 1019, BillCode: "AUG-2026-BM-JUL", BillMonth: "JUL-2026",
    SalaryMonth: "AUG-2026", SalaryMonthNumber: "08", SalaryYear: "2026",
    BillCategory: "Salary", BillType: "Regular Salary", Status: "OPEN", IsArchived: 0,
  };
  BILLS.push(VARIANT);
  resetTables({
    workflow: [{ WorkflowId: 40, SalaryBillCodeId: 1019, InstituteId: 16, InstituteCode: "DDRS-16", BillMonth: "AUG-2026", Status: "RETURNED" }],
    sed: [{ ...LIVE_AUG_SNAPSHOT, Id: 950, SalaryBillCodeId: 1019, BasicPay: 15555 }],
  });
  router = loadSalaryEntryRouterFresh();
  const v = await getData(router, { billCode: "AUG-2026-BM-JUL", billMonth: "JUL-2026" });
  check("BM. Get Data succeeds", v.status, 200);
  check("BM. loads the variant bill's OWN saved data (not an empty non-canonical grid)", basicOf(v), 15555);
  check("BM. shows its own workflow status (RETURNED), not DRAFT", statusOf(v), "RETURNED");
  check("BM. status came from its existing (migration-51-labelled) row", v.body?.bill?.workflowBillMonth, "AUG-2026");
  check("BM. Bill Month shown to the user is still JUL-2026", v.body?.bill?.billMonth, "JUL-2026");
  const vs = await saveDraft(router, { billCode: "AUG-2026-BM-JUL", billMonth: "JUL-2026", basicPay: 15600 });
  check("BM. correction save succeeds", vs.status, 200);
  check("BM. saved into its own SalaryEmployeeDetails row", [SED.length, SED[0].SalaryBillCodeId, Number(SED[0].BasicPay)], [1, 1019, 15600]);
  check("BM. nothing written to the per-Bill-Month table", SEBED.length, 0);
  check("BM. no second workflow row; RETURNED kept by Save Draft",
    WORKFLOW.map((w) => `${w.WorkflowId}:${w.BillMonth}:${w.Status}`), ["40:AUG-2026:RETURNED"]);
  check("BM. no new Bill Code was created", BILLS.map((b) => b.BillCode), ["AUG-2026", "AUG-2026-BM-JUL"]);
  BILLS.pop();

  /* ------------------------------------------------------------------ */
  section("resolveEntryInstance() - the single instance-identity rule used by GET and Save");
  const { resolveEntryInstance } = router;
  const master = MASTER;
  check("master + JUL-2026 -> non-canonical JUL-2026 instance",
    resolveEntryInstance({ bill: master, sourceBill: master, canonicalBillMonth: "JUL-2026", canonicalSalaryMonth: "AUG-2026" }),
    { instanceBillMonth: "JUL-2026", isCanonicalInstance: false, displayBillMonth: "JUL-2026" });
  check("master + AUG-2026 -> canonical AUG-2026 instance",
    resolveEntryInstance({ bill: master, sourceBill: master, canonicalBillMonth: "AUG-2026", canonicalSalaryMonth: "AUG-2026" }),
    { instanceBillMonth: "AUG-2026", isCanonicalInstance: true, displayBillMonth: "AUG-2026" });
  check("-BM- variant -> its own canonical instance, JUL-2026 still displayed",
    resolveEntryInstance({ bill: VARIANT, sourceBill: master, canonicalBillMonth: "JUL-2026", canonicalSalaryMonth: "AUG-2026" }),
    { instanceBillMonth: "AUG-2026", isCanonicalInstance: true, displayBillMonth: "JUL-2026" });

  console.log(`\n${"=".repeat(78)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(78));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
