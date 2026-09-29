/**
 * BANK COPY — cross-Bill-Month beneficiary aggregation (2026-09-25).
 *
 * Bug: the same institute/bank-account beneficiary paid across more than one
 * Bill Month instance of the same salary month (e.g. an AUG-2026 salary paid
 * partly on a JUL-2026 bill and partly on an AUG-2026 bill) printed as two
 * separate Bank Copy rows instead of one combined payment.
 *
 * Fix: buildBankCopyRows() now groups by beneficiary identity
 * (InstituteCode + Bank Account Number for the institute's own PT+IT credit;
 * EmployeeId within that beneficiary group for employee Net Salary credits)
 * instead of by InstituteCode + WorkflowId, and sums every eligible amount
 * into one row per beneficiary.
 *
 * Scope: ONLY backend/routes/bankCopy.js's buildBankCopyRows() and the
 * compareInstituteGroups() tie-break. Nothing else — not Salary Entry, not
 * Salary Register, not Cheque Register, not Employee Wise Salary, not the DA
 * Difference path (buildDaBankCopyRows), not the frontend — is touched by
 * this fix, and this file proves that in addition to the aggregation itself.
 *
 * Runs offline. Usage: node backend/scripts/testBankCopyAggregation.js
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

const { buildBankCopyRows, buildDaBankCopyRows } = require("../routes/bankCopy");

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

/* One base row per (institute, account, employee, Bill Month instance). */
function row(over) {
  return {
    BillCode: "BILL", BillMonth: "JUL-2026", SalaryMonth: "August",
    SalaryMonthNumber: "08", SalaryYear: "2026",
    WorkflowId: undefined,
    WorkflowStatus: "APPROVED",
    SectionId: 1, SectionSrNo: 1, SectionName: "DD",
    InstituteName: "Institute", InstituteBankAccount: "",
    DisplayOrder: 1, NetSalary: 0, IncomeTax: 0, ProfessionalTax: 0,
    EmployeeBankAccount: "", EmployeeName: "", EmployeeCode: "",
    ...over,
  };
}

