/*
  SALARY BILL APPROVAL — Bill Month instance scoping (2026-09-24).

  Live report: the approval list showed AUG-2026 / DDRS-16 / Bill Month
  JUL-2026 / SUBMITTED, but View / Approve opened AUG-2026 / DDRS-16 /
  Bill Month AUG-2026 / LOCKED (WorkflowId 52).

  Cause: the deployed frontend bundle sends only instituteCode (no
  billMonth) to GET /:idOrCode and to verify/approve/return/reject/lock,
  and the backend silently defaulted a missing Bill Month to the bill's
  canonical Salary Month (AUG-2026).

  This runs the REAL routes/salaryBillApproval.js handlers against an
  in-memory database seeded exactly like the live data:
    WorkflowId 52: 1018 / DDRS-16 / AUG-2026 / LOCKED (approved by System Administrator)
    WorkflowId 53: 1018 / DDRS-16 / JUL-2026 / SUBMITTED

  Usage: cd backend && npm run test:salary-approval-bill-month
*/
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
process.env.SALARY_APPROVAL_TRACE_FILE = "0";
process.env.SALARY_ENTRY_TRACE_FILE = "0";

/* ===================== IN-MEMORY TABLES ===================== */
const BILL = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary", Status: "OPEN", IsArchived: 0,
};
const INSTITUTE = { InstituteId: 16, InstituteCode: "DDRS-16", InstituteName: "SPECIAL CARE CENTER FOR SLOW LEARNERS" };
const AUDITOR = { UserId: 2, UserName: "auditor", FullName: "Auditor", RoleId: 3, RoleName: "AUDITOR", IsActive: 1 };

const ROW_52 = {
  WorkflowId: 52, SalaryBillCodeId: 1018, InstituteId: 16, InstituteCode: "DDRS-16",
  BillMonth: "AUG-2026", Status: "LOCKED", SubmittedBy: "System Administrator",
  ApprovedBy: "System Administrator", LockedBy: "System Administrator",
};
const ROW_53 = {
  WorkflowId: 53, SalaryBillCodeId: 1018, InstituteId: 16, InstituteCode: "DDRS-16",
  BillMonth: "JUL-2026", Status: "SUBMITTED", SubmittedBy: "System Administrator", SubmittedByUserId: 2,
};
const emp = (id, name, basic, extra = {}) => ({
  Id: id, SalaryBillCodeId: 1018, InstituteCode: "DDRS-16", EmployeeId: 2000 + id,
  EmployeeName: name, Designation: "ASSISTANT TEACHER", EmployeeType: "REGULAR", PensionType: "GPF",
  DisplayOrder: id, BasicPay: basic, GradePay: 0, TotalBasic: basic, DA: 0, HRA: 0, MA: 0, TA: 0, CLA: 0,
  SpecialAllowance: 0, WashingAllowance: 0, OtherEarnings: 0, NPPA: 0, GrossSalary: basic,
  GPFSubscription: 0, GPFAdvance: 0, NPS: 0, IncomeTax: 0, ProfessionalTax: 0, OtherDeduction: 0,
  TotalDeduction: 0, NetSalary: basic, ChequeAmount: basic, ...extra,
});

let WORKFLOW, SED, SEBED, HISTORY;
function reset() {
  WORKFLOW = [{ ...ROW_52 }, { ...ROW_53 }];
  SED = [emp(1, "AUG ONE", 22222), emp(2, "AUG TWO", 22222), emp(3, "AUG THREE", 22222)];
  SEBED = [1, 2, 3].map((i) => emp(i, `JUL ${i}`, 11111, { BillMonth: "JUL-2026" }));
  HISTORY = [];
}
reset();
const snapshotAug = () => JSON.stringify(WORKFLOW.find((w) => w.WorkflowId === 52));

