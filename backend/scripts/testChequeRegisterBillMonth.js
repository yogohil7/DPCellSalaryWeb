/**
 * CHEQUE REGISTER — one row per approved Bill Month INSTANCE (2026-09-24).
 *
 * The AUG-2026 salary bill (BillCodeId 1018) has two approved instances for
 * DDRS-16: Bill Month AUG-2026 (WorkflowId 52) and Bill Month JUL-2026.
 * Cheque Register used SalaryBillCodes.BillMonth / the Salary Month for
 * every row, so both rows showed AUG-2026, and totalled the JUL instance
 * from the AUG instance's employee table.
 *
 * Runs the REAL routes/chequeRegister.js report builder
 * (buildChequeRegisterReport) against a stubbed database that returns
 * exactly what the two new instance queries return for the live data.
 *
 * Usage:  cd backend && npm run test:cheque-register-bill-month
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

const base = {
  BillCodeId: 1018, BillCode: "AUG-2026", BillMonth: "August",
  SalaryMonth: "August", SalaryMonthNumber: "08", SalaryYear: "2026",
  BillCategory: "Salary", BillType: "Regular Salary",
  InstituteCode: "DDRS-16", InstituteId: 16,
  InstituteName: "SPECIAL CARE CENTER FOR SLOW LEARNERS", Place: "SURAT",
  SectionId: 7, SectionName: "DDRS SECTION", BillNo: null, BillDate: null,
};
const amounts = (basic) => ({
  EmpCount: 3, BasicPay: basic, GradePay: 0, TotalBasic: basic, DA: 1000, HRA: 100, CLA: 0, MA: 10,
  TA: 20, SpecialAllowance: 0, GrossSalary: basic + 1130, NPS: 0, GPFSubscription: 50, IncomeTax: 5,
  ProfessionalTax: 7, OtherDeduction: 0, NetSalary: basic + 1068, ChequeAmount: basic + 1080,
});
/* What the canonical query returns: WorkflowId 52, AUG-2026, LOCKED, SalaryEmployeeDetails. */
const AUG_ROW = { ...base, ...amounts(114300), WorkflowId: 52, WorkflowBillMonth: "AUG-2026", WorkflowStatus: "LOCKED" };
/* What the instance query returns: the JUL-2026 workflow row, SalaryEntryBillEmployeeDetails. */
const JUL_ROW = { ...base, ...amounts(33333), WorkflowId: 62, WorkflowBillMonth: "JUL-2026", WorkflowStatus: "LOCKED" };
/* A pre-existing -BM- variant bill: its own Bill Month is its identity. */
const BM_ROW = {
  ...base, ...amounts(5000), BillCodeId: 1019, BillCode: "AUG-2026-BM-JUL", BillMonth: "JUL-2026",
  SalaryMonth: "AUG-2026", InstituteCode: "DDRS-10", InstituteName: "DDRS TEN", WorkflowId: 40,
  WorkflowBillMonth: "AUG-2026", WorkflowStatus: "APPROVED",
};
/* Live shape: the JUL instance has a Bill-Month header (701, 11-08-2026);
   the AUG instance has none - its 849 / 03-09-2026 are the legacy columns
   on its OWN workflow row 52 (saved before migration 49). */
const HEADERS = [
  { SalaryBillCodeId: 1018, InstituteCode: "DDRS-16", BillMonth: "JUL-2026", BillNo: "701", BillDate: "2026-08-11", NPSScheduleNo: "SCH/JUL" },
];
AUG_ROW.BillNo = "849"; AUG_ROW.BillDate = "2026-09-03";

