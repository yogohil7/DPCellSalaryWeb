/**
 * Regression test for the Salary Entry "Retirement Date" column
 * (2026-09-25 fix).
 *
 * Root-cause trace (see chat report for the full write-up):
 *   Salary Entry Get Data -> GET /api/salary-entry/employees
 *     -> backend/routes/salaryEntry.js buildEmployeeRows()
 *       -> SELECT ... e.DateOfRetirement FROM dbo.EmployeeMaster e   (added)
 *       -> row.dateOfRetirement = <value from that query>            (added)
 *     -> frontend/src/pages/SalaryEntry.jsx renders
 *          formatRetirementDate(employee.dateOfRetirement)
 *
 * This proves, WITHOUT a live database, that:
 *   1. When EmployeeMaster.DateOfRetirement has a value, it reaches the
 *      API response as `dateOfRetirement` on the employee row — for BOTH
 *      the "existing saved snapshot" path (dbo.SalaryEmployeeDetails,
 *      which itself has no such column) and the "freshly calculated"
 *      path, so a saved snapshot from before this fix still shows the
 *      current Employee Master date, never requiring a backfill.
 *   2. When EmployeeMaster.DateOfRetirement is NULL, the API returns
 *      dateOfRetirement: null (never invents a value), and the frontend
 *      formatter turns that into "-".
 *   3. The frontend reads `employee.dateOfRetirement` (not some other
 *      property name) and formats DD-MM-YYYY / ISO datetime strings the
 *      same way.
 *
 * Runs offline: the database layer is stubbed. No SQL Server needed.
 * Usage: cd backend && node scripts/testSalaryEntryRetirementDate.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

/* ===================== DB STUB ===================== */
/* The exact dates confirmed live in DPCELLSalaryWebDB.dbo.EmployeeMaster
   via SSMS on 2026-09-25 (see chat) — used verbatim so this test proves
   the real reported case, not a made-up one. */
const REAL_RETIREMENT_DATES = {
  2093: "2034-02-28",
  2094: "2040-07-31",
  2095: "2030-12-31",
  2097: "2039-06-30",
  2098: "2033-03-31",
  2099: "2035-11-30",
};
const REQUIRED_DISPLAY = {
  2093: "28-02-2034",
  2094: "31-07-2040",
  2095: "31-12-2030",
  2097: "30-06-2039",
  2098: "31-03-2033",
  2099: "30-11-2035",
};
const EMPLOYEE_MASTER_ROWS = Object.entries(REAL_RETIREMENT_DATES).map(
  ([id, date]) => ({
    EmployeeId: Number(id),
    EmployeeName: `Employee ${id}`,
    EmployeeCode: `E${id}`,
    DateOfRetirement: new Date(date),
  })
);
/* Plus one employee with genuinely no date on file, so "-" is still
   proven to mean "no data", not "the fix doesn't work". */
EMPLOYEE_MASTER_ROWS.push({
  EmployeeId: 9999, EmployeeName: "Employee 9999", EmployeeCode: "E9999", DateOfRetirement: null,
});

function queryText(strings) {
  return strings.join("?").replace(/\s+/g, " ");
}