/* ===================== SQL STUB ===================== */
function captureParen(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") { depth--; if (depth === 0) return { content: text.slice(start + 1, i), end: i }; }
  }
  return null;
}
function splitTopLevel(str) {
  const parts = []; let depth = 0; let cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function handleInsert(text, values) {
  const table = (text.match(/INSERT INTO\s+dbo\.(\w+)/i) || [])[1];
  if (!/VALUES\s*\(/i.test(text)) return { recordset: [] };
  const m = text.match(/INSERT INTO\s+dbo\.\w+\s*\(/i);
  const cols = captureParen(text, m.index + m[0].length - 1);
  const after = text.slice(cols.end + 1);
  const v = after.match(/VALUES\s*\(/i);
  const vals = captureParen(after, v.index + v[0].length - 1);
  const obj = {}; let vi = 0;
  splitTopLevel(cols.content).forEach((c, i) => { obj[c] = splitTopLevel(vals.content)[i] === "?" ? values[vi++] : undefined; });
  if (table === "SalaryBillInstituteWorkflow") {
    WORKFLOW.push({ WorkflowId: Math.max(...WORKFLOW.map((w) => w.WorkflowId)) + 1, ...obj });
  } else if (table === "SalaryBillApprovalHistory") {
    HISTORY.push(obj);
  }
  return { recordset: [] };
}
function handleUpdate(text, values) {
  const mt = text.match(/UPDATE\s+dbo\.(\w+)\s+SET\s+/i);
  if (!mt) return { recordset: [] };
  const rest = text.slice(mt.index + mt[0].length);
  const w = rest.match(/\bWHERE\b/i);
  const setPart = w ? rest.slice(0, w.index) : rest;
  const wherePart = w ? rest.slice(w.index + 5) : "";
  let vi = 0;
  const consume = (seg, target) => {
    for (let i = 0; i < seg.length; i++) if (seg[i] === "?") {
      const m = seg.slice(0, i).match(/(\w+)\s*=\s*$/);
      const val = values[vi++];
      if (m) target[m[1]] = val;
    }
  };
  const set = {}; const where = {};
  consume(setPart, set); consume(wherePart, where);
  const lit = /(\w+)\s*=\s*N'([^']*)'/g; let lm;
  while ((lm = lit.exec(setPart))) set[lm[1]] = lm[2];
  if (mt[1] === "SalaryBillInstituteWorkflow") {
    const target = where.WorkflowId != null
      ? WORKFLOW.filter((r) => r.WorkflowId === Number(where.WorkflowId))
      : WORKFLOW.filter((r) => r.SalaryBillCodeId === where.SalaryBillCodeId && r.InstituteCode === where.InstituteCode && (where.BillMonth == null || r.BillMonth === where.BillMonth));
    target.forEach((r) => Object.assign(r, set));
  }
  return { recordset: [] };
}
const queries = [];
function run(strings, values) {
  const text = (typeof strings === "string" ? strings : strings.join("?")).replace(/\s+/g, " ").trim();
  queries.push(text);
  if (/FROM dbo\.SalaryBillCodes WHERE BillCodeId = \?/i.test(text)) return { recordset: Number(values[0]) === 1018 ? [BILL] : [] };
  if (/FROM dbo\.SalaryBillCodes WHERE BillCode = \?/i.test(text)) return { recordset: values[0] === "AUG-2026" ? [BILL] : [] };
  if (/OUTER APPLY/i.test(text) && /FROM dbo\.SalaryBillInstituteWorkflow w/i.test(text)) {
    return {
      recordset: WORKFLOW.filter((w) => ["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(w.Status)).map((w) => ({
        ...w, BillCodeId: w.SalaryBillCodeId, WorkflowBillMonth: w.BillMonth, BillCode: BILL.BillCode,
        BillMonth: BILL.BillMonth, SalaryMonth: BILL.SalaryMonth, SalaryYear: BILL.SalaryYear,
        BillCategory: BILL.BillCategory, BillType: BILL.BillType, MasterStatus: BILL.Status,
        InstituteName: INSTITUTE.InstituteName, EmployeeCount: 3,
      })),
    };
  }
  if (/SELECT WorkflowId, BillMonth FROM dbo\.SalaryBillInstituteWorkflow/i.test(text)) {
    const [id, code] = values;
    return { recordset: WORKFLOW.filter((w) => w.SalaryBillCodeId === id && w.InstituteCode === code).map((w) => ({ WorkflowId: w.WorkflowId, BillMonth: w.BillMonth })) };
  }
  if (/SELECT TOP 1 \* FROM dbo\.SalaryBillInstituteWorkflow/i.test(text)) {
    const [id, code, month] = values;
    const row = WORKFLOW.find((w) => w.SalaryBillCodeId === id && w.InstituteCode === code && w.BillMonth === month);
    return { recordset: row ? [{ ...row }] : [] };
  }
  if (/FROM dbo\.Institutes WHERE InstituteCode = \?/i.test(text)) return { recordset: values[0] === "DDRS-16" ? [INSTITUTE] : [] };
  if (/FROM dbo\.SalaryEntryBillEmployeeDetails d/i.test(text)) {
    const [id, code, month] = values;
    return { recordset: SEBED.filter((r) => r.SalaryBillCodeId === id && r.InstituteCode === code && r.BillMonth === month) };
  }
  if (/FROM dbo\.SalaryEmployeeDetails d/i.test(text)) {
    const [id, code] = values;
    return { recordset: SED.filter((r) => r.SalaryBillCodeId === id && r.InstituteCode === code) };
  }
  if (/FROM dbo\.SalaryBillApprovalHistory/i.test(text)) return { recordset: [] };
  if (/FROM dbo\.Users u INNER JOIN dbo\.Roles r/i.test(text)) return { recordset: Number(values[0]) === 2 ? [AUDITOR] : [] };
  if (/FROM dbo\.Users WHERE UserId = \?/i.test(text)) return { recordset: Number(values[0]) === 2 ? [AUDITOR] : [] };
  if (/^INSERT INTO/i.test(text)) return handleInsert(text, values);
  if (/^UPDATE/i.test(text)) return handleUpdate(text, values);
  return { recordset: [] };
}
function query(strings, ...values) { return Promise.resolve(run(strings, values)); }
function RequestCtor() { return { query, input() { return this; }, multiple: false }; }
function TransactionCtor() { return { begin: async () => {}, commit: async () => {}, rollback: async () => {} }; }
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath; stub.loaded = true;
stub.exports = { sql: { query, Request: RequestCtor, Transaction: TransactionCtor, Int: "Int", NVarChar: "NVarChar" }, connectDB: async () => true };
require.cache[dbPath] = stub;

const router = require("../routes/salaryBillApproval");
function handler(method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`${method} ${routePath} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle; /* skip the accountOfficerOnly role guard */
}
async function call(method, routePath, { params = {}, query: q = {}, body = {} } = {}) {
  let status = 200; let payload = null;
  const res = { status(c) { status = c; return this; }, json(p) { payload = p; return this; } };
  await handler(method, routePath)({ params, query: q, body, user: { userName: "ao", roleName: "ACCOUNT_OFFICER" } }, res);
  return { status, body: payload };
}
/* The frontend's own decisions, from AccountOfficerBills.jsx. */
const displayStatus = (s) => (String(s).toUpperCase() === "VERIFIED" ? "AO_VERIFIED" : String(s).toUpperCase());
const approveVisible = (st) => (st !== "LOCKED" && (st === "SUBMITTED" || st === "RESUBMITTED")) || st === "AO_VERIFIED";

const openDetail = (billMonth, id = "1018") =>
  call("get", "/:idOrCode", { params: { idOrCode: id }, query: { instituteCode: "DDRS-16", ...(billMonth ? { billMonth } : {}) } });
const act = (action, billMonth, extra = {}) =>
  call("post", `/:idOrCode/${action}`, {
    params: { idOrCode: "1018" },
    body: { instituteCode: "DDRS-16", fullName: "Accounts Officer", ...(billMonth ? { billMonth } : {}), ...extra },
  });

let passed = 0; let failed = 0;
function section(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`); }
}

