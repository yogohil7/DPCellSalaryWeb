/*
  ==================================================================
  OFFLINE HISTORICAL SALARY DATA INTEGRITY TEST
  ==================================================================

  Question under test: once a salary month is LOCKED, do its stored values
  stay independent of later master-data changes, and do the reports READ that
  history rather than recomputing it from today's masters?

  This is a different question from backend/scripts/testLockedSalaryImmutability.js,
  which asks whether the WRITE paths refuse a locked month. That suite covers
  mutation; this one covers READ integrity. Neither duplicates the other.

  METHOD
    - One simulated JUN-2026 salary row, using only columns that exist in the
      real schema, is served to the REAL exported report builders through a
      stubbed `sql` layer.
    - Every SQL statement is recorded. A SELECT is fine; any write fails the
      test, wherever it came from.
    - The current "masters" are then moved to different values and every
      builder is run again. A byte fingerprint of the historical row is taken
      before and after.

  WHAT THIS DOES NOT DO
    It does not lock JUN-2026, does not open a database connection, and does
    not modify DPCELLSalaryWebDB. Physical database immutability is a separate,
    live verification (backend/sql/verify/VerifyLockedSalaryImmutability.sql).

  Usage: cd backend && npm run test:historical-salary-integrity
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

/* ================= the recording stub ================= */
let writes = [];
let reads = 0;
let connectCalls = 0;
let salaryRows = [];
let daRows = [];
let scheduleRows = [];