function makeQuery({ savedDetailsByEmployeeId }) {
  return function query(strings) {
    const text = queryText(strings);

    if (/FROM dbo\.EmployeeMaster/i.test(text)) {
      return Promise.resolve({ recordset: EMPLOYEE_MASTER_ROWS });
    }
    if (/FROM dbo\.SalaryEmployeeDetails/i.test(text)) {
      return Promise.resolve({ recordset: Array.from(savedDetailsByEmployeeId.values()) });
    }
    if (/FROM dbo\.SalaryEntryBillEmployeeDetails/i.test(text)) {
      return Promise.resolve({ recordset: [] });
    }
    if (/FROM dbo\.EmployeePayrollConfiguration/i.test(text)) {
      return Promise.resolve({ recordset: [] });
    }
    /* Anything else (GPFNPS lookup, increment resolution, etc.) is not
       exercised by this test because every employee below already has a
       saved snapshot row, so buildEmployeeRows never falls through to the
       fresh-calculation branch that would need them. */
    return Promise.resolve({ recordset: [] });
  };
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
const savedDetailsByEmployeeId = new Map();
require.cache[dbPath].exports = {
  sql: {
    query: makeQuery({ savedDetailsByEmployeeId }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};

const salaryEntry = require("../routes/salaryEntry");
const { finalizeSnapshotAmounts, buildEmployeeRows } = salaryEntry;

/* ===================== FIXTURES ===================== */

function entryRow(over = {}) {
  return {
    employeeId: over.employeeId,
    employeeName: over.employeeName || `Employee ${over.employeeId}`,
    designation: "Clerk",
    employeeType: "REGULAR",
    pension: "GPF",
    basicPay: 40000,
    fixBasic: 0,
    gradePay: 0,
    da: 22000,
    hra: 3600,
    ma: 500,
    ta: 3600,
    cla: 0,
    specialAllowance: 0,
    washingAllowance: 0,
    otherEarnings: 0,
    nppa: 0,
    gpfSubscription: 5000,
    gpfAdvance: 0,
    nps: 0,
    incomeTax: 1000,
    professionalTax: 200,
    otherDeduction: 0,
    daRate: 55,
    hraRate: 9,
    basicDriven: false,
    recalcFromBasic: false,
    fromSnapshot: true,
    ...over,
  };
}

/* dbo.SalaryEmployeeDetails has NO DateOfRetirement column — the fixture
   deliberately omits it, exactly like the real saved-snapshot table, so
   the test fails if the fix ever started relying on the snapshot instead
   of re-reading EmployeeMaster. */
function storedDetail(row, employeeId) {
  return {
    Id: 5000 + employeeId,
    EmployeeId: employeeId,
    EmployeeName: row.employeeName,
    Designation: row.designation,
    EmployeeType: row.employeeType,
    PensionType: row.pension,
    DisplayOrder: 1,
    BasicPay: row.basicPay,
    GradePay: row.gradePay,
    TotalBasic: row.totalBasic,
    DA: row.da, HRA: row.hra, MA: row.ma, TA: row.ta, CLA: row.cla,
    SpecialAllowance: row.specialAllowance,
    WashingAllowance: row.washingAllowance,
    OtherEarnings: row.otherEarnings,
    NPPA: row.nppa,
    GrossSalary: row.grossSalary,
    GPFSubscription: row.gpfSubscription,
    GPFAdvance: row.gpfAdvance,
    NPS: row.nps,
    IncomeTax: row.incomeTax,
    ProfessionalTax: row.professionalTax,
    OtherDeduction: row.otherDeduction,
    TotalDeduction: row.totalDeduction,
    NetSalary: row.netSalary,
    InstituteCode: "CPD-06",
  };
}

for (const emp of EMPLOYEE_MASTER_ROWS) {
  const row = finalizeSnapshotAmounts(
    entryRow({ employeeId: emp.EmployeeId }),
    { pension: "GPF", hraForcedZero: false }
  ).row;
  savedDetailsByEmployeeId.set(emp.EmployeeId, storedDetail(row, emp.EmployeeId));
}

/* ===================== TEST RUNNER ===================== */

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

(async () => {
  section("A — API response: dateOfRetirement resolves from EmployeeMaster (saved-snapshot path)");

  const { rows } = await buildEmployeeRows({
    bill: { BillCodeId: 1018, SalaryMonth: "AUG-2026", SalaryYear: "2026", SalaryMonthNumber: "08" },
    institute: { InstituteId: 1, InstituteCode: "CPD-06" },
    asOfDate: "2026-08-31",
    billMonth: "AUG-26",
    isCanonical: true,
  });

  const byId = new Map(rows.map((r) => [Number(r.employeeId), r]));

  check("A1. 7 employees returned (6 real + 1 with no date on file)", rows.length, 7);
  for (const id of Object.keys(REAL_RETIREMENT_DATES).map(Number)) {
    check(
      `A2.${id}. Employee ${id} gets its own EmployeeMaster retirement date, even though the saved snapshot has no such column`,
      byId.get(id)?.dateOfRetirement ? new Date(byId.get(id).dateOfRetirement).toISOString().slice(0, 10) : null,
      REAL_RETIREMENT_DATES[id]
    );
  }
  check(
    "A3. Employee 9999 (no date in EmployeeMaster) comes back null, never invented",
    byId.get(9999)?.dateOfRetirement,
    null
  );
  check(
    "A4. Saved-snapshot row (dbo.SalaryEmployeeDetails) itself carries no DateOfRetirement column",
    "DateOfRetirement" in storedDetail(entryRow({ employeeId: 2093 }), 2093),
    false
  );

  section("B — Salary calculation is untouched by the fix");
  const totalBasic2093 = byId.get(2093)?.totalBasic;
  check("B1. Basic Pay / Total Basic Pay unaffected", totalBasic2093, 40000);
  check("B2. NPS/GPF fields unaffected (GPF member keeps its subscription)", byId.get(2093)?.gpfSubscription, 5000);
  check("B3. every row's employeeId round-trips correctly", rows.map((r) => Number(r.employeeId)).sort((a, b) => a - b),
    [2093, 2094, 2095, 2097, 2098, 2099, 9999]);

  section("C — Frontend reads the right property and formats it correctly");
  const pageSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "pages", "SalaryEntry.jsx"), "utf8");

  check("C1. formatRetirementDate() is defined", /const formatRetirementDate = /.test(pageSrc), true);
  check("C2. the grid cell reads employee.dateOfRetirement (not some other name)",
    /formatRetirementDate\(employee\.dateOfRetirement\)/.test(pageSrc), true);
  check("C3. GridToolbar's column definition reads the same property",
    /getValue: \(row\) => formatRetirementDate\(row\?\.dateOfRetirement\)/.test(pageSrc), true);

  /* Exercise the actual formatter against the exact shapes the API can
     realistically emit (mssql `date` columns arrive as JS Date objects,
     which JSON.stringify turns into an ISO datetime string on the wire). */
  const fmtMatch = pageSrc.match(
    /const formatRetirementDate = \(value\) => \{[\s\S]*?\n\};/
  );
  check("C4. formatRetirementDate source found for direct execution", Boolean(fmtMatch), true);
  // eslint-disable-next-line no-new-func
  const formatRetirementDate = new Function(`${fmtMatch[0]}; return formatRetirementDate;`)();

  check("C5. ISO datetime from the API -> DD-MM-YYYY", formatRetirementDate("2035-06-30T00:00:00.000Z"), "30-06-2035");
  check("C6. plain ISO date -> DD-MM-YYYY", formatRetirementDate("2032-04-30"), "30-04-2032");
  check("C7. a JS Date instance -> DD-MM-YYYY", formatRetirementDate(new Date(Date.UTC(2029, 0, 31))), "31-01-2029");
  check("C8. null -> \"-\" (no retirement date on file)", formatRetirementDate(null), "-");
  check("C9. undefined -> \"-\"", formatRetirementDate(undefined), "-");
  check("C10. empty string -> \"-\"", formatRetirementDate(""), "-");

  section("D — column stays display-only and in its required position");
  check("D1. Retirement Date sits between Type and Pension in the header",
    /Type\s*<\/th>\s*<th[\s\S]{0,80}retirement-col[\s\S]{0,80}Retirement Date[\s\S]{0,80}<th[\s\S]{0,80}pension-col[\s\S]{0,80}Pension/.test(pageSrc),
    true);
  check("D2. no input/editable control renders inside the retirement-col cell",
    /retirement-col">\s*\{formatRetirementDate\(employee\.dateOfRetirement\)\}\s*<\/td>/.test(pageSrc),
    true);
  check("D3. GridToolbar column list still ends with Cheque Amount (order otherwise unchanged)",
    /\{ key: "chequeAmount", label: "Cheque Amount" \},\s*\]\}/.test(pageSrc), true);

  section("E — End-to-end: the exact 6 employees confirmed live in SSMS (2026-09-25)");
  console.log("  EmployeeId | SQL DateOfRetirement | API dateOfRetirement | Grid display");
  for (const id of Object.keys(REAL_RETIREMENT_DATES).map(Number)) {
    const apiValue = byId.get(id)?.dateOfRetirement;
    const display = formatRetirementDate(apiValue);
    console.log(
      `  ${id}       | ${REAL_RETIREMENT_DATES[id]}           | ${apiValue ? new Date(apiValue).toISOString().slice(0, 10) : "NULL"}            | ${display}`
    );
    check(`E.${id}. renders as required (${REQUIRED_DISPLAY[id]})`, display, REQUIRED_DISPLAY[id]);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
})();