(async () => {
  console.log("=".repeat(78));
  console.log("Salary Bill Approval: each Bill Month instance is opened and acted on independently");
  console.log("=".repeat(78));

  section("LIST — the queue row carries its own Bill Month identity");
  const list = await call("get", "/", { query: { status: "PENDING" } });
  const julRow = (list.body?.data || []).find((b) => b.billMonth === "JUL-2026");
  check("list succeeds", list.status, 200);
  check("JUL-2026 row listed (AUG-2026 LOCKED is not pending)", (list.body?.data || []).map((b) => `${b.billCode}/${b.instituteCode}/${b.billMonth}/${b.status}`), ["AUG-2026/DDRS-16/JUL-2026/SUBMITTED"]);
  check("row id carries the Bill Month", julRow?.id, "1018__DDRS-16__JUL-2026");
  check("row workflowId is 53", julRow?.workflowId, 53);

  section("ROOT CAUSE — the deployed bundle's request (no billMonth) must never open AUG-2026");
  const noMonth = await openDetail(null);
  check("detail without Bill Month is refused (400), not defaulted to AUG-2026", noMonth.status, 400);
  check("...with code BILL_MONTH_REQUIRED naming both instances",
    [noMonth.body?.code, /AUG-2026, JUL-2026/.test(noMonth.body?.message || "")], ["BILL_MONTH_REQUIRED", true]);
  const noMonthApprove = await act("approve", null);
  check("approve without Bill Month is refused (400)", noMonthApprove.status, 400);
  check("...and changes nothing", WORKFLOW.map((w) => `${w.WorkflowId}:${w.Status}`), ["52:LOCKED", "53:SUBMITTED"]);

  section("TEST 1 — AUG-2026 + DDRS-16 + JUL-2026: detail JUL-2026, SUBMITTED, Approve visible");
  const jul = await openDetail("JUL-2026");
  check("detail succeeds", jul.status, 200);
  check("Bill Month JUL-2026", jul.body?.data?.billMonth, "JUL-2026");
  check("workflow 53, SUBMITTED", [jul.body?.data?.workflowId, jul.body?.data?.status], [53, "SUBMITTED"]);
  check("JUL's own employee data (Basic 11111 x 3)", (jul.body?.data?.employees || []).map((e) => e.basicPay), [11111, 11111, 11111]);
  check("Approve / Return visible", approveVisible(displayStatus(jul.body?.data?.status)), true);
  const julById = await openDetail(null, "1018__DDRS-16__JUL-2026");
  check("the queue row's composite id alone also opens JUL-2026", [julById.status, julById.body?.data?.billMonth], [200, "JUL-2026"]);

  section("TEST 2 — AUG-2026 + DDRS-16 + AUG-2026: detail AUG-2026, WorkflowId 52, LOCKED, no Approve");
  const aug = await openDetail("AUG-2026");
  check("Bill Month AUG-2026", aug.body?.data?.billMonth, "AUG-2026");
  check("workflow 52, LOCKED", [aug.body?.data?.workflowId, aug.body?.data?.status], [52, "LOCKED"]);
  check("AUG's own employee data (Basic 22222 x 3)", (aug.body?.data?.employees || []).map((e) => e.basicPay), [22222, 22222, 22222]);
  check("Approve NOT visible", approveVisible(displayStatus(aug.body?.data?.status)), false);

  section("TEST 3 / 4 — switching between the two never bleeds status");
  await openDetail("JUL-2026");
  check("JUL then AUG -> AUG still LOCKED", (await openDetail("AUG-2026")).body?.data?.status, "LOCKED");
  await openDetail("AUG-2026");
  check("AUG then JUL -> JUL still SUBMITTED", (await openDetail("JUL-2026")).body?.data?.status, "SUBMITTED");

  section("TEST 5 — approving JUL changes only JUL");
  const augBefore = snapshotAug();
  const ap = await act("approve", "JUL-2026");
  check("approve JUL succeeds", ap.status, 200);
  check("response is the JUL instance, APPROVED", [ap.body?.data?.billMonth, ap.body?.data?.status], ["JUL-2026", "APPROVED"]);
  check("row 53 APPROVED", WORKFLOW.find((w) => w.WorkflowId === 53).Status, "APPROVED");
  check("row 52 byte-for-byte unchanged", snapshotAug(), augBefore);
  const lk = await call("post", "/:idOrCode/lock", { params: { idOrCode: "1018" }, body: { instituteCode: "DDRS-16", billMonth: "JUL-2026", fullName: "Accounts Officer" } });
  check("lock JUL succeeds", lk.status, 200);
  check("row 53 LOCKED, row 52 unchanged", [WORKFLOW.find((w) => w.WorkflowId === 53).Status, snapshotAug()], ["LOCKED", augBefore]);
  check("no workflow row created or removed", WORKFLOW.length, 2);
  check("approving AUG (already LOCKED) is still refused", (await act("approve", "AUG-2026")).status, 409);

  section("TEST 6 — returning JUL changes only JUL");
  reset();
  const augBefore2 = snapshotAug();
  const rt = await act("return", "JUL-2026", { returnedToAuditorId: 2, returnedRemarks: "Correct Basic Pay" });
  check("return JUL succeeds", rt.status, 200);
  check("row 53 RETURNED to auditor 2", [WORKFLOW[1].Status, WORKFLOW[1].ReturnedToAuditorId], ["RETURNED", 2]);
  check("row 52 unchanged", snapshotAug(), augBefore2);
  const rj = await (async () => { reset(); return act("reject", "JUL-2026", { rejectReason: "Wrong month" }); })();
  check("reject JUL touches only row 53", [rj.status, WORKFLOW[1].Status, snapshotAug()], [200, "REJECTED", augBefore2]);

  section("ACTION MESSAGES — every result names Salary Month, Institute AND the Bill Month acted on");
  const EXPECT = (verb) => `Salary Month AUG-2026 / Institute DDRS-16 / Bill Month JUL-2026 ${verb}.`;
  const identity = (r) => [r.body?.data?.billCode, r.body?.data?.instituteCode, r.body?.data?.billMonth, r.body?.data?.workflowId, r.body?.data?.status];

  reset(); let before = snapshotAug();
  const mRet = await act("return", "JUL-2026", { returnedToAuditorId: 2, returnedRemarks: "Correct Basic Pay" });
  check("A/D. return response identifies the JUL instance", identity(mRet), ["AUG-2026", "DDRS-16", "JUL-2026", 53, "RETURNED"]);
  check("E. return message names Bill Month JUL-2026", mRet.body?.message, EXPECT("returned to auditor"));
  check("A/C. return changed only row 53; row 52 unchanged", [WORKFLOW[1].Status, snapshotAug()], ["RETURNED", before]);

  reset(); before = snapshotAug();
  const mVer = await act("verify", "JUL-2026");
  check("D. verify response identifies the JUL instance", identity(mVer), ["AUG-2026", "DDRS-16", "JUL-2026", 53, "VERIFIED"]);
  check("E. verify message names Bill Month JUL-2026", mVer.body?.message, EXPECT("verified"));
  const mApp = await act("approve", "JUL-2026");
  check("B/D. approve response identifies the JUL instance", identity(mApp), ["AUG-2026", "DDRS-16", "JUL-2026", 53, "APPROVED"]);
  check("E. approve message names Bill Month JUL-2026", mApp.body?.message, EXPECT("approved"));
  const mLock = await call("post", "/:idOrCode/lock", { params: { idOrCode: "1018" }, body: { instituteCode: "DDRS-16", billMonth: "JUL-2026", fullName: "Accounts Officer" } });
  check("D. lock response identifies the JUL instance",
    [mLock.body?.billCode, mLock.body?.instituteCode, mLock.body?.billMonth, mLock.body?.workflowId, mLock.body?.status],
    ["AUG-2026", "DDRS-16", "JUL-2026", 53, "LOCKED"]);
  check("E. lock message names Bill Month JUL-2026", String(mLock.body?.message || "").startsWith(EXPECT("locked")), true);
  check("B/C. verify+approve+lock changed only row 53; row 52 byte-for-byte unchanged", [WORKFLOW[1].Status, snapshotAug()], ["LOCKED", before]);

  reset(); before = snapshotAug();
  const mRej = await act("reject", "JUL-2026", { rejectReason: "Wrong month" });
  check("E. reject message names Bill Month JUL-2026", mRej.body?.message, EXPECT("rejected"));
  check("C. reject changed only row 53", [WORKFLOW[1].Status, snapshotAug()], ["REJECTED", before]);
  reset();

  {
    const page = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "AccountOfficerBills.jsx"), "utf8");
    const modal = (title) => { const i = page.indexOf(`title="${title}"`); return i < 0 ? "" : page.slice(i, page.indexOf("</Modal>", i)); };
    check("F. Return modal shows Bill Code, Bill Month, Institute and Institute Name",
      ["Bill Code:", "Bill Month:</strong> {selectedBill.billMonth", "Institute:</strong> {selectedBill.instituteCode}", "Institute Name:</strong> {selectedBill.instituteName}"].every((t) => modal("Return Salary Bill").includes(t)), true);
    check("G. Approve modal shows Bill Month", /label="Bill Month"\s*value=\{selectedBill\.billMonth/.test(modal("Approve Salary Bill")), true);
    check("Verify modal shows Bill Month", modal("Verify Salary Bill").includes("Bill Month:</strong> {selectedBill.billMonth"), true);
    check("no alert is built from Bill Code + Institute alone",
      /alert\(`\$\{mapped\.billCode\} \/ \$\{mapped\.instituteCode\}/.test(page), false);
    check("verify / approve / return / lock alerts all use the response's Bill Month",
      ["\"verified\"", "\"approved\"", "\"returned to auditor\"", "\"locked\""].every((v) => page.includes(`approvalActionMessage(`) && page.includes(v)), true);
    check("message helper prefers the RESPONSE Bill Month and flags a mismatch",
      /const billMonth = result\?\.billMonth \|\| requested\?\.billMonth/.test(page) && /server acted on Bill Month/.test(page), true);
  }

  section("TEST 7 / 8 — no change to cheque/report data or Salary Entry");
  check("no employee salary row was written by any approval action",
    [SED.map((r) => r.BasicPay), SEBED.map((r) => r.BasicPay)], [[22222, 22222, 22222], [11111, 11111, 11111]]);
  check("no query ever wrote SalaryEmployeeDetails / SalaryEntryBillEmployeeDetails / SalaryBillCodes",
    queries.some((q) => /^(UPDATE|INSERT INTO|DELETE FROM) dbo\.(SalaryEmployeeDetails|SalaryEntryBillEmployeeDetails|SalaryBillCodes)\b/i.test(q)), false);
  const approvalSrc = fs.readFileSync(path.join(ROOT, "routes", "salaryBillApproval.js"), "utf8");
  check("mapInstituteBill never falls back to the bill master's BillMonth",
    /const instanceBillMonth = row\.WorkflowBillMonth \|\| "";/.test(approvalSrc), true);
  check("no approval route defaults a missing Bill Month to the canonical month",
    (approvalSrc.match(/resolveInstanceBillMonth\(\s*bill,\s*req\./g) || []).length, 0);
  const pageSrc = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "AccountOfficerBills.jsx"), "utf8");
  const apiSrc = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "utils", "salaryBillApprovalApi.js"), "utf8");
  check("frontend source: detail request sends billMonth", /if \(billMonth\) params\.set\("billMonth"/.test(apiSrc), true);
  check("frontend source: View / Approve passes the clicked row's billMonth", /getApprovalBill\(\s*bill\.billCodeId \|\| bill\.billCode,\s*bill\.instituteCode,\s*bill\.billMonth\s*\)/.test(pageSrc), true);
  check("frontend source: a detail for another Bill Month is refused, never shown",
    /mapped\.billMonth !== bill\.billMonth/.test(pageSrc), true);
  for (const fn of ["verifyApprovalBill", "approveApprovalBill", "returnApprovalBill"]) {
    check(`frontend source: ${fn} sends selectedBill.billMonth`,
      new RegExp(`${fn}\\([\\s\\S]{0,260}?billMonth: selectedBill\\.billMonth|${fn}\\([\\s\\S]{0,260}?selectedBill\\.billMonth`).test(pageSrc), true);
  }
  check("frontend source: lock sends selectedBill.billMonth", /lockApprovalInstitute\([^)]*selectedBill\.billMonth\)/.test(pageSrc), true);

  console.log(`\n${"=".repeat(78)}\nPassed: ${passed}    Failed: ${failed}\n${"=".repeat(78)}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