const queries = [];
function run(strings, values) {
  const text = (typeof strings === "string" ? strings : strings.join("?")).replace(/\s+/g, " ");
  queries.push(text);
  if (/JOIN dbo\.SalaryEntryBillEmployeeDetails d/i.test(text)) return { recordset: [JUL_ROW] };
  if (/JOIN dbo\.SalaryEmployeeDetails d/i.test(text)) return { recordset: [AUG_ROW, BM_ROW] };
  if (/DADifferenceEmployeeDetails/i.test(text)) return { recordset: [] };
  if (/FROM dbo\.SalaryEntryBillHeader/i.test(text)) return { recordset: HEADERS };
  return { recordset: [] };
}
const query = (s, ...v) => Promise.resolve(run(s, v));
const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath; stub.loaded = true;
stub.exports = {
  sql: { query, Request: function R() { return { query, input() { return this; } }; } },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const cr = require("../routes/chequeRegister");

let passed = 0; let failed = 0;
function section(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`); }
}
const view = (r) => [r.instituteCode, r.billMonthQueried, r.type, r.salaryMonthName];
const ddrs16 = (rows) => rows.filter((r) => r.instituteCode === "DDRS-16").sort((a, b) => a.workflowId - b.workflowId);

(async () => {
  console.log("=".repeat(78));
  console.log("Cheque Register: Bill Month and TYPE come from each approved instance");
  console.log("=".repeat(78));

  section("parseExplicitBillMonth (unchanged)");
  check("blank -> Auto", cr.parseExplicitBillMonth("", "2026"), "");
  check("JUL-26 -> JUL-2026", cr.parseExplicitBillMonth("JUL-26", "2026"), "JUL-2026");
  check("July -> JUL-2026", cr.parseExplicitBillMonth("July", "2026"), "JUL-2026");

  section("SCREEN REGRESSION — August 2026, Auto: both DDRS-16 instances, each with its own Bill Month");
  const auto = await cr.buildChequeRegisterReport({ month: "8", year: "2026" });
  const [aug, jul] = ddrs16(auto.rows);
  check("two separate DDRS-16 rows (not grouped by BillCodeId + Institute)", ddrs16(auto.rows).length, 2);
  check("AUG instance: DDRS-16 | AUG-2026 | REGULAR | AUGUST", view(aug), ["DDRS-16", "AUG-2026", "REGULAR", "AUGUST"]);
  check("JUL instance: DDRS-16 | JUL-2026 | OLD | AUGUST", view(jul), ["DDRS-16", "JUL-2026", "OLD", "AUGUST"]);
  check("JUL row is not converted to AUG (Bill Month column values differ)", [aug.billMonthQueried, jul.billMonthQueried], ["AUG-2026", "JUL-2026"]);
  check("each row keeps its own workflow id (52 / 62)", [aug.workflowId, jul.workflowId], [52, 62]);
  check("JUL amounts come from the JUL instance's own employee rows", [jul.basic, aug.basic], [33333, 114300]);
  check("AUG amounts unchanged", [aug.emp, aug.grossAmount, aug.netAmount], [3, 115430, 115368]);
  check("TEST 6/7. AUG keeps its own Bill No. 849 / 03-09-2026 (its own workflow row)", [aug.billNo, aug.billDate, aug.headerSource], ["849", "2026-09-03", "workflow-row"]);
  check("TEST 4/5. JUL shows its own Bill No. 701 / 11-08-2026 (its header), never AUG's", [jul.billNo, jul.billDate, jul.headerSource], ["701", "2026-08-11", "SalaryEntryBillHeader"]);
  check("TEST 4/5. JUL never inherits 849 / 03-09-2026", jul.billNo === "849" || jul.billDate === "2026-09-03", false);
  check("totals include both instances", auto.totals.basic, 114300 + 33333 + 5000);

  section("-BM- variant bill (e.g. AUG-2026-BM-JUL) keeps its own Bill Month");
  const bm = auto.rows.find((r) => r.billCode === "AUG-2026-BM-JUL");
  check("variant shows JUL-2026 / OLD, not its workflow row's AUG-2026", [bm.billMonthQueried, bm.type], ["JUL-2026", "OLD"]);

  section("BILL MONTH FILTER");
  const julOnly = await cr.buildChequeRegisterReport({ month: "8", year: "2026", billMonth: "JUL-26" });
  check("JUL-2026 selected -> only JUL-2026 instances", julOnly.rows.map((r) => `${r.instituteCode}:${r.billMonthQueried}:${r.type}`), ["DDRS-10:JUL-2026:OLD", "DDRS-16:JUL-2026:OLD"]);
  const augOnly = await cr.buildChequeRegisterReport({ month: "8", year: "2026", billMonth: "AUG-2026" });
  check("AUG-2026 selected -> only the AUG-2026 instance, still shown as AUG-2026", augOnly.rows.map((r) => `${r.instituteCode}:${r.billMonthQueried}:${r.type}`), ["DDRS-16:AUG-2026:REGULAR"]);
  const sep = await cr.buildChequeRegisterReport({ month: "8", year: "2026", billMonth: "SEP-2026" });
  check("a Bill Month with no approved instance -> no rows (never relabelled)", sep.rows.length, 0);
  const oldTable = await cr.buildChequeRegisterReport({ month: "8", year: "2026", table: "OLD" });
  check("Salary Type OLD -> the JUL instances only", oldTable.rows.map((r) => r.billMonthQueried), ["JUL-2026", "JUL-2026"]);

  section("TYPE rule");
  const type = (billMonth) => cr.mapAggregateRow({ ...base, ...amounts(1), WorkflowBillMonth: billMonth, WorkflowStatus: "APPROVED" }, 1).type;
  check("AUG-2026 / AUG-2026 -> REGULAR", type("AUG-2026"), "REGULAR");
  check("AUG-2026 / JUL-2026 -> OLD", type("JUL-2026"), "OLD");
  check("AUG-2026 / SEP-2026 -> OLD", type("SEP-2026"), "OLD");
  check("TYPE ignores SalaryBillCodes.BillMonth when the instance differs",
    cr.mapAggregateRow({ ...base, ...amounts(1), BillMonth: "AUG-2026", WorkflowBillMonth: "JUL-2026", WorkflowStatus: "APPROVED" }, 1).type, "OLD");

  section("QUERIES — instance-keyed, read-only");
  const src = fs.readFileSync(path.join(ROOT, "routes", "chequeRegister.js"), "utf8");
  const salaryQueries = queries.filter((q) => /JOIN dbo\.(SalaryEmployeeDetails|SalaryEntryBillEmployeeDetails) d/.test(q));
  check("both salary queries select and group by the workflow Bill Month",
    salaryQueries.every((q) => /w\.BillMonth AS WorkflowBillMonth/.test(q) && /GROUP BY[\s\S]*w\.InstituteCode, w\.BillMonth/.test(q)), true);
  check("instance query joins SalaryEntryBillEmployeeDetails on the exact Bill Month",
    salaryQueries.some((q) => /JOIN dbo\.SalaryEntryBillEmployeeDetails d[\s\S]*d\.BillMonth = w\.BillMonth/.test(q)), true);
  check("canonical query only takes the canonical instance (or a -BM- variant) from SalaryEmployeeDetails",
    salaryQueries.some((q) => /JOIN dbo\.SalaryEmployeeDetails d[\s\S]*w\.BillMonth = UPPER\(LEFT\(LTRIM\(RTRIM\(b\.SalaryMonth\)\), 3\)\)/.test(q)), true);
  check("no query writes anything", queries.some((q) => /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(q)), false);

  section("COLUMNS — no NPS Schedule No.; Bill Month | TYPE | Salary Month");
  const xl = cr.XLSX_COLUMNS.map((c) => c.label);
  check("Excel: no NPS Schedule No.", xl.includes("NPS Schedule No."), false);
  check("Excel: Date, Bill Month, TYPE, Group (no Salary Month column)", xl.slice(4, 8), ["Date", "Bill Month", "TYPE", "Group"]);
  check("Excel: no Salary Month column", xl.includes("Salary Month"), false);
  const page = fs.readFileSync(path.join(ROOT, "..", "frontend", "src", "pages", "ChequeRegister.jsx"), "utf8");
  const colBlock = page.match(/const COLUMNS = \[([\s\S]*?)\];/)[1];
  const labels = [...colBlock.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  check("Screen/Copy/CSV/PDF: no NPS Schedule No. column", labels.includes("NPS Schedule No."), false);
  check("Screen/Copy/CSV/PDF: Bill Month | TYPE | Group order, no Salary Month column",
    labels.slice(0, 9), ["Sr. No.", "Name of Institute", "Place", "Bill No.", "Date", "Bill Month", "TYPE", "Group", "EMP"]);
  check("Screen/Copy/CSV/PDF: no Salary Month column", labels.includes("Salary Month"), false);
  check("page never displays an NPS Schedule No.", /npsScheduleNo|NPS Schedule No\./.test(page), false);
  const body = page.slice(page.indexOf("<tbody>"), page.indexOf("</tbody>"));
  check("table cells in the same order as the header",
    [...body.matchAll(/<td>\{(billMonthOf)\(row\)\}<\/td>|\{row\.(type|group)\b/g)].map((m) => m[1] || m[2]),
    ["billMonthOf", "type", "group"]);
  check("TOTAL label spans the 8 identity columns", /<td colSpan=\{8\} className="cr-left">\s*TOTAL/.test(page), true);

  console.log(`\n${"=".repeat(78)}\nPassed: ${passed}    Failed: ${failed}\n${"=".repeat(78)}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