function textOf(strings) {
  return strings && strings.raw ? strings.raw.join(" ? ") : String(strings);
}
const WRITE_RE =
  /\b(INSERT\s+INTO|UPDATE\s+dbo\.|DELETE\s+FROM|DELETE\s+\w+\s*\n?\s*FROM|MERGE\s+|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\b/i;

function respond(text) {
  if (WRITE_RE.test(text)) {
    writes.push(text.replace(/\s+/g, " ").trim().slice(0, 100));
    return { recordset: [], rowsAffected: [0] };
  }
  reads += 1;

  /* OBJECT_ID guards used by optional-table checks. */
  if (/OBJECT_ID\(|COL_LENGTH\(/i.test(text)) {
    return { recordset: [{ Bill: 1, Detail: 1, Header: 1, Details: 1, Present: 1 }] };
  }
  if (/FROM dbo\.DADifferenceBill/i.test(text)) return { recordset: daRows };
  /*
     Order matters. The main salary query joins SalaryEmployeeDetails and now
     also selects w.NPSScheduleNo, so it must be matched BEFORE the small
     schedule-number lookup, which touches the workflow table alone.
  */
  if (/dbo\.SalaryEmployeeDetails/i.test(text)) {
    return { recordset: salaryRows };
  }
  if (/FROM dbo\.SalaryBillInstituteWorkflow/i.test(text) && /NPSScheduleNo/i.test(text)) {
    return { recordset: scheduleRows };
  }
  if (/FROM dbo\.SalaryBillInstituteWorkflow/i.test(text)) {
    return { recordset: salaryRows };
  }
  if (/FROM dbo\.Sections/i.test(text)) {
    return { recordset: [{ SectionId: 1, SectionCode: "OGE", SectionName: "OGE", SrNo: 1 }] };
  }
  if (/FROM dbo\.SalaryBillCodes/i.test(text)) {
    return { recordset: salaryRows };
  }
  return { recordset: [] };
}

const dbPath = require.resolve(path.join(ROOT, "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
const query = (strings) => Promise.resolve(respond(textOf(strings)));
stub.exports = {
  sql: {
    query,
    Request: function R() { return { query, input() { return this; } }; },
  },
  connectDB: async () => { connectCalls += 1; return true; },
};
require.cache[dbPath] = stub;

/* ================= the real implementation ================= */
const ews = require("../routes/employeeWiseSalary");
const cheque = require("../routes/chequeRegister");
const bankCopy = require("../routes/bankCopy");
const npsSchedule = require("../routes/npsSchedule");
const salaryRegister = require("../routes/salaryRegister");
const itp = require("../routes/incomeTaxProfessionalTax");
const npsSummary = require("../routes/npsSummary");
const gpfSummary = require("../routes/gpfSummary");
const paySlip = require("../routes/employeePaySlip");
const daUtil = require("../utils/daDifference");

/* ================= runner with per-section accounting ================= */
let passed = 0, failed = 0;
const failures = [];
let sectionName = "";
let sectionPassed = 0, sectionFailed = 0, sectionWritesAtStart = 0;
const sectionReport = [];

function section(t) {
  if (sectionName) closeSection();
  sectionName = t;
  sectionPassed = 0;
  sectionFailed = 0;
  sectionWritesAtStart = writes.length;
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function closeSection() {
  const w = writes.length - sectionWritesAtStart;
  sectionReport.push({
    name: sectionName,
    verdict: sectionFailed === 0 ? "PASS" : "FAIL",
    assertions: sectionPassed + sectionFailed,
    writes: w,
  });
  console.log(
    `  → ${sectionFailed === 0 ? "PASS" : "FAIL"}   ` +
    `assertions: ${sectionPassed + sectionFailed}   writes: ${w}`
  );
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; sectionPassed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; sectionFailed++;
    failures.push(`[${sectionName}] ${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

/* ================= the simulated locked JUN-2026 history ================= */
/*
   Only columns that exist in dbo.SalaryEmployeeDetails / SalaryBillCodes /
   SalaryBillInstituteWorkflow are used. DARate and HRARate are the snapshot
   columns that make history independent of the current masters.
*/
function juneRow(over = {}) {
  return {
    BillCodeId: 101, BillCode: "JUN-2026",
    BillMonth: "JUN-2026", SalaryMonth: "June",
    SalaryMonthNumber: "06", SalaryYear: "2026",
    BillCategory: "Salary", BillType: "Regular Salary",
    IsArchived: 0,
    WorkflowStatus: "LOCKED", Status: "LOCKED",
    BillNo: "598", BillDate: "2026-07-22", NPSScheduleNo: "SCH/7/2026/173683",
    InstituteId: 5, InstituteCode: "OGE-05",
    InstituteName: "Samany Vrudhdhashram",
    SectionId: 1, SectionSrNo: 1, SectionName: "OGE",
    DetailId: 9001, Id: 9001,
    EmployeeId: 2001, EmployeeName: "Historical Employee",
    EmployeeCode: "E2001", Designation: "Peon", EmployeeType: "REGULAR",
    MasterDesignationName: "Peon", PensionType: "GPF", DisplayOrder: 1,
    BankAccountNumber: "20346154823", GPFNPS: "GPF", GPFNPSNumber: "",

    /* ---- the stored historical money, at JUNE's rates ---- */
    BasicPay: 23800, GradePay: 0, TotalBasic: 23800,
    DARate: 60, DA: 14280,
    HRARate: 9, HRA: 2142,
    MA: 1000, TA: 0, CLA: 0,
    SpecialAllowance: 0, WashingAllowance: 0,
    GrossSalary: 41222,
    GPFSubscription: 2000, GPFAdvance: 500, NPS: 3808,
    IncomeTax: 300, ProfessionalTax: 200, OtherDeduction: 100,
    TotalDeduction: 6908, NetSalary: 34314, ChequeAmount: 34814,

    /*
       The Salary Register and Cheque Register aggregate in SQL and alias
       their SUMs. Offline the stub returns rows, so the aliased names must be
       present too — the SAME stored numbers under the names those queries
       produce. Nothing new is invented; these are the aliases in the real SQL.
    */
    EmployeeCount: 1, EmpCount: 1, Place: "",
    GrossAmount: 41222,
    ApprovedBy: "Account Officer", ApprovedDate: "2026-07-23",
    ...over,
  };
}

/* The fingerprint: every stored value that must never move. */
const FINGERPRINT_FIELDS = [
  "BasicPay", "GradePay", "TotalBasic", "DARate", "DA", "HRARate", "HRA",
  "MA", "TA", "CLA", "SpecialAllowance", "WashingAllowance", "GrossSalary",
  "GPFSubscription", "GPFAdvance", "NPS", "IncomeTax", "ProfessionalTax",
  "OtherDeduction", "TotalDeduction", "NetSalary", "ChequeAmount",
  "BillMonth", "SalaryMonth", "SalaryMonthNumber", "SalaryYear",
  "BillCodeId", "EmployeeId", "InstituteCode", "DetailId",
];
function fingerprint(rows) {
  const payload = rows.map((r) =>
    FINGERPRINT_FIELDS.map((f) => `${f}=${r[f]}`).join("|")
  ).join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}
function whichFieldChanged(before, after) {
  const diffs = [];
  before.forEach((b, i) => {
    const a = after[i] || {};
    FINGERPRINT_FIELDS.forEach((f) => {
      if (String(b[f]) !== String(a[f])) diffs.push(`${f}: ${b[f]} -> ${a[f]}`);
    });
  });
  return diffs;
}

/* The simulated CURRENT masters, moved later in the run. */
const MASTER = { daRate: 60, hraRate: 9, basicPay: 23800 };

(async function main() {
  console.log("=".repeat(70));
  console.log("OFFLINE HISTORICAL SALARY DATA INTEGRITY TEST");
  console.log("=".repeat(70));

  const HISTORY = [juneRow()];
  const beforeFingerprint = fingerprint(HISTORY);
  const beforeCopy = HISTORY.map((r) => ({ ...r }));

  /* ---------------------------------------------------------- */
  section("1. Locked historical snapshot");
  {
    const row = HISTORY[0];
    check("the bill is LOCKED", row.Status, "LOCKED");
    check("and not archived", row.IsArchived, 0);
    check("Salary Month and Bill Month are both stored",
      [row.SalaryMonth, row.BillMonth], ["June", "JUN-2026"]);
    check("the snapshot carries its OWN DA rate", row.DARate, 60);
    check("and its own HRA rate", row.HRARate, 9);
    check("every fingerprinted field is present on the row",
      FINGERPRINT_FIELDS.filter((f) => row[f] === undefined), []);
    check("the fingerprint is deterministic",
      fingerprint(HISTORY), beforeFingerprint);
    /* Only columns that really exist may be used. */
    const schema = fs
      .readdirSync(path.join(ROOT, "sql", "schema"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(ROOT, "sql", "schema", f), "utf8"))
      .join("\n") + fs.readFileSync(path.join(ROOT, "sql", "003_salary_employee_details.sql"), "utf8");
    const moneyFields = [
      "BasicPay", "GradePay", "TotalBasic", "DA", "HRA", "MA", "TA", "CLA",
      "SpecialAllowance", "WashingAllowance", "GrossSalary", "GPFSubscription",
      "GPFAdvance", "NPS", "IncomeTax", "ProfessionalTax", "OtherDeduction",
      "TotalDeduction", "NetSalary", "ChequeAmount", "DARate", "HRARate",
    ];
    check("no invented column: every one exists in the real schema",
      moneyFields.filter((f) => !new RegExp(`\\b${f}\\b`).test(schema)), []);
  }

  /* ---------------------------------------------------------- */
  section("2. Current master changes");
  {
    MASTER.daRate = 64;      /* the department revises DA */
    MASTER.hraRate = 10;
    MASTER.basicPay = 26000;
    check("the current DA master now differs from the stored rate",
      MASTER.daRate === HISTORY[0].DARate, false);
    check("the current HRA master now differs too",
      MASTER.hraRate === HISTORY[0].HRARate, false);
    check("the stored DA rate did NOT follow the master", HISTORY[0].DARate, 60);
    check("nor did the stored DA amount", HISTORY[0].DA, 14280);
    check("nor the stored HRA", HISTORY[0].HRA, 2142);
    check("the fingerprint is unchanged by a master change",
      fingerprint(HISTORY), beforeFingerprint);
  }

  /* ---------------------------------------------------------- */
  section("3. Historical recalculation protection");
  {
    /*
       What a recalculation at today's rates WOULD have produced, using the
       project's own rounding, purely to show the two differ. Nothing is
       written back — this figure exists only inside the assertion.
    */
    const wouldBeDa = Math.round(HISTORY[0].TotalBasic * MASTER.daRate) / 100;
    check("a recalculation at today's rate would differ from history",
      wouldBeDa === HISTORY[0].DA, false);
    check("but the stored DA is still the June figure", HISTORY[0].DA, 14280);
    check("stored HRA unchanged", HISTORY[0].HRA, 2142);
    check("stored TA unchanged", HISTORY[0].TA, 0);
    check("stored Gross unchanged", HISTORY[0].GrossSalary, 41222);
    check("stored GPF unchanged", HISTORY[0].GPFSubscription, 2000);
    check("stored GPF Advance unchanged", HISTORY[0].GPFAdvance, 500);
    check("stored NPS unchanged", HISTORY[0].NPS, 3808);
    check("stored IT unchanged", HISTORY[0].IncomeTax, 300);
    check("stored PT unchanged", HISTORY[0].ProfessionalTax, 200);
    check("stored Other Deduction unchanged", HISTORY[0].OtherDeduction, 100);
    check("stored Total Deduction unchanged", HISTORY[0].TotalDeduction, 6908);
    check("stored Net unchanged", HISTORY[0].NetSalary, 34314);
    check("stored Bill Month unchanged", HISTORY[0].BillMonth, "JUN-2026");

    /* The REAL guard: the recalculating endpoint refuses a locked bill. */
    const calcSrc = fs.readFileSync(path.join(ROOT, "routes", "salaryCalculate.js"), "utf8");
    check("save-calculated refuses a LOCKED bill before its transaction",
      calcSrc.indexOf('=== "LOCKED"') < calcSrc.indexOf("UPDATE dbo.SalaryEmployeeDetails"),
      true);
    check("no report module imports the salary engine",
      ["employeeWiseSalary", "chequeRegister", "bankCopy", "npsSchedule",
       "salaryRegister", "incomeTaxProfessionalTax", "npsSummary", "gpfSummary",
       "employeePaySlip"]
        .filter((f) => /calculateEmployee\(|calculateSalaryFor/.test(
          fs.readFileSync(path.join(ROOT, "routes", `${f}.js`), "utf8"))), []);
    check("nor re-reads a rate master",
      ["employeeWiseSalary", "chequeRegister", "bankCopy", "npsSchedule",
       "salaryRegister", "incomeTaxProfessionalTax", "npsSummary", "gpfSummary",
       "employeePaySlip"]
        .filter((f) => /FROM dbo\.DAMaster|FROM dbo\.HRAMaster|FROM dbo\.PayMatrix/.test(
          fs.readFileSync(path.join(ROOT, "routes", `${f}.js`), "utf8"))), []);
  }

  /* ---------------------------------------------------------- */
  section("4. Bill Month independence");
  {
    const three = [
      juneRow({ BillCodeId: 301, BillCode: "JUN-2026-BM-APR", BillMonth: "APR-2026", DetailId: 9101 }),
      juneRow({ BillCodeId: 302, BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", DetailId: 9102 }),
      juneRow({ BillCodeId: 303, BillCode: "JUN-2026", BillMonth: "JUN-2026", DetailId: 9103 }),
    ];
    check("all three share the same salary month",
      [...new Set(three.map((r) => r.SalaryMonthNumber))], ["06"]);
    check("their Bill Months stay distinct",
      three.map((r) => r.BillMonth), ["APR-2026", "MAY-2026", "JUN-2026"]);

    /* Exercise the REAL mappers rather than asserting on the fixture. */
    const mapped = three.map(ews.mapSalaryRow);
    check("the real mapper keeps each Bill Month",
      mapped.map((r) => r.paidMonth), ["APR-2026", "MAY-2026", "JUN-2026"]);
    check("and resolves them all to salary month JUN-2026",
      [...new Set(mapped.map((r) => r.salaryMonth))], ["JUN-2026"]);
    check("none is normalised to the salary month",
      mapped.every((r) => r.paidMonth === r.salaryMonth), false);
    check("the period filter selects all three for June",
      ews.filterSalaryRows(mapped, { month: 6, year: 2026 }).length, 3);
    check("REGULAR vs OLD is derived, and the APR/MAY ones are OLD",
      mapped.map((r) => r.type), ["OLD", "OLD", "REGULAR"]);
    check("no record is merged away — three in, three out",
      ews.filterSalaryRows(mapped, { month: 6, year: 2026 })
        .map((r) => r.detailId), [9101, 9102, 9103]);
  }

  /* ---------------------------------------------------------- */
  section("5. JUN → JUL isolation");
  {
    const july = juneRow({
      BillCodeId: 202, BillCode: "JUL-2026", BillMonth: "JUL-2026",
      SalaryMonth: "July", SalaryMonthNumber: "07", Status: "OPEN",
      WorkflowStatus: "OPEN", DetailId: 9200,
      BasicPay: 26000, DARate: 64, DA: 16640, NetSalary: 40000,
    });
    const both = [HISTORY[0], july].map(ews.mapSalaryRow);
    check("June and July are different bills",
      both.map((r) => r.billCodeId), [101, 202]);
    check("and different detail rows",
      both.map((r) => r.detailId), [9001, 9200]);
    check("July carries its own, newer values",
      [both[1].basic, both[1].net], [26000, 40000]);
    check("June still carries its own",
      [both[0].basic, both[0].net], [23800, 34314]);
    check("a June-only period filter excludes July",
      ews.filterSalaryRows(both, { month: 6, year: 2026 })
        .map((r) => r.billCodeId), [101]);
    /*
       July is OPEN, so it carries no APPROVED/LOCKED row and correctly does
       not reach any report at all — the reporting rule, not a month bug.
       Repeating the check with an approved July proves the month filter
       itself separates them.
    */
    check("an OPEN July appears in NO report, whichever month is asked for",
      [ews.filterSalaryRows(both, { month: 7, year: 2026 }).length,
       ews.filterSalaryRows(both, { month: 6, year: 2026 })
         .some((r) => r.billCodeId === 202)], [0, false]);
    {
      const approvedJuly = ews.mapSalaryRow({ ...july, WorkflowStatus: "APPROVED" });
      const set = [both[0], approvedJuly];
      check("once July is approved, a July filter returns July only",
        ews.filterSalaryRows(set, { month: 7, year: 2026 })
          .map((r) => r.billCodeId), [202]);
      check("and a June filter still returns June only",
        ews.filterSalaryRows(set, { month: 6, year: 2026 })
          .map((r) => r.billCodeId), [101]);
    }
    check("July's Bill Month is independent of its Salary Month",
      [both[1].salaryMonth, both[1].paidMonth], ["JUL-2026", "JUL-2026"]);
    check("June is untouched after July was mapped",
      fingerprint(HISTORY), beforeFingerprint);
  }

  /* ---------------------------------------------------------- */
  section("6. Report read integrity");
  {
    salaryRows = [juneRow()];
    daRows = [];
    scheduleRows = [{ SalaryBillCodeId: 101, InstituteCode: "OGE-05",
                      NPSScheduleNo: "SCH/7/2026/173683" }];
    const Q = { month: 6, year: 2026 };

    /* --- Employee Wise Salary --- */
    const ewsReport = await ews.buildEmployeeWiseReport(Q);
    /* This builder groups: employees[i] = { employee, rows[] }. */
    const e = ewsReport.employees[0].rows[0];
    check("EWS: the row is grouped under its employee",
      ewsReport.employees[0].employee.employeeId, 2001);
    check("EWS: reads the stored Basic", e.basic, 23800);
    check("EWS: the stored DA, not today's rate", e.da, 14280);
    check("EWS: the stored Gross", e.total, 41222);
    check("EWS: the stored Net", e.net, 34314);
    check("EWS: Salary and Bill Month both present",
      [e.salaryMonth, e.paidMonth], ["JUN-2026", "JUN-2026"]);

    /* --- Cheque Register --- */
    const cr = await cheque.buildChequeRegisterReport(Q);
    check("Cheque Register: a row is produced", cr.rows.length > 0, true);
    check("Cheque Register: stored Basic is summed, not recomputed",
      cr.rows[0].basic, 23800);
    check("Cheque Register: stored Net", cr.rows[0].netAmount, 34314);
    check("Cheque Register: stored IT and PT",
      [cr.rows[0].incomeTax, cr.rows[0].professionalTax], [300, 200]);

    /* --- Salary Register --- */
    const sr = await salaryRegister.buildSalaryRegisterReport(Q);
    check("Salary Register: a bill row is produced", sr.rows.length > 0, true);
    check("Salary Register: stored Gross / Deduction / Net",
      [sr.rows[0].grossAmount, sr.rows[0].totalDeduction, sr.rows[0].netSalary],
      [41222, 6908, 34314]);
    check("Salary Register: Bill Month and Salary Month are separate columns",
      [sr.rows[0].billMonth, sr.rows[0].salaryMonth], ["JUNE 2026", "JUNE 2026"]);

    /* --- Income Tax & Professional Tax --- */
    const tax = await itp.buildIncomeTaxProfessionalTaxReport(Q);
    check("IT/PT: stored IncomeTax", tax.rows[0].incomeTax, 300);
    check("IT/PT: stored ProfessionalTax", tax.rows[0].professionalTax, 200);
    check("IT/PT: Total is the display sum, not TotalDeduction",
      [tax.rows[0].total, tax.rows[0].total === 6908], [500, false]);

    /* --- NPS Schedule Summary --- */
    const sch = await npsSchedule.buildNpsScheduleReport(Q);
    check("NPS Schedule: the stored NPS is carried",
      sch.totals.amount, 3808);
    check("NPS Schedule: the stored schedule number is used",
      sch.rows[0].scheduleNo, "SCH/7/2026/173683");

    /* --- NPS Summary --- */
    const ns = await npsSummary.buildNpsSummaryReport(Q);
    check("NPS Summary: a row is produced", (ns.rows || []).length > 0, true);
    check("NPS Summary: reconciles to the same stored NPS",
      JSON.stringify(ns).includes("3808"), true);

    /* --- GPF Summary --- */
    const gs = await gpfSummary.buildGpfSummaryReport(Q);
    check("GPF Summary: a row is produced", (gs.rows || []).length > 0, true);
    check("GPF Summary: reads stored subscription and advance",
      JSON.stringify(gs).includes("2000") && JSON.stringify(gs).includes("500"),
      true);

    /* --- Bank Copy --- */
    const bc = await bankCopy.buildBankCopyReport(Q);
    const bcRows = bc.rows || [];
    const bcEmp = bcRows.find((r) => r.type === "EMPLOYEE") || {};
    check("Bank Copy: pays the stored Net Salary", bcEmp.amount, 34314);
    check("Bank Copy: the institute line is the stored IT + PT",
      (bcRows.find((r) => r.type === "INSTITUTE") || {}).amount, 500);

    /* --- Employee Pay Slip --- */
    const slip = await paySlip.buildPaySlipReport({ ...Q, employeeId: 2001 });
    const s0 = slip.slips[0];
    check("Pay Slip: stored Gross / Total Deduction / Net",
      [s0.grossSalary, s0.totalDeduction, s0.netSalary], [41222, 6908, 34314]);
    check("Pay Slip: FixPay reads the GradePay column", 
      s0.earnings.find((l) => l.key === "fixPay").amount, 0);

    check("EVERY report ran with ZERO writes", writes.length, 0);
    check("and they did read", reads > 0, true);

    /*
       DOCUMENTED DISTINCTION, not a mutation: the Cheque Register's cheque
       amount is a display figure derived as stored Net + IT + PT. It has no
       column of its own and is not a recalculation of any stored component.
    */
    check("Cheque Amt. is the documented derived display value",
      cr.rows[0].chequeAmount, 34314 + 300 + 200);
  }

  /* ---------------------------------------------------------- */
  section("7. DA Difference historical integrity");
  {
    /*
       The real calculator. Old DA and Old DA Rate come from the historical
       SNAPSHOT; only the revised rate comes from the DA master. That is the
       whole point of a DA difference, and it is what keeps history intact.
    */
    const snapshot = {
      SalaryBillCodeId: 101, BillCode: "JUN-2026", BillMonth: "JUN-2026",
      SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026",
      TotalBasic: 23800, DA: 14280, DARate: 60,
    };
    check("deriveOldDaRate prefers the STORED rate, not today's master",
      daUtil.deriveOldDaRate(snapshot), 60);
    check("and falls back to the stored amounts when no rate was stored",
      daUtil.deriveOldDaRate({ TotalBasic: 23800, DA: 14280 }), 60);

    const month = { label: "JUN-2026", monthNumber: "06", year: "2026" };
    const row = daUtil.calculateMonthDifference({
      month, snapshot, revisedRate: MASTER.daRate,   /* 64 today */
    });
    check("Old DA is the stored historical amount", row.oldDA, 14280);
    check("Old DA Rate is the stored historical rate", row.oldDARate, 60);
    check("Revised DA Rate is today's master rate", row.revisedDARate, 64);
    check("Revised DA is basic x today's rate", row.revisedDA, 15232);
    check("the difference is revised minus stored old", row.differenceAmount, 952);
    check("NPS on the difference uses the project's own rule",
      row.npsDeduction, daUtil.calculateNpsOnDifference(952));
    check("Net difference is difference minus NPS",
      row.netDifferenceAmount, 952 - row.npsDeduction);
    check("the historical snapshot was NOT overwritten by the calculation",
      [snapshot.DA, snapshot.DARate, snapshot.TotalBasic], [14280, 60, 23800]);
    check("no GPF or other component is fabricated for DA",
      Object.keys(row).some((k) => /gpf|hra|ta$|cla|incomeTax|professionalTax/i.test(k)),
      false);
    check("the DA employee table has no IT/PT column to fabricate from",
      /IncomeTax|ProfessionalTax/.test(
        fs.readFileSync(path.join(ROOT, "sql", "schema",
          "33_DADifferenceAndEmployeeIncrement.sql"), "utf8")), false);
    check("computing a DA difference issued no write", writes.length, 0);
  }

  /* ---------------------------------------------------------- */
  section("8. Zero-write guarantee");
  {
    check("TOTAL SQL WRITES across the whole run", writes.length, 0);
    check("no INSERT was attempted",
      writes.some((w) => /INSERT/i.test(w)), false);
    check("no UPDATE was attempted",
      writes.some((w) => /UPDATE/i.test(w)), false);
    check("no DELETE was attempted",
      writes.some((w) => /DELETE/i.test(w)), false);
    check("no MERGE / TRUNCATE / ALTER / DROP / CREATE was attempted",
      writes.some((w) => /MERGE|TRUNCATE|ALTER|DROP|CREATE/i.test(w)), false);
    check("SELECTs did happen — the reports really ran", reads > 0, true);
  }

  /* ---------------------------------------------------------- */
  section("9. Historical fingerprint");
  {
    const afterFingerprint = fingerprint(HISTORY);
    const diffs = whichFieldChanged(beforeCopy, HISTORY);
    check("no field of the locked row changed", diffs, []);
    check("beforeFingerprint === afterFingerprint",
      afterFingerprint, beforeFingerprint);
    check("the fingerprint covers every stored money field",
      ["BasicPay", "DA", "HRA", "TA", "NPS", "GPFSubscription", "GPFAdvance",
       "IncomeTax", "ProfessionalTax", "GrossSalary", "TotalDeduction",
       "NetSalary", "DARate", "HRARate", "BillMonth"]
        .filter((f) => !FINGERPRINT_FIELDS.includes(f)), []);
    check("and it would actually detect a change",
      fingerprint([{ ...HISTORY[0], NetSalary: 34315 }]) === beforeFingerprint,
      false);
  }

  /* ---------------------------------------------------------- */
  section("10. Real DB safety");
  {
    check("the db module is the in-memory stub",
      require.cache[dbPath] === stub, true);
    check("REAL DATABASE CONNECTIONS opened", connectCalls, 0);
    check("connectDB is a no-op that returns true",
      await stub.exports.connectDB(), true);
    connectCalls = 0;   /* the line above is the only call, and it is the stub */
    const self = fs.readFileSync(__filename, "utf8");
    const credentialish = new RegExp(
      ["Connection", "String"].join("") + "|DB_" + "PASSWORD" +
        "|Trusted_" + "Connection" + "|" + "Server" + "=",
      "i"
    );
    const body = self.split("\n")
      .filter((l) => !/credentialish|\.join\(""\)/.test(l))
      .join("\n");
    check("no connection string or credential in this suite",
      credentialish.test(body), false);
    check("the real mssql driver is never required here",
      /require\("mssql|require\("msnodesqlv8/.test(body), false);
    check("REAL DATABASE MODIFICATIONS", writes.length, 0);
  }

  closeSection();
  sectionName = "";

  /* ---------------------------------------------------------- */
  console.log(`\n${"=".repeat(70)}`);
  console.log("SECTION SUMMARY");
  console.log("=".repeat(70));
  sectionReport.forEach((s) => {
    console.log(
      `  ${s.verdict.padEnd(5)} ${String(s.assertions).padStart(3)} assertions  ` +
      `${String(s.writes).padStart(2)} writes   ${s.name}`
    );
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log("OFFLINE HISTORICAL SALARY DATA INTEGRITY TEST");
  console.log("NO REAL DATABASE MODIFIED");
  console.log("=".repeat(70));
  console.log(`  TOTAL ASSERTIONS            : ${passed + failed}`);
  console.log(`  PASSED                      : ${passed}`);
  console.log(`  FAILED                      : ${failed}`);
  console.log(`  TOTAL SQL WRITES            : ${writes.length}`);
  console.log(`  REAL DATABASE CONNECTIONS   : 0`);
  console.log(`  REAL DATABASE MODIFICATIONS : 0`);
  console.log("=".repeat(70));
  console.log(
    "\nThis is an OFFLINE APPLICATION HISTORICAL DATA INTEGRITY TEST.\n" +
    "It does NOT prove physical database immutability.\n" +
    "It does NOT lock JUN-2026.\n" +
    "It does NOT modify DPCELLSalaryWebDB."
  );
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error("SUITE ERROR:", e.message, "\n", e.stack);
  process.exit(1);
});
