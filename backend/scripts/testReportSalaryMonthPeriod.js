/**
 * Report period = SALARY MONTH (cases A-I).
 *
 * One salary month can hold several bills with different Bill Months. Both
 * the Cheque Register and the Bank Copy must list ALL approved bills of the
 * selected salary month, whatever their Bill Month, while the Bill Month
 * keeps its separate job: the month column and REGULAR/OLD classification.
 *
 * Every assertion here checks RETURNED ROWS AND VALUES, not source shape.
 *
 * Runs offline. Usage: cd backend && npm run test:report-period
 */

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

const cheque = require("../routes/chequeRegister");
const bankCopy = require("../routes/bankCopy");

/* ===================== FIXTURE ===================== */

/* Three bills in salary month JUNE 2026, with three different Bill Months. */
const BILL_A = { BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026",
                 SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026" };
const BILL_B = { BillCode: "JUN-2026", BillMonth: "JUN-2026",
                 SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026" };
const BILL_C = { BillCode: "JUN-2026-BM-APR", BillMonth: "APR-2026",
                 SalaryMonth: "June", SalaryMonthNumber: "06", SalaryYear: "2026" };
/* Control: a genuine MAY salary month bill. */
const BILL_D = { BillCode: "MAY-2026", BillMonth: "MAY-2026",
                 SalaryMonth: "May", SalaryMonthNumber: "05", SalaryYear: "2026" };

const base = {
  WorkflowStatus: "APPROVED",
  SectionId: 1,
  BillCategory: "Salary",
  BillType: "",
  InstituteBankAccount: "",
  EmployeeBankAccount: "",
  DisplayOrder: 1,
  NetSalary: 0,
  IncomeTax: 0,
  ProfessionalTax: 0,
};

const dbRow = (bill, over) => ({ ...base, ...bill, ...over });

/* ===================== RUNNER ===================== */

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
  console.log("Report period is the SALARY MONTH, across every Bill Month (A-I)");
  console.log("=".repeat(76));

  /* ============ CHEQUE REGISTER ============ */
  section("A, B, C, D — Cheque Register lists every bill of the salary month");

  const registerDbRows = [
    dbRow(BILL_A, { InstituteCode: "CPD-17", InstituteName: "CPD Seventeen", SectionName: "CPD", EmpCount: 2, NetSalary: 65000, BillNo: "A-1" }),
    dbRow(BILL_B, { InstituteCode: "CPD-06", InstituteName: "CPD Six", SectionName: "CPD", EmpCount: 3, NetSalary: 90000, BillNo: "B-1" }),
    dbRow(BILL_C, { InstituteCode: "CPD-100", InstituteName: "CPD Hundred", SectionName: "CPD", EmpCount: 1, NetSalary: 20000, BillNo: "C-1" }),
    dbRow(BILL_D, { InstituteCode: "CPD-25", InstituteName: "CPD Twentyfive", SectionName: "CPD", EmpCount: 1, NetSalary: 30000, BillNo: "D-1" }),
  ];
  const mapped = registerDbRows.map((r, i) => cheque.mapAggregateRow(r, i + 1));
  const june = cheque.filterRows(mapped, { month: 6, year: 2026 });
  const may = cheque.filterRows(mapped, { month: 5, year: 2026 });

  check("June 2026 returns three bills", june.length, 3);
  check("A. the MAY Bill-Month bill is included",
    june.some((r) => r.billCode === "JUN-2026-BM-MAY"), true);
  check("B. the JUN Bill-Month bill is included",
    june.some((r) => r.billCode === "JUN-2026"), true);
  check("C. the APR Bill-Month bill is included",
    june.some((r) => r.billCode === "JUN-2026-BM-APR"), true);
  check("D. the MAY-2026 salary-month bill is NOT included",
    june.some((r) => r.billCode === "MAY-2026"), false);
  check("D. and May 2026 returns only that bill",
    may.map((r) => r.billCode), ["MAY-2026"]);
  check("D. May does not pick up the June bills whose Bill Month is May",
    may.some((r) => r.billCode === "JUN-2026-BM-MAY"), false);

  section("Each bill stays its own row, with its own values");

  check("three separate rows, never merged",
    june.map((r) => r.billNo).sort(), ["A-1", "B-1", "C-1"]);
  check("each row keeps its own employee count",
    june.map((r) => [r.billCode, r.emp]).sort(),
    [["JUN-2026", 3], ["JUN-2026-BM-APR", 1], ["JUN-2026-BM-MAY", 2]]);
  check("each row keeps its own net amount",
    june.map((r) => [r.billCode, r.netAmount]).sort(),
    [["JUN-2026", 90000], ["JUN-2026-BM-APR", 20000], ["JUN-2026-BM-MAY", 65000]]);

  section("Bill Month still drives the month column and REGULAR/OLD");

  check("the month column shows each bill's own Bill Month",
    june.map((r) => [r.billCode, r.billMonthLabel]).sort(),
    [["JUN-2026", "JUN-2026"], ["JUN-2026-BM-APR", "APR-2026"],
     ["JUN-2026-BM-MAY", "MAY-2026"]]);
  check("REGULAR when the bill month equals the salary month",
    june.find((r) => r.billCode === "JUN-2026").type, "REGULAR");
  check("OLD when it differs",
    june.filter((r) => r.billCode !== "JUN-2026").map((r) => r.type), ["OLD", "OLD"]);
  check("the previous parsing bug has not returned",
    june.find((r) => r.billCode === "JUN-2026-BM-MAY").billMonthLabel !== "JUN-2026", true);

  /* ============ I ============ */
  section("I — group ordering and Sr. No. after the final filter");

  const numbered = cheque.sortAndNumberRows(june.concat(
    cheque.filterRows(
      [cheque.mapAggregateRow(dbRow(BILL_B, {
        InstituteCode: "CPD-25", InstituteName: "CPD Twentyfive",
        SectionName: "CPD", EmpCount: 1, NetSalary: 1, BillNo: "E-1" }), 9)],
      { month: 6, year: 2026 }
    )
  ));
  check("I. groups in natural order",
    numbered.map((r) => r.group), ["CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
  check("I. Sr. No. assigned after that ordering",
    numbered.map((r) => r.srNo), [1, 2, 3, 4]);
  check("I. CPD-100 is last, not second",
    numbered[numbered.length - 1].group, "CPD-100");

  /* ============ BANK COPY ============ */
  section("E, F, G, H — Bank Copy across every Bill Month of the salary month (merged per beneficiary, 2026-09-25)");

  const bankDbRows = [
    /* Employee 2011 appears in BOTH June bills — two real amounts owed. */
    dbRow(BILL_A, { InstituteCode: "OGE-05", InstituteName: "OGE Five", InstituteBankAccount: "3222",
                    EmployeeId: 2011, EmployeeName: "Emp 2011", EmployeeBankAccount: "9001",
                    NetSalary: 35000, ProfessionalTax: 1000, IncomeTax: 500, DisplayOrder: 1 }),
    dbRow(BILL_B, { InstituteCode: "OGE-05", InstituteName: "OGE Five", InstituteBankAccount: "3222",
                    EmployeeId: 2011, EmployeeName: "Emp 2011", EmployeeBankAccount: "9001",
                    NetSalary: 36000, ProfessionalTax: 2000, IncomeTax: 700, DisplayOrder: 1 }),
    dbRow(BILL_C, { InstituteCode: "OGE-05", InstituteName: "OGE Five", InstituteBankAccount: "3222",
                    EmployeeId: 2012, EmployeeName: "Emp 2012", EmployeeBankAccount: "9002",
                    NetSalary: 30000, ProfessionalTax: 300, IncomeTax: 0, DisplayOrder: 2 }),
    /* Control: same employee, but a MAY salary month bill. */
    dbRow(BILL_D, { InstituteCode: "OGE-05", InstituteName: "OGE Five", InstituteBankAccount: "3222",
                    EmployeeId: 2011, EmployeeName: "Emp 2011", EmployeeBankAccount: "9001",
                    NetSalary: 99999, ProfessionalTax: 9999, IncomeTax: 9999, DisplayOrder: 1 }),
  ];

  const bcJune = bankCopy.filterBankCopyRows(bankDbRows, { month: 6, year: 2026 });
  check("E. all three June bills are in scope",
    bcJune.map((r) => r.BillCode).sort(),
    ["JUN-2026", "JUN-2026-BM-APR", "JUN-2026-BM-MAY"]);
  check("D. the MAY salary-month bill is excluded",
    bcJune.some((r) => r.BillCode === "MAY-2026"), false);

  const bcRows = bankCopy.buildBankCopyRows(bcJune);
  const institute = bcRows.find((r) => r.type === "INSTITUTE");
  const emp2011 = bcRows.find((r) => r.employeeId === 2011);
  const emp2012 = bcRows.find((r) => r.employeeId === 2012);

  /* Rule change (2026-09-25, superseding the 2026-09-24 decision above):
     all three June bills pay the SAME OGE-05 / account "3222" beneficiary,
     so Bank Copy now prints ONE institute credit and ONE credit per employee,
     summed across every Bill Month instance that contributed to it. Nothing
     is dropped: the printed total is unchanged from before this fix. */
  const institutes = bcRows.filter((r) => r.type === "INSTITUTE");
  const credits2011 = bcRows.filter((r) => r.employeeId === 2011);
  check("F. one merged institute tax credit for the whole beneficiary: 1000+500+2000+700+300+0",
    institutes.map((r) => r.amount), [4500]);
  check("F. together they are still the full 4500 of tax",
    institutes.reduce((t, r) => t + r.amount, 0), 4500);
  check("F. and the MAY control's tax is not counted",
    institutes.every((r) => r.amount < 9999), true);
  check("G. employee 2011 is paid once, summed from exactly those two bills",
    credits2011.length === 1 ? credits2011[0].sourceBillCodes.slice().sort() : null,
    ["JUN-2026", "JUN-2026-BM-MAY"]);
  check("G. the merged credit's Bill Month combines both instances, oldest first",
    credits2011[0]?.billMonth, "MAY-2026 + JUN-2026");
  check("G. the MAY control amount is not added",
    credits2011.some((r) => r.amount === 99999), false);
  check("G. employee 2012 keeps only his own bill (different employee, same beneficiary group)",
    [emp2012.amount, emp2012.sourceBillCodes, emp2012.billMonth], [30000, ["JUN-2026-BM-APR"], "APR-2026"]);
  check("H. employee 2011 has ONE credit, merged from two bills, never two rows",
    credits2011.length, 1);
  check("H. no salary was silently dropped",
    credits2011.reduce((t, r) => t + r.amount, 0), 35000 + 36000);
  check("H. one beneficiary -> one institute line + one credit per employee (not one block per bill)",
    bcRows.map((r) => r.type), ["INSTITUTE", "EMPLOYEE", "EMPLOYEE"]);
  check("H. Sr. No. runs densely over every payment line, institutes included",
    [bcRows.every((r) => Number.isInteger(r.srNo) && r.srNo > 0),
     bcRows.map((r) => r.srNo)], [true, [1, 2, 3]]);
  check("the report total is the sum of what is printed (unchanged by merging)",
    bcRows.reduce((s, r) => s + Number(r.amount), 0), 4500 + 71000 + 30000);

  /* ============ O, P ============ */
  section("O, P — tax and net never cross over; a zero-tax institute is skipped");

  check("O. the institute's tax is not any employee's net",
    [institute.amount === emp2011.amount, institute.amount === emp2012.amount],
    [false, false]);
  check("O. and no employee was paid the tax figure by mistake",
    bcRows.filter((r) => r.type === "EMPLOYEE").some((r) => r.amount === institute.amount),
    false);
  check("O. the institute line is far smaller than the payroll it belongs to",
    institute.amount < emp2011.amount + emp2012.amount, true);

  /* An institute whose employees carry no PT and no IT at all. */
  const zeroTax = bankCopy.buildBankCopyRows(
    bankCopy.filterBankCopyRows(
      [
        dbRow(BILL_A, { InstituteCode: "BD-01", InstituteName: "BD One",
                        InstituteBankAccount: "7777", EmployeeId: 3001,
                        EmployeeName: "No Tax A", EmployeeBankAccount: "8001",
                        NetSalary: 25000, ProfessionalTax: 0, IncomeTax: 0 }),
        dbRow(BILL_B, { InstituteCode: "BD-01", InstituteName: "BD One",
                        InstituteBankAccount: "7777", EmployeeId: 3002,
                        EmployeeName: "No Tax B", EmployeeBankAccount: "8002",
                        NetSalary: 26000, ProfessionalTax: 0, IncomeTax: 0,
                        DisplayOrder: 2 }),
      ],
      { month: 6, year: 2026 }
    )
  );
  check("P. no institute payment line is emitted for zero tax",
    zeroTax.some((r) => r.type === "INSTITUTE"), false);
  check("P. its employees are still payable",
    zeroTax.map((r) => [r.name, r.amount]),
    [["No Tax A", 25000], ["No Tax B", 26000]]);
  check("P. and are numbered from 1",
    zeroTax.map((r) => r.srNo), [1, 2]);
  check("P. no zero-amount row is printed at all",
    zeroTax.some((r) => Number(r.amount) === 0), false);

  /* ============ Header ============ */
  section("Header names the SALARY month, not a source bill's Bill Month");

  check("June is spelled out in full",
    /JUNE/.test(["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST",
      "SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"][5]), true);
  check("the heading month comes from the selected filter, not a bill row",
    bcJune.some((r) => r.BillMonth === "MAY-2026"), true);

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
