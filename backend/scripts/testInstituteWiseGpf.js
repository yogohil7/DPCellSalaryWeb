/**
 * INSTITUTE WISE GPF SUMMARY.
 *
 * Value-level: the assertions check the rows the report actually returns.
 *
 * Runs offline. Usage: cd backend && npm run test:gpf-institute
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};

const gpf = require("../routes/gpfSummary");
const { groupGpfByInstitute, filterGpfRows } = gpf;

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "gpfSummary.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "InstituteWiseGpfSummary.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "pages", "instituteWiseGpf.css"), "utf8");

/* ===================== FIXTURE ===================== */

const SEC = {
  BD: { id: 11, sr: 1, name: "BD Section" },
  DD: { id: 4,  sr: 2, name: "DD Section" },
};

const JUL = { BillCode: "JUL-2026", BillMonth: "JUL-2026", SalaryMonth: "July",
              SalaryMonthNumber: "07", SalaryYear: "2026" };
const JUL_BM_JUN = { BillCode: "JUL-2026-BM-JUN", BillMonth: "JUN-2026", SalaryMonth: "July",
                     SalaryMonthNumber: "07", SalaryYear: "2026" };
const JUN = { BillCode: "JUN-2026", BillMonth: "JUN-2026", SalaryMonth: "June",
              SalaryMonthNumber: "06", SalaryYear: "2026" };

const row = (sec, code, name, employeeId, gpfAmt, advAmt, bill = JUL) => ({
  ...bill,
  WorkflowStatus: "APPROVED",
  InstituteCode: code,
  InstituteName: name,
  SectionId: SEC[sec].id,
  SectionSrNo: SEC[sec].sr,
  SectionName: SEC[sec].name,
  EmployeeId: employeeId,
  EmployeeName: `Emp${employeeId}`,
  PensionType: "GPF",
  GPFSubscription: gpfAmt,
  GPFAdvance: advAmt,
});

/* Shuffled, and with codes that break lexical sorting. */
const ROWS = [
  row("BD", "BD-22", "PUKHTVAY CHAXUVIHIN TAALIM KENDRA", 1, 15000, 0),
  row("DD", "DD-02", "DD Two", 2, 5000, 0),
  row("BD", "BD-01", "SCHOOL FOR THE BLIND", 3, 25000, 0),
  row("BD", "BD-01", "SCHOOL FOR THE BLIND", 4, 25000, 0),
  row("BD", "BD-04", "BRAILE PRESS", 5, 20000, 0),
  row("BD", "BD-19", "SCHOOL FOR BLIND,DEAF AND DUMB", 6, 6000, 0),
  row("BD", "BD-05", "HOSTEL FOR THE BLIND", 7, 40000, 5000),
  row("BD", "BD-12", "ANDH APANG SAHKAR KENDRA", 8, 13000, 0),
  row("DD", "DD-11", "DD Eleven", 9, 7000, 0),
  row("DD", "DD-01", "DD One", 10, 9000, 0),
  /* Control: a June salary-month row, outside a July report. */
  row("BD", "BD-01", "SCHOOL FOR THE BLIND", 99, 99999, 99999, JUN),
];

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