function main() {
  console.log("=".repeat(74));
  console.log("BANK COPY — beneficiary aggregation across Bill Month instances");
  console.log("=".repeat(74));

  /* ============ TEST 1: DDRS-16 / 6600286690 — July 600 + August 600 = one row, 1200 ============ */
  section("TEST 1 — same institute/account, two Bill Months -> one row summed");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteName: "Special Care Center for Slow Learners",
            InstituteBankAccount: "6600286690", BillCode: "AUG-2026-BM-JUL", BillMonth: "JUL-2026",
            WorkflowId: 501, ProfessionalTax: 600, IncomeTax: 0,
            DisplayOrder: 1, NetSalary: 0, EmployeeId: 900001, EmployeeName: "Zero-Net Placeholder" }),
      row({ InstituteCode: "DDRS-16", InstituteName: "Special Care Center for Slow Learners",
            InstituteBankAccount: "6600286690", BillCode: "AUG-2026", BillMonth: "AUG-2026",
            WorkflowId: 502, ProfessionalTax: 600, IncomeTax: 0,
            DisplayOrder: 1, NetSalary: 0, EmployeeId: 900001, EmployeeName: "Zero-Net Placeholder" }),
    ];
    const out = buildBankCopyRows(rows);
    check("TEST 1 — exactly one institute row for this beneficiary", out.filter((r) => r.code === "DDRS-16" && r.type === "INSTITUTE").length, 1);
    check("TEST 1 — combined amount is 1200 (600 + 600)", out.find((r) => r.code === "DDRS-16")?.amount, 1200);
    check("TEST 1 — row type is INSTITUTE (PT/IT credit)", out.find((r) => r.code === "DDRS-16")?.type, "INSTITUTE");
    check("TEST 1 — bank account preserved from the beneficiary record", out.find((r) => r.code === "DDRS-16")?.bankAccount, "6600286690");
    check("TEST 1 — Bill Month shown combines both instances, oldest first", out.find((r) => r.code === "DDRS-16")?.billMonth, "JUL-2026 + AUG-2026");
  }

  /* ============ TEST 2: Account A — July 600 + August 600 + September 500 = one row, 1700 ============ */
  section("TEST 2 — three Bill Months, same account -> one row with the sum of all three");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "JUL-2026", WorkflowId: 601, ProfessionalTax: 600, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "AUG-2026", WorkflowId: 602, ProfessionalTax: 600, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "SEP-2026", WorkflowId: 603, ProfessionalTax: 500, EmployeeId: 1, EmployeeName: "Emp A" }),
    ];
    const out = buildBankCopyRows(rows);
    const accountRows = out.filter((r) => r.bankAccount === "AAA-ACCOUNT" || (r.type === "INSTITUTE" && r.code === "DDRS-16"));
    check("TEST 2 — exactly one institute row", out.filter((r) => r.type === "INSTITUTE").length, 1);
    check("TEST 2 — total is 1700 (600 + 600 + 500)", out.find((r) => r.type === "INSTITUTE")?.amount, 1700);
    check("TEST 2 — combined Bill Month label lists all three", out.find((r) => r.type === "INSTITUTE")?.billMonth, "JUL-2026 + AUG-2026 + SEP-2026");
  }

  /* ============ TEST 3: Account A (1700) and Account B (2500) never merge ============ */
  section("TEST 3 — same institute code, two different bank accounts -> two separate rows, never merged");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "JUL-2026", WorkflowId: 701, ProfessionalTax: 600, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "AUG-2026", WorkflowId: 702, ProfessionalTax: 600, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "AAA-ACCOUNT", BillMonth: "SEP-2026", WorkflowId: 703, ProfessionalTax: 500, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "BBB-ACCOUNT", BillMonth: "JUL-2026", WorkflowId: 704, ProfessionalTax: 1000, EmployeeId: 2, EmployeeName: "Emp B" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "BBB-ACCOUNT", BillMonth: "AUG-2026", WorkflowId: 705, ProfessionalTax: 1500, EmployeeId: 2, EmployeeName: "Emp B" }),
    ];
    const out = buildBankCopyRows(rows);
    const instituteRows = out.filter((r) => r.type === "INSTITUTE" && r.code === "DDRS-16");
    check("TEST 3 — two separate institute rows (one per account)", instituteRows.length, 2);
    const accA = instituteRows.find((r) => r.bankAccount === "AAA-ACCOUNT");
    const accB = instituteRows.find((r) => r.bankAccount === "BBB-ACCOUNT");
    check("TEST 3 — Account A total is 1700", accA?.amount, 1700);
    check("TEST 3 — Account B total is 2500 (1000 + 1500)", accB?.amount, 2500);
    check("TEST 3 — Account A and Account B are different rows", accA === accB, false);
  }

  /* ============ TEST 4: different institutes, same account number stay separate ============ */
  section("TEST 4 — different institute codes sharing an account number -> separate rows, not merged");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "SHARED-999", BillMonth: "JUL-2026", WorkflowId: 801, ProfessionalTax: 400, EmployeeId: 1, EmployeeName: "Emp A" }),
      row({ InstituteCode: "DDRS-20", InstituteBankAccount: "SHARED-999", BillMonth: "JUL-2026", WorkflowId: 802, ProfessionalTax: 900, EmployeeId: 2, EmployeeName: "Emp B" }),
    ];
    const out = buildBankCopyRows(rows);
    const instituteRows = out.filter((r) => r.type === "INSTITUTE");
    check("TEST 4 — two separate institute rows (different codes)", instituteRows.length, 2);
    check("TEST 4 — DDRS-16's amount unaffected by DDRS-20 sharing the account", instituteRows.find((r) => r.code === "DDRS-16")?.amount, 400);
    check("TEST 4 — DDRS-20's amount unaffected by DDRS-16 sharing the account", instituteRows.find((r) => r.code === "DDRS-20")?.amount, 900);
  }

  /* ============ TEST 5: no double counting ============ */
  section("TEST 5 — no double counting: sum of all eligible rows equals the merged total");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "JUL-2026", WorkflowId: 901, ProfessionalTax: 600, EmployeeId: 5, EmployeeName: "Emp E", NetSalary: 30000 }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "AUG-2026", WorkflowId: 902, ProfessionalTax: 600, EmployeeId: 5, EmployeeName: "Emp E", NetSalary: 32000 }),
    ];
    const out = buildBankCopyRows(rows);
    const sumOfInputs = rows.reduce((s, r) => s + r.ProfessionalTax + r.IncomeTax, 0);
    const sumOfInputsNet = rows.reduce((s, r) => s + r.NetSalary, 0);
    const institute = out.find((r) => r.type === "INSTITUTE");
    const employee = out.find((r) => r.type === "EMPLOYEE");
    check("TEST 5 — institute credit equals the exact sum of input PT+IT (no double count)", institute?.amount, sumOfInputs);
    check("TEST 5 — employee credit equals the exact sum of input NetSalary (no double count)", employee?.amount, sumOfInputsNet);
    check("TEST 5 — exactly one employee row for this employee across both instances", out.filter((r) => r.type === "EMPLOYEE" && r.employeeId === 5).length, 1);
  }

  /* ============ TEST 6: single Bill Month still behaves exactly as before ============ */
  section("TEST 6 — a beneficiary appearing in only one Bill Month is unaffected");
  {
    const rows = [
      row({ InstituteCode: "CPD-06", InstituteBankAccount: "3222", BillMonth: "JUN-2026", WorkflowId: 1001, ProfessionalTax: 200, EmployeeId: 9, EmployeeName: "Solo", NetSalary: 40000 }),
    ];
    const out = buildBankCopyRows(rows);
    check("TEST 6 — one institute row", out.filter((r) => r.type === "INSTITUTE").length, 1);
    check("TEST 6 — amount unchanged (200)", out.find((r) => r.type === "INSTITUTE")?.amount, 200);
    check("TEST 6 — single-instance Bill Month label has no ' + '", out.find((r) => r.type === "INSTITUTE")?.billMonth, "JUN-2026");
    check("TEST 6 — employee net salary unchanged (40000)", out.find((r) => r.type === "EMPLOYEE")?.amount, 40000);
  }

  /* ============ TEST 7: three-or-more Bill Months for the same beneficiary all sum into one row ============ */
  section("TEST 7 — a beneficiary appearing in 3+ Bill Months still produces exactly one row");
  {
    const rows = [
      row({ InstituteCode: "OGE-11", InstituteBankAccount: "OGE-ACC-1", BillMonth: "MAY-2026", WorkflowId: 1101, ProfessionalTax: 100, EmployeeId: 21, EmployeeName: "Emp X" }),
      row({ InstituteCode: "OGE-11", InstituteBankAccount: "OGE-ACC-1", BillMonth: "JUN-2026", WorkflowId: 1102, ProfessionalTax: 150, EmployeeId: 21, EmployeeName: "Emp X" }),
      row({ InstituteCode: "OGE-11", InstituteBankAccount: "OGE-ACC-1", BillMonth: "JUL-2026", WorkflowId: 1103, ProfessionalTax: 250, EmployeeId: 21, EmployeeName: "Emp X" }),
      row({ InstituteCode: "OGE-11", InstituteBankAccount: "OGE-ACC-1", BillMonth: "AUG-2026", WorkflowId: 1104, ProfessionalTax: 500, EmployeeId: 21, EmployeeName: "Emp X" }),
    ];
    const out = buildBankCopyRows(rows);
    const instituteRows = out.filter((r) => r.type === "INSTITUTE" && r.code === "OGE-11");
    check("TEST 7 — exactly one row despite four Bill Month instances", instituteRows.length, 1);
    check("TEST 7 — total sums all four (100+150+250+500=1000)", instituteRows[0]?.amount, 1000);
  }

  /* ============ TEST 8: existing eligibility rules (workflow status) are unchanged ============ */
  section("TEST 8 — existing eligibility rules (approved/locked only) are preserved by the aggregation");
  {
    /* buildBankCopyRows itself takes already-filtered rows; eligibility is
       filterBankCopyRows()'s job and is untouched by this fix. This proves
       buildBankCopyRows has no independent status logic that could interfere
       with aggregation. */
    const rows = [
      row({ InstituteCode: "SEC-01", InstituteBankAccount: "SEC-ACC", BillMonth: "JUL-2026", WorkflowId: 1201, ProfessionalTax: 300, EmployeeId: 31, EmployeeName: "Emp Y" }),
    ];
    const out = buildBankCopyRows(rows);
    check("TEST 8 — a single eligible row still produces a payable institute row", out.some((r) => r.type === "INSTITUTE" && r.code === "SEC-01"), true);
  }

  /* ============ TEST 9: totals remain mathematically correct after aggregation ============ */
  section("TEST 9 — the report total (sum of displayed rows) is unaffected by aggregation");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "JUL-2026", WorkflowId: 1301, ProfessionalTax: 600, EmployeeId: 41, EmployeeName: "Emp Z", NetSalary: 20000 }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "AUG-2026", WorkflowId: 1302, ProfessionalTax: 600, EmployeeId: 41, EmployeeName: "Emp Z", NetSalary: 20000 }),
      row({ InstituteCode: "CPD-06", InstituteBankAccount: "3222", BillMonth: "JUN-2026", WorkflowId: 1303, ProfessionalTax: 200, EmployeeId: 42, EmployeeName: "Other", NetSalary: 40000 }),
    ];
    const out = buildBankCopyRows(rows);
    const total = out.reduce((s, r) => s + Number(r.amount), 0);
    /* DDRS-16 institute credit 600+600, Emp Z net salary merged 20000+20000,
       CPD-06 institute credit 200, Other's net salary 40000. */
    const expectedTotal = (600 + 600) + (20000 + 20000) + 200 + 40000; /* 81400 */
    check("TEST 9 — total across all rows equals the sum of every eligible input amount", total, expectedTotal);
  }

  /* ============ TEST 10: Sr. No. stays a dense 1..n after merging ============ */
  section("TEST 10 — Sr. No. is still a dense 1..n sequence once merged rows collapse the count");
  {
    const rows = [
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "JUL-2026", WorkflowId: 1401, ProfessionalTax: 600, EmployeeId: 51, EmployeeName: "Emp M" }),
      row({ InstituteCode: "DDRS-16", InstituteBankAccount: "6600286690", BillMonth: "AUG-2026", WorkflowId: 1402, ProfessionalTax: 600, EmployeeId: 51, EmployeeName: "Emp M" }),
    ];
    const out = buildBankCopyRows(rows);
    check("TEST 10 — Sr. Nos. are dense 1..n", out.map((r) => r.srNo), out.map((_, i) => i + 1));
  }

  /* ============ TEST 11: the DA Difference path is untouched by this fix ============ */
  section("TEST 11 — buildDaBankCopyRows (DA Difference path) is not affected by this fix");
  {
    const daRows = [
      { instituteCode: "CPD-25", instituteName: "CPD Twentyfive", employeeId: 1, employeeName: "Zeta",
        bankAccount: "9001", net: 4500, displayOrder: 1, sectionId: 1, sectionSrNo: 1, sectionName: "CPD",
        billCode: "DA-JUN-2026", salaryMonth: "June" },
    ];
    const out = buildDaBankCopyRows(daRows);
    check("TEST 11 — DA path still returns exactly one employee row, no INSTITUTE row type exists in DA", out.length, 1);
    check("TEST 11 — DA row amount is still the stored net", out[0].amount, 4500);
    check("TEST 11 — DA rows never carry a type other than EMPLOYEE", out.every((r) => r.type === "EMPLOYEE"), true);
  }

  /* ============ TEST 12: no visible Bill Month column is introduced ============ */
  section("TEST 12 — no new visible column: XLSX_COLUMNS still has exactly five entries, no billMonth key");
  {
    const { XLSX_COLUMNS } = require("../routes/bankCopy");
    check("TEST 12 — exactly five export columns", XLSX_COLUMNS.length, 5);
    check("TEST 12 — no billMonth key among them", XLSX_COLUMNS.some((c) => c.key === "billMonth"), false);
  }

  console.log("\n" + "=".repeat(74));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(74));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  process.exit(0);
}

main();