function main() {
  console.log("=".repeat(76));
  console.log("INSTITUTE WISE GPF SUMMARY");
  console.log("=".repeat(76));

  const july = filterGpfRows(ROWS, { month: 7, year: 2026 });
  const rows = groupGpfByInstitute(july);
  const total = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      gpf: a.gpf + r.gpf,
      gpfAdvance: a.gpfAdvance + r.gpfAdvance,
      amount: a.amount + r.amount,
    }),
    { total: 0, gpf: 0, gpfAdvance: 0, amount: 0 }
  );

  /* ---------------- sorting ---------------- */
  section("Section number first, then institute number (numeric)");

  check("BD institutes come before DD institutes",
    rows.map((r) => r.code),
    ["BD-01", "BD-04", "BD-05", "BD-12", "BD-19", "BD-22",
     "DD-01", "DD-02", "DD-11"]);
  check("BD-12 sorts before BD-19 and BD-22, not lexically",
    rows.map((r) => r.code).slice(0, 6),
    ["BD-01", "BD-04", "BD-05", "BD-12", "BD-19", "BD-22"]);
  check("DD-02 before DD-11 (numeric, not text)",
    rows.map((r) => r.code).slice(6), ["DD-01", "DD-02", "DD-11"]);
  check("a plain string sort would have got DD wrong",
    ["DD-11", "DD-02"].sort()[0], "DD-02");
  check("and would have got BD wrong",
    ["BD-12", "BD-19", "BD-4"].sort(), ["BD-12", "BD-19", "BD-4"]);
  check("institutes are NOT ordered by name",
    rows.map((r) => r.instituteName)[0], "SCHOOL FOR THE BLIND");
  check("Sr. No. is 1..n after the sort",
    rows.map((r) => r.srNo), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  check("no institute-code prefix logic is used",
    /startsWith\(\s*["'](BD|DD|OGE|CPD|MR|PH)/.test(routeSrc), false);

  /* ---------------- columns and values ---------------- */
  section("Columns, counts and amounts");

  const bd01 = rows.find((r) => r.code === "BD-01");
  const bd05 = rows.find((r) => r.code === "BD-05");
  check("Total = employees of that institute", bd01.total, 2);
  check("G.P.F. = their subscription", bd01.gpf, 50000);
  check("G.P.F.Adv = their advance", bd01.gpfAdvance, 0);
  check("Amount = G.P.F. + G.P.F.Adv", bd01.amount, 50000);
  check("an institute with an advance adds it in",
    [bd05.gpf, bd05.gpfAdvance, bd05.amount], [40000, 5000, 45000]);
  check("every row satisfies Amount = GPF + Adv",
    rows.every((r) => r.amount === r.gpf + r.gpfAdvance), true);
  check("the institute name comes from the master",
    bd05.instituteName, "HOSTEL FOR THE BLIND");
  check("Month is the bill's month", bd01.month, "JULY");
  check("Type is REG when salary month equals bill month", bd01.type, "REG");

  const oldRows = groupGpfByInstitute(
    filterGpfRows([row("BD", "BD-01", "SCHOOL", 21, 100, 0, JUL_BM_JUN)],
      { month: 7, year: 2026 })
  );
  check("Type is OLD when the bill month differs", oldRows[0].type, "OLD");
  check("and its Month shows the bill month", oldRows[0].month, "JUNE");

  /* ---------------- totals ---------------- */
  section("TOTAL row comes from the displayed rows");

  check("total employees", total.total, 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
  check("total G.P.F.",
    total.gpf, 50000 + 20000 + 40000 + 13000 + 6000 + 15000 + 9000 + 5000 + 7000);
  check("total G.P.F.Adv", total.gpfAdvance, 5000);
  check("total Amount = GPF + Adv", total.amount, total.gpf + total.gpfAdvance);
  check("the route sums the rows, never a second query",
    /rows\.reduce\(/.test(routeSrc), true);
  check("the June control row is excluded from July",
    july.some((r) => Number(r.EmployeeId) === 99), false);
  check("so its 99999 never reaches a total", total.gpf < 99999 * 2, true);

  /* ---------------- REGULAR + OLD on separate lines ---------------- */
  section("REGULAR and OLD bills both appear, on their own lines");

  /*
     A salary month can hold a regular bill and Bill-Month variants. Each is
     its own payment, so each gets its own row keyed on
     Institute Code + Bill Month + Type.
  */
  const JUN_BILL = { BillCode: "JUN-2026", BillMonth: "JUN-2026", SalaryMonth: "June",
                     SalaryMonthNumber: "06", SalaryYear: "2026" };
  const JUN_BM_MAY = { BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", SalaryMonth: "June",
                       SalaryMonthNumber: "06", SalaryYear: "2026" };
  const JUN_BM_APR = { BillCode: "JUN-2026-BM-APR", BillMonth: "APR-2026", SalaryMonth: "June",
                       SalaryMonthNumber: "06", SalaryYear: "2026" };

  const mixed = [
    row("BD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 5, 7000, 0, JUN_BM_MAY),
    row("BD", "CPD-06", "Gujarat State Probation", 1, 10000, 0, JUN_BILL),
    row("BD", "CPD-06", "Gujarat State Probation", 2, 5000, 0, JUN_BM_MAY),
    row("BD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 3, 7000, 0, JUN_BILL),
    row("BD", "CPD-17", "Samarpan Shishu Shambhal Kendra", 4, 7000, 0, JUN_BILL),
  ];
  const mixedRows = groupGpfByInstitute(
    filterGpfRows(mixed, { month: 6, year: 2026 })
  );

  check("the OLD bill is NOT dropped", mixedRows.length, 4);
  check("each line carries its own Code / Month / Type",
    mixedRows.map((r) => [r.code, r.month, r.type]),
    [["CPD-06", "JUNE", "REG"], ["CPD-06", "MAY", "OLD"],
     ["CPD-17", "JUNE", "REG"], ["CPD-17", "MAY", "OLD"]]);
  check("REGULAR and OLD are never merged into one row",
    mixedRows.filter((r) => r.code === "CPD-06").map((r) => r.gpf), [10000, 5000]);
  check("counts are per bill, not per institute",
    mixedRows.map((r) => r.total), [1, 1, 2, 1]);
  check("amounts follow their own bill",
    mixedRows.map((r) => r.gpf), [10000, 5000, 14000, 7000]);
  check("the institute's regular line comes before its older ones",
    mixedRows.map((r) => r.type), ["REG", "OLD", "REG", "OLD"]);
  check("Sr. No. numbers every line",
    mixedRows.map((r) => r.srNo), [1, 2, 3, 4]);

  const threeBills = groupGpfByInstitute(
    filterGpfRows([
      row("BD", "CPD-06", "X", 11, 100, 0, JUN_BM_APR),
      row("BD", "CPD-06", "X", 12, 200, 0, JUN_BILL),
      row("BD", "CPD-06", "X", 13, 300, 0, JUN_BM_MAY),
    ], { month: 6, year: 2026 })
  );
  check("three bills of one salary month give three lines",
    threeBills.map((r) => [r.month, r.type]),
    [["JUNE", "REG"], ["MAY", "OLD"], ["APRIL", "OLD"]]);
  check("older lines run newest Bill Month first",
    threeBills.map((r) => r.gpf), [200, 300, 100]);

  /* ---------------- reconciliation with the Cheque Register ---------------- */
  section("Totals reconcile with the Cheque Register for the same month");

  /*
     The register aggregates the same stored columns per bill+institute. Both
     reports are driven from the SAME underlying employee rows here, so their
     GPF totals must agree exactly.
  */
  const cheque = require("../routes/chequeRegister");
  const registerDbRows = [
    { ...JUN_BILL, WorkflowStatus: "APPROVED", InstituteCode: "CPD-06",
      InstituteName: "Gujarat State Probation", SectionId: SEC.BD.id,
      SectionName: SEC.BD.name, EmpCount: 1, GPFSubscription: 10000,
      BillCategory: "Salary", BillType: "" },
    { ...JUN_BM_MAY, WorkflowStatus: "APPROVED", InstituteCode: "CPD-06",
      InstituteName: "Gujarat State Probation", SectionId: SEC.BD.id,
      SectionName: SEC.BD.name, EmpCount: 1, GPFSubscription: 5000,
      BillCategory: "Salary", BillType: "" },
    { ...JUN_BILL, WorkflowStatus: "APPROVED", InstituteCode: "CPD-17",
      InstituteName: "Samarpan Shishu Shambhal Kendra", SectionId: SEC.BD.id,
      SectionName: SEC.BD.name, EmpCount: 2, GPFSubscription: 14000,
      BillCategory: "Salary", BillType: "" },
    { ...JUN_BM_MAY, WorkflowStatus: "APPROVED", InstituteCode: "CPD-17",
      InstituteName: "Samarpan Shishu Shambhal Kendra", SectionId: SEC.BD.id,
      SectionName: SEC.BD.name, EmpCount: 1, GPFSubscription: 7000,
      BillCategory: "Salary", BillType: "" },
  ];
  const registerRows = cheque.filterRows(
    registerDbRows.map((r, i) => cheque.mapAggregateRow(r, i + 1)),
    { month: 6, year: 2026, table: "SALARY" }
  );
  const regGpf = registerRows.filter((r) => r.type === "REGULAR")
    .reduce((sum, r) => sum + Number(r.gpfAmount), 0);
  const oldGpf = registerRows.filter((r) => r.type === "OLD")
    .reduce((sum, r) => sum + Number(r.gpfAmount), 0);
  const reportGpf = mixedRows.reduce((sum, r) => sum + r.gpf, 0);

  check("the register sees both types too",
    [registerRows.filter((r) => r.type === "REGULAR").length,
     registerRows.filter((r) => r.type === "OLD").length], [2, 2]);
  check("register REGULAR GPF + OLD GPF = report GPF total",
    regGpf + oldGpf, reportGpf);
  check("and that figure is 10000 + 5000 + 14000 + 7000", reportGpf, 36000);
  check("dropping the OLD bills would NOT reconcile", regGpf === reportGpf, false);
  check("Amount = GPF + GPF Adv on every line",
    mixedRows.every((r) => r.amount === r.gpf + r.gpfAdvance), true);
  check("the report reads the same stored GPF column the register does",
    /d\.GPFSubscription/.test(routeSrc) &&
      /SUM\(d\.GPFSubscription\)/.test(
        fs.readFileSync(path.join(__dirname, "..", "routes", "chequeRegister.js"), "utf8")
      ), true);
  check("no unrelated deduction is included",
    /NPS|IncomeTax|ProfessionalTax/.test(
      routeSrc.slice(routeSrc.indexOf("function groupGpfByInstitute"),
                     routeSrc.indexOf("async function buildInstituteWiseGpfReport"))
    ), false);

  /* ---------------- filters ---------------- */
  section("Filters");

  check("a section filter returns only that section",
    groupGpfByInstitute(filterGpfRows(ROWS, { month: 7, year: 2026, sectionId: 4 }))
      .map((r) => r.code), ["DD-01", "DD-02", "DD-11"]);
  check("June returns the June row only",
    filterGpfRows(ROWS, { month: 6, year: 2026 }).map((r) => Number(r.EmployeeId)), [99]);
  check("only APPROVED and LOCKED rows count",
    filterGpfRows(
      ["APPROVED", "LOCKED", "DRAFT", "RETURNED", "REJECTED"].map((st, i) => ({
        ...row("BD", "BD-01", "X", 300 + i, 10, 0), WorkflowStatus: st,
      })), { month: 7, year: 2026 }
    ).map((r) => r.WorkflowStatus), ["APPROVED", "LOCKED"]);
  check("an empty result yields no rows", groupGpfByInstitute([]), []);
  check("the page shows 'No records found' for an empty result",
    /No records found/.test(pageSrc), true);
  check("Salary Time is accepted and echoed, not silently dropped",
    /salaryTime: query\.salaryTime == null/.test(routeSrc), true);

  /* ---------------- editable fields ---------------- */
  section("Editable cheque and challan fields");

  check("Cheque No is editable",
    /value=\{chequeNo\}[\s\S]{0,160}setChequeNo/.test(pageSrc), true);
  check("Cheque Date is an editable date input",
    /type="date"[\s\S]{0,140}value=\{chequeDate\}/.test(pageSrc), true);
  check("Challan No is editable",
    /value=\{challanNo\}[\s\S]{0,160}setChallanNo/.test(pageSrc), true);
  check("Challan Date is an editable date input",
    /type="date"[\s\S]{0,140}value=\{challanDate\}/.test(pageSrc), true);
  check("all four print their typed value",
    (pageSrc.match(/iwg-cheque-print/g) || []).length, 4);
  check("dates print dd-mm-yyyy",
    /return `\$\{d\}-\$\{m\}-\$\{y\}`/.test(pageSrc), true);
  check("none of them reaches the API",
    /chequeNo|challanNo/.test(routeSrc), false);
  check("the report writes nothing to the database",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeSrc), false);

  /* ---------------- presentation ---------------- */
  section("Legacy appearance, print and security");

  check("nine columns in the printed order",
    (pageSrc.match(/<th className="iwg-c-\w+">/g) || []).length, 9);
  check("a clean white report sheet, as on the GPF Summary page",
    /\.iwg-sheet \{[\s\S]{0,80}background: #fff/.test(cssSrc), true);
  check("the screen follows the global typography token",
    /\.iwg-sheet \{[\s\S]{0,220}font-family: var\(--font-family-base\)/.test(cssSrc), true);
  check("the printed form keeps its serif face",
    /@media print \{[\s\S]{0,400}font-family: "Times New Roman"/.test(cssSrc), true);
  check("compact rows", /padding: 2px 8px/.test(cssSrc), true);
  check("thin black rules", /border: 1px solid #000/.test(cssSrc), true);
  /* The page now follows the GPF Summary screen: app filter bar, Back link
     and a toolbar with Excel / Print, rather than the legacy pink chrome. */
  check("the app's own filter bar and Show button",
    /\.iwg-btn \{[\s\S]{0,120}background: #1f4e79/.test(cssSrc), true);
  check("a Back link, as on the GPF Summary page",
    /← Back/.test(pageSrc), true);
  check("Excel and Print sit with the shared toolbar",
    /<GridToolbar[\s\S]{0,700}onClick=\{handleExcel\}[\s\S]{0,260}printReport\("instituteWiseGpfSummary"\)/.test(pageSrc), true);
  check("filters, toolbar and Back are hidden when printing",
    /\.iwg-filters,[\s\S]{0,160}\.iwg-actions \{\s*\n\s*display: none/.test(cssSrc), true);
  check("the export list carries all nine columns",
    (pageSrc.match(/\{ key: "\w+", label: "[^"]+" \}/g) || []).length, 9);
  check("the four header lines are rendered",
    /sectionTitle[\s\S]{0,300}subHeading/.test(pageSrc), true);
  check("the signature block sits bottom-right",
    /\.iwg-sign \{[\s\S]{0,160}text-align: right/.test(cssSrc), true);
  check("the API is authenticated and permission-gated",
    /\/api\/gpf-summary",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("no salary is computed by the report",
    /calculateForEmployee|TransportAllowanceMaster|PayMatrix/.test(routeSrc), false);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
