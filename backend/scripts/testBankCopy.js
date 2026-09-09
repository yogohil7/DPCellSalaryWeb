/**
 * BANK COPY report (cases A-L).
 *
 * Employees are paid their stored NET SALARY; each institute is paid its own
 * Professional Tax + Income Tax total; rows are grouped by Institute Code in
 * natural order and numbered only afterwards.
 *
 * Runs offline. Usage: cd backend && npm run test:bank-copy
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

const bankCopy = require("../routes/bankCopy");
const { buildBankCopyRows, filterBankCopyRows, XLSX_COLUMNS, HEADING, SCHEME_LINE } = bankCopy;
const {
  parsePaymentType,
  buildDaBankCopyRows,
  filterDaBankCopyRows,
  DA_HEADING,
  PAYMENT_REGULAR,
  PAYMENT_DA_DIFFERENCE,
} = bankCopy;

/* ---- DA fixture: shaped exactly like loadDaDifferenceRows() output ---- */
function daRow(over) {
  return {
    salaryCategory: "DA_DIFFERENCE",
    workflowStatus: "APPROVED",
    billCode: "DA-JUN-2026",
    salaryMonthKey: "2026-06",
    sectionId: 1,
    sectionSrNo: 1,
    sectionName: "CPD",
    instituteName: "Institute",
    displayOrder: 1,
    employeeCode: "",
    bankAccount: "",
    differenceAmount: 0,
    nps: 0,
    net: 0,
    ...over,
  };
}

const DA_ROWS = [
  daRow({ instituteCode: "CPD-25", instituteName: "CPD Twentyfive", employeeId: 1,
          employeeName: "Zeta", bankAccount: "9001",
          differenceAmount: 5000, nps: 500, net: 4500, displayOrder: 1 }),
  daRow({ instituteCode: "CPD-06", instituteName: "CPD Six", employeeId: 2,
          employeeName: "Bravo", bankAccount: "9002",
          differenceAmount: 4000, nps: 400, net: 3600, displayOrder: 2 }),
  daRow({ instituteCode: "CPD-06", instituteName: "CPD Six", employeeId: 3,
          employeeName: "Alpha", bankAccount: "9003",
          differenceAmount: 3000, nps: 300, net: 2700, displayOrder: 1 }),
  daRow({ instituteCode: "CPD-100", instituteName: "CPD Hundred", employeeId: 4,
          employeeName: "Delta", bankAccount: "9004",
          differenceAmount: 2000, nps: 200, net: 1800, displayOrder: 1 }),
  daRow({ instituteCode: "CPD-17", instituteName: "CPD Seventeen", employeeId: 5,
          employeeName: "Echo", bankAccount: "9005",
          differenceAmount: 1000, nps: 100, net: 900, displayOrder: 1 }),
];

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "bankCopy.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "pages", "BankCopy.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "bankCopyApi.js"), "utf8");
const loaderSrc = fs.readFileSync(
  path.join(__dirname, "..", "utils", "salaryCategory.js"),
  "utf8"
);

/* ===================== FIXTURE ===================== */

/*
   Deliberately out of order, and CPD-100 is present so plain string ordering
   would put it before CPD-17. Two June bills share SalaryMonth JUN-2026 but
   have different Bill Months.
*/
const JUN = { BillCode: "JUN-2026", BillMonth: "JUN-2026", SalaryMonth: "June",
              SalaryMonthNumber: "06", SalaryYear: "2026" };
const BM_MAY = { BillCode: "JUN-2026-BM-MAY", BillMonth: "MAY-2026", SalaryMonth: "June",
                 SalaryMonthNumber: "06", SalaryYear: "2026" };

function row(over) {
  return {
    ...JUN,
    WorkflowStatus: "APPROVED",
    SectionId: 1,
    InstituteName: "Institute",
    InstituteBankAccount: "",
    DisplayOrder: 1,
    NetSalary: 0,
    IncomeTax: 0,
    ProfessionalTax: 0,
    EmployeeBankAccount: "",
    ...over,
  };
}

const ROWS = [
  row({ InstituteCode: "CPD-25", InstituteName: "CPD Twentyfive", InstituteBankAccount: "3111", EmployeeId: 1, EmployeeName: "Zeta", EmployeeBankAccount: "9001", NetSalary: 50000, IncomeTax: 100, ProfessionalTax: 200, DisplayOrder: 1 }),
  row({ InstituteCode: "CPD-06", InstituteName: "CPD Six", InstituteBankAccount: "3222", EmployeeId: 2, EmployeeName: "Bravo", EmployeeBankAccount: "9002", NetSalary: 40000, IncomeTax: 0, ProfessionalTax: 200, DisplayOrder: 2 }),
  row({ InstituteCode: "CPD-06", InstituteName: "CPD Six", InstituteBankAccount: "3222", EmployeeId: 3, EmployeeName: "Alpha", EmployeeBankAccount: "9003", NetSalary: 30000, IncomeTax: 500, ProfessionalTax: 200, DisplayOrder: 1 }),
  row({ InstituteCode: "CPD-100", InstituteName: "CPD Hundred", InstituteBankAccount: "3333", EmployeeId: 4, EmployeeName: "Delta", EmployeeBankAccount: "9004", NetSalary: 20000, IncomeTax: 0, ProfessionalTax: 0, DisplayOrder: 1 }),
  row({ InstituteCode: "CPD-17", InstituteName: "CPD Seventeen", InstituteBankAccount: "3444", EmployeeId: 5, EmployeeName: "Echo", EmployeeBankAccount: "9005", NetSalary: 10000, IncomeTax: 50, ProfessionalTax: 150, DisplayOrder: 1 }),
];

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

/* Section name of a code, for the assertion only — never used by the code. */
function routeSrc2() {
  return routeSrc;
}

/* Section name of a code, for the assertion only — never used by the code. */
function SEC_OF(code) {
  return String(code || "").split("-")[0];
}

function main() {
  console.log("=".repeat(74));
  console.log("BANK COPY (cases A-L)");
  console.log("=".repeat(74));

  const rows = buildBankCopyRows(ROWS);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  /* ---------------- A ---------------- */
  section("A — exactly five columns, with the exact headings");

  check("A. five export columns", XLSX_COLUMNS.length, 5);
  check("A. in the required order",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "CODE", "EMPLOYEE NAME", "BANK ACCOUNT NUMBER", "AMOUNT"]);
  check("A. the screen prints the same five",
    (pageSrc.match(/<th className="bc-c-(sr|code|name|bank|amt)">/g) || []).length, 5);
  check("A. heading text is exact", HEADING,
    ["BANK COPY", "DIRECTOR OF SOCIAL DEFENCE",
     "BLOCK NO. 16 OLD SACHIVALAY,", "GANDHINAGAR"]);
  check("A. scheme line is exact", SCHEME_LINE,
    "CORE BANKING UNDER CORPORATE SALARY PACKAGE SCHEME");
  check("A. the month line is present",
    /SALARY PAYMENT FOR THE MONTH OF/.test(routeSrc), true);
  check("A. the heading month is spelled out in full, e.g. JULY 2026",
    /MONTH_FULL_NAMES\[monthParts\.month - 1\]/.test(routeSrc), true);
  check("A. full month names are declared",
    /"JULY", "AUGUST"/.test(routeSrc), true);

  /* ---------------- B ---------------- */
  section("B — an employee's amount is the stored Net Salary");

  const alpha = rows.find((r) => r.name === "Alpha");
  check("B. Alpha is paid her stored net", alpha.amount, 30000);
  check("B. not her gross, not a cheque amount",
    /amount: round2\(row\.NetSalary\)/.test(routeSrc), true);
  check("B. the route never reads GrossSalary",
    /GrossSalary/.test(routeSrc), false);
  check("B. the route never reads ChequeAmount",
    /ChequeAmount/.test(routeSrc), false);
  check("B. and never re-runs the salary engine",
    /calculateForEmployee/.test(routeSrc), false);
  check("B. every employee row carries its own net",
    rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.amount),
    [30000, 40000, 10000, 50000, 20000]);
  check("B. and its own Sr. No. within the continuous run",
    rows.filter((r) => r.type === "EMPLOYEE").map((r) => r.srNo),
    [2, 3, 5, 7, 8]);

  /* ---------------- C / D ---------------- */
  section("C, D — Institute Code and bank accounts come from the database");

  check("C. each row carries its institute code",
    rows.map((r) => r.code),
    ["CPD-06", "CPD-06", "CPD-06", "CPD-17", "CPD-17", "CPD-25", "CPD-25", "CPD-100"]);
  check("D. the employee row uses the EMPLOYEE's account",
    alpha.bankAccount, "9003");
  check("D. the institute row uses the INSTITUTE's account",
    rows.find((r) => r.type === "INSTITUTE" && r.code === "CPD-06").bankAccount, "3222");
  check("D. accounts are read from the master tables",
    /e\.BankAccountNumber\s+AS EmployeeBankAccount/.test(routeSrc) &&
    /i\.BankAccountNumber\s+AS InstituteBankAccount/.test(routeSrc), true);
  check("D. no account number is derived from the code",
    /bankAccount:\s*[^,]*code/.test(routeSrc), false);

  /* ---------------- E ---------------- */
  section("E — the institute line is its Professional Tax + Income Tax total");

  const cpd06 = rows.find((r) => r.type === "INSTITUTE" && r.code === "CPD-06");
  check("E. CPD-06 = (0+200) + (500+200)", cpd06.amount, 900);
  check("E. CPD-17 = 50 + 150",
    rows.find((r) => r.type === "INSTITUTE" && r.code === "CPD-17").amount, 200);
  check("E. CPD-25 = 100 + 200",
    rows.find((r) => r.type === "INSTITUTE" && r.code === "CPD-25").amount, 300);
  check("E. an institute with no tax gets no payment line",
    rows.some((r) => r.type === "INSTITUTE" && r.code === "CPD-100"), false);
  check("E. its employee is still paid",
    rows.some((r) => r.type === "EMPLOYEE" && r.code === "CPD-100"), true);
  check("E. the institute line shows the institute's name",
    cpd06.name, "CPD Six");
  check("E. the tax total is never confused with a net salary",
    cpd06.amount === alpha.amount, false);

  /* ---------------- F / G ---------------- */
  section("F, G — natural Institute Code ordering");

  check("F. institutes appear in natural order",
    [...new Set(rows.map((r) => r.code))],
    ["CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
  check("G. CPD-06 before CPD-17", rows.findIndex((r) => r.code === "CPD-06") <
    rows.findIndex((r) => r.code === "CPD-17"), true);
  check("G. CPD-17 before CPD-25", rows.findIndex((r) => r.code === "CPD-17") <
    rows.findIndex((r) => r.code === "CPD-25"), true);
  check("G. CPD-25 before CPD-100 (numeric, not text)",
    rows.findIndex((r) => r.code === "CPD-25") < rows.findIndex((r) => r.code === "CPD-100"), true);
  check("G. it reuses the register's comparator, not a copy",
    /compareGroupCodes,?\s*\n\} = require\("\.\/chequeRegister"\)|compareGroupCodes,/.test(routeSrc), true);
  check("F. employees are NOT sorted by name",
    rows.filter((r) => r.code === "CPD-06" && r.type === "EMPLOYEE").map((r) => r.name),
    ["Alpha", "Bravo"]);
  check("F. they keep the salary bill's own DisplayOrder",
    /ORDER BY w\.InstituteCode, d\.DisplayOrder, d\.Id/.test(routeSrc), true);
  check("F. no institute-code prefix logic anywhere",
    /startsWith\(\s*["'](CPD|OGE|BD|DD|MR)/.test(routeSrc), false);

  /* ---------------- H ---------------- */
  section("H — Sr. No. is assigned after the final ordering");

  /*
     Rule change: an institute tax line is a real credit to the bank, so it is
     NUMBERED alongside the employee credits. The serial is a dense 1..n over
     every payment line. (It previously ran over employee rows only, leaving
     institute rows blank.) The TOTAL line is still unnumbered.
  */
  check("H. institute lines are numbered like any other payment line",
    rows.filter((r) => r.type === "INSTITUTE").map((r) => r.srNo), [1, 4, 6]);
  check("H. the serial is a dense 1..n over EVERY payment line",
    rows.map((r) => r.srNo), [1, 2, 3, 4, 5, 6, 7, 8]);
  check("H. no payment line is left without a Sr. No.",
    rows.every((r) => Number.isInteger(r.srNo) && r.srNo > 0), true);
  check("H. the first line is the first institute's tax line, as Sr. 1",
    [rows[0].type, rows[0].code, rows[0].srNo], ["INSTITUTE", "CPD-06", 1]);
  check("H. the last row is the CPD-100 employee",
    [rows[7].type, rows[7].code], ["EMPLOYEE", "CPD-100"]);
  check("H. numbering happens in exactly one place",
    (routeSrc.match(/let srNo = 1;/g) || []).length, 1);
  check("H. and only after the institutes have been sorted",
    routeSrc.indexOf("const ordered = [...byInstitute.values()].sort(compareInstituteGroups);") <
      routeSrc.indexOf("let srNo = 1;"), true);
  check("H. the input order is not what is numbered",
    rows[0].code !== ROWS[0].InstituteCode, true);

  /* ---------------- Every payment line is numbered, in printed order ---------------- */
  section("Sr. No. runs continuously over every payment line");

  /*
     The reported layout: CPD institutes carry no tax so they have no payment
     line, OGE-05 does, and its line sits between employee 5 and employee 6.
     The employee sequence must run straight through it without a gap.
  */
  const reported = buildBankCopyRows([
    row({ InstituteCode: "CPD-06", InstituteName: "CPD Six", EmployeeId: 1,
               EmployeeName: "Employee A", NetSalary: 113160 }),
    row({ InstituteCode: "CPD-17", InstituteName: "CPD Seventeen", EmployeeId: 2,
               EmployeeName: "Employee B", NetSalary: 64264, DisplayOrder: 1 }),
    row({ InstituteCode: "CPD-17", InstituteName: "CPD Seventeen", EmployeeId: 3,
               EmployeeName: "Employee C", NetSalary: 67900, DisplayOrder: 2 }),
    row({ InstituteCode: "CPD-17", InstituteName: "CPD Seventeen", EmployeeId: 4,
               EmployeeName: "Employee D", NetSalary: 63188, DisplayOrder: 3 }),
    row({ InstituteCode: "CPD-25", InstituteName: "CPD Twentyfive", EmployeeId: 5,
               EmployeeName: "Employee E", NetSalary: 204308 }),
    row({ InstituteCode: "OGE-05", InstituteName: "Samany Vruddhashram",
               InstituteBankAccount: "135546465", EmployeeId: 6, EmployeeName: "Employee F",
               NetSalary: 73088, ProfessionalTax: 200, IncomeTax: 200, DisplayOrder: 1 }),
    row({ InstituteCode: "OGE-05", InstituteName: "Samany Vruddhashram",
               InstituteBankAccount: "135546465", EmployeeId: 7, EmployeeName: "Employee G",
               NetSalary: 77004, DisplayOrder: 2 }),
  ]);

  check("1. the institute line is numbered like any other payment line",
    reported.filter((r) => r.type === "INSTITUTE").map((r) => r.srNo).every(
      (n) => Number.isInteger(n) && n > 0), true);
  check("2. the first line of the report is the first employee as Sr. 1",
    reported.filter((r) => r.type === "EMPLOYEE")[0].srNo, 1);
  check("3. the institute line sits between employees, numbered in sequence",
    (() => {
      const at = reported.findIndex((r) => r.type === "INSTITUTE");
      return [reported[at - 1].srNo, reported[at].srNo, reported[at + 1].srNo];
    })(), [5, 6, 7]);
  check("4. Sr. Nos. are a dense 1..n over every payment line",
    reported.map((r) => r.srNo),
    reported.map((_, i) => i + 1));
  check("4. institute rows are numbered too",
    reported.filter((r) => r.type === "INSTITUTE").every(
      (r) => Number.isInteger(r.srNo) && r.srNo > 0), true);
  check("4. the highest serial equals the payment-line count",
    [Math.max(...reported.map((r) => r.srNo)), reported.length], [8, 8]);
  check("5. only the TOTAL line stays unnumbered",
    /srNo: "",\s*\n\s*code: "",\s*\n\s*name: "TOTAL"/.test(pageSrc), true);
  check("5. and the printed TOTAL cell is empty",
    /<td className="bc-c-sr" \/>\s*\n\s*<td className="bc-c-code" \/>/.test(pageSrc), true);
  check("6. it holds across several institutes",
    reported.filter((r) => r.type === "EMPLOYEE").map((r) => `${r.code}:${r.srNo}`),
    ["CPD-06:1", "CPD-17:2", "CPD-17:3", "CPD-17:4", "CPD-25:5",
     "OGE-05:7", "OGE-05:8"]);
  check("7. group ordering is unchanged and numeric-aware",
    [...new Set(reported.map((r) => r.code))],
    ["CPD-06", "CPD-17", "CPD-25", "OGE-05"]);
  check("7. amounts are untouched by the numbering",
    reported.map((r) => r.amount),
    [113160, 64264, 67900, 63188, 204308, 400, 73088, 77004]);
  check("numbering covers the flattened, fully sorted array with institute rows blank",
    /return flat\.map\(\(row\) => \(\{ \.\.\.row, srNo: srNo\+\+ \}\)\);/.test(routeSrc), true);
  check("the blank is real, not hidden by CSS",
    /display:\s*none[\s\S]{0,80}bc-c-sr/.test(
      fs.readFileSync(path.join(FRONT, "pages", "bankCopy.css"), "utf8")), false);

  /* ---------------- Two-level ordering: section, then institute number ---------------- */
  section("Section order first, institute number second");

  /*
     Section Master order is BD(1), DD(2), OGE(3), CPD(4). The SectionIds are
     deliberately NOT in that order (7, 3, 9, 1) and the codes are not in
     alphabetical order either, so only the real SrNo can produce the
     expected result — neither SectionId nor the code text can fake it.
  */
  const SEC = {
    BD: { id: 7, sr: 1, name: "BD" },
    DD: { id: 3, sr: 2, name: "DD" },
    OGE: { id: 9, sr: 3, name: "OGE" },
    CPD: { id: 1, sr: 4, name: "CPD" },
  };
  const secRow = (sec, code, employeeId, over = {}) =>
    row({
      InstituteCode: code,
      InstituteName: `${code} Inst`,
      InstituteBankAccount: `B${code}`,
      SectionId: SEC[sec].id,
      SectionSrNo: SEC[sec].sr,
      SectionName: SEC[sec].name,
      EmployeeId: employeeId,
      EmployeeName: `Emp${employeeId}`,
      EmployeeBankAccount: `A${employeeId}`,
      NetSalary: 1000 * employeeId,
      ProfessionalTax: 100,
      IncomeTax: 0,
      ...over,
    });

  /* Shuffled on purpose. */
  const multi = buildBankCopyRows([
    secRow("CPD", "CPD-100", 1),
    secRow("OGE", "OGE-05", 2),
    secRow("CPD", "CPD-17", 3),
    secRow("BD", "BD-02", 4),
    secRow("DD", "DD-11", 5),
    secRow("CPD", "CPD-06", 6),
    secRow("BD", "BD-01", 7, { DisplayOrder: 2 }),
    secRow("BD", "BD-01", 8, { DisplayOrder: 1 }),
    secRow("DD", "DD-01", 9),
    secRow("CPD", "CPD-25", 10),
  ]);
  const instituteOrder = [...new Set(multi.map((r) => r.code))];

  check("2. sections come out in Section Master order: BD, DD, OGE, CPD",
    [...new Set(multi.map((r) => r.sectionName || SEC_OF(r.code)))].filter(Boolean),
    ["BD", "DD", "OGE", "CPD"]);
  check("2. the full institute order",
    instituteOrder,
    ["BD-01", "BD-02", "DD-01", "DD-11", "OGE-05",
     "CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
  check("2. section order is NOT alphabetical by code",
    instituteOrder[0].startsWith("BD") && instituteOrder[5].startsWith("CPD"), true);
  check("2. and NOT SectionId order (ids were 7, 3, 9, 1)",
    instituteOrder[0], "BD-01");
  check("3. numeric ordering inside DD", 
    instituteOrder.filter((c) => c.startsWith("DD")), ["DD-01", "DD-11"]);
  check("3. numeric ordering inside BD",
    instituteOrder.filter((c) => c.startsWith("BD")), ["BD-01", "BD-02"]);
  check("4. CPD-06 < CPD-17 < CPD-25 < CPD-100",
    instituteOrder.filter((c) => c.startsWith("CPD")),
    ["CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
  check("9. lexical order cannot move CPD-100 before CPD-17",
    instituteOrder.indexOf("CPD-17") < instituteOrder.indexOf("CPD-100"), true);
  check("9. (a plain string sort would have done exactly that)",
    ["CPD-100", "CPD-17"].sort()[0], "CPD-100");
  check("5. employees stay directly under their own institute",
    multi.filter((r) => r.code === "BD-01").map((r) => r.type),
    ["INSTITUTE", "EMPLOYEE", "EMPLOYEE"]);
  check("5. and keep the bill's DisplayOrder",
    multi.filter((r) => r.code === "BD-01" && r.type === "EMPLOYEE")
      .map((r) => r.name), ["Emp8", "Emp7"]);
  check("6. institute lines are numbered too",
    multi.filter((r) => r.type === "INSTITUTE").every(
      (r) => Number.isInteger(r.srNo) && r.srNo > 0), true);
  check("7. Sr. Nos. are a dense 1..19 over every payment line",
    multi.map((r) => r.srNo),
    multi.map((_, i) => i + 1));
  check("7. 10 employees and 9 institute lines make 19 rows total",
    [multi.filter((r) => r.type === "EMPLOYEE").length, multi.length], [10, 19]);
  check("8. the exported TOTAL still carries a blank Sr. No.",
    /srNo: "",\s*\n\s*code: "",\s*\n\s*name: "TOTAL"/.test(pageSrc), true);
  check("10. section rank comes from the Section Master SrNo column",
    /sectionSrNo: row\.SectionSrNo/.test(routeSrc), true);
  check("10. joined from dbo.Sections, not parsed from the code",
    /LEFT JOIN dbo\.Sections sec\s*\n\s*ON sec\.SectionId = i\.SectionId/.test(routeSrc), true);
  check("10. no section is inferred from an institute-code prefix",
    /startsWith\(\s*["'](BD|DD|OGE|CPD|MR)/.test(routeSrc), false);
  check("10. an institute with no section sorts last, never first",
    buildBankCopyRows([
      secRow("CPD", "CPD-06", 21),
      row({ InstituteCode: "ZZ-01", InstituteName: "No Section", EmployeeId: 22,
            EmployeeName: "Orphan", NetSalary: 500, ProfessionalTax: 10,
            SectionId: null, SectionSrNo: null }),
    ]).map((r) => r.code).filter((c, i, a) => a.indexOf(c) === i),
    ["CPD-06", "ZZ-01"]);

  /* ---------------- E: the authoritative order can invert the alphabet ---------------- */
  section("E — an inverted Section Master order beats the alphabet");

  /*
     Here the master says DD is section 1 and BD is section 2. Alphabetical
     ordering would put BD first, so this fixture can only come out right if
     the real SrNo is what drives the sort.
  */
  const invRow = (code, srNo, sectionId, employeeId, over = {}) =>
    row({
      InstituteCode: code,
      InstituteName: `${code} Inst`,
      InstituteBankAccount: `B${code}`,
      SectionId: sectionId,
      SectionSrNo: srNo,
      SectionName: code.split("-")[0],
      EmployeeId: employeeId,
      EmployeeName: `Emp${employeeId}`,
      EmployeeBankAccount: `A${employeeId}`,
      NetSalary: 1000 * employeeId,
      ProfessionalTax: 50,
      IncomeTax: 50,
      ...over,
    });

  const inverted = buildBankCopyRows([
    invRow("BD-01", 2, 10, 1),
    invRow("DD-11", 1, 20, 2),
    invRow("BD-02", 2, 10, 3),
    invRow("DD-01", 1, 20, 4),
  ]);
  const invertedOrder = [...new Set(inverted.map((r) => r.code))];

  check("E. DD (SrNo 1) comes before BD (SrNo 2)",
    invertedOrder, ["DD-01", "DD-11", "BD-01", "BD-02"]);
  check("E. this is NOT what alphabetical ordering gives",
    invertedOrder.join() !== ["BD-01", "BD-02", "DD-01", "DD-11"].join(), true);
  check("E. natural institute ordering still applies inside each section",
    [invertedOrder.slice(0, 2), invertedOrder.slice(2)],
    [["DD-01", "DD-11"], ["BD-01", "BD-02"]]);
  check("E. numbering runs densely over every payment line",
    inverted.map((r) => r.srNo), inverted.map((_, i) => i + 1));
  check("E. each institute line is numbered too",
    inverted.filter((r) => r.type === "INSTITUTE").every(
      (r) => Number.isInteger(r.srNo) && r.srNo > 0), true);

  /* ---------------- H, J: amounts and export parity ---------------- */
  section("H, J — sorting changes no amount, and exports match the screen");

  check("H. every amount survives the sort untouched",
    inverted.map((r) => r.amount),
    [100, 4000, 100, 2000, 100, 1000, 100, 3000]);
  check("H. the institute totals are still PT+IT, not a net",
    inverted.filter((r) => r.type === "INSTITUTE").map((r) => r.amount),
    [100, 100, 100, 100]);

  /*
     Mirrors the page's exportRows memo: the SAME array, mapped in place with
     the amount formatted, then one TOTAL line appended. Order and Sr. No.
     therefore cannot differ between screen and CSV / Excel / PDF / Copy.
  */
  const exported = [
    ...inverted.map((r) => ({ ...r, amount: String(r.amount) })),
    { srNo: "", code: "", name: "TOTAL", bankAccount: "",
      amount: String(inverted.reduce((sum, r) => sum + Number(r.amount), 0)) },
  ];

  check("J. export rows are in the same order as the screen",
    exported.slice(0, -1).map((r) => r.code), inverted.map((r) => r.code));
  check("J. with identical Sr. No. values",
    exported.slice(0, -1).map((r) => r.srNo), inverted.map((r) => r.srNo));
  check("J. institute lines keep their Sr. No. in the export too",
    exported.filter((r) => r.name.endsWith("Inst")).every(
      (r) => Number.isInteger(r.srNo) && r.srNo > 0), true);
  check("J. the TOTAL line is last and unnumbered",
    [exported[exported.length - 1].name, exported[exported.length - 1].srNo],
    ["TOTAL", ""]);
  check("J. the page maps exports from the very same rows array",
    /const mapped = rows\.map\(\(row\) => \(\{\s*\n\s*\.\.\.row,/.test(pageSrc), true);
  check("J. the page never re-sorts or re-numbers for export",
    /exportRows[\s\S]{0,600}\.sort\(|exportRows[\s\S]{0,600}srNo: idx/.test(pageSrc), false);
  check("I. TOTAL equals the sum of the displayed amounts",
    Number(exported[exported.length - 1].amount),
    inverted.reduce((sum, r) => sum + Number(r.amount), 0));

  /* ---------------- I ---------------- */
  section("I — TOTAL equals the displayed amounts");

  check("I. total = 900+30000+40000 + 200+10000 + 300+50000 + 20000", total, 151400);
  check("I. it is the sum of the printed rows, not a second query",
    /rows\.reduce\(\(sum, row\) => sum \+ toNum\(row\.amount\)/.test(routeSrc), true);
  check("I. the screen foot prints that same total",
    /money\(report\.total\)/.test(pageSrc), true);
  check("I. TOTAL is printed under EMPLOYEE NAME",
    /<td className="bc-c-name">TOTAL<\/td>/.test(pageSrc), true);
  check("I. the TOTAL row carries no Sr. No.",
    /srNo: "",\s*\n\s*code: "",\s*\n\s*name: "TOTAL"/.test(pageSrc), true);
  check("I. the .xlsx TOTAL is in the name column too",
    /if \(column\.key === "name"\) totalsRow\.push\("TOTAL"\)/.test(routeSrc), true);
  check("I. the total counts institute lines as well as employees",
    total, 900 + 200 + 300 + 30000 + 40000 + 10000 + 50000 + 20000);
  check("I. exports append the total after the rows",
    /\.\.\.mapped,\s*\{[\s\S]{0,120}name: "TOTAL"/.test(pageSrc), true);
  check("I. the .xlsx totals row is written after the body",
    /\.\.\.body,\s*\.\.\.\(totalsRow\.length \? \[totalsRow\] : \[\]\)/.test(routeSrc), true);

  /* ---------------- J ---------------- */
  section("J — Bill Month vs Salary Month");

  const mixed = [
    row({ InstituteCode: "OGE-05", EmployeeId: 11, EmployeeName: "Jun emp", NetSalary: 1000 }),
    row({ ...BM_MAY, InstituteCode: "OGE-05", EmployeeId: 12, EmployeeName: "May emp", NetSalary: 2000 }),
  ];
  const june = filterBankCopyRows(mixed, { month: 6, year: 2026 });
  const may = filterBankCopyRows(mixed, { month: 5, year: 2026 });
  check("J. June returns BOTH bills of salary month June",
    june.map((r) => r.EmployeeName), ["Jun emp", "May emp"]);
  check("J. including the one whose Bill Month is May",
    june.map((r) => r.BillCode).sort(), ["JUN-2026", "JUN-2026-BM-MAY"]);
  check("J. May returns neither of them (their salary month is June)",
    may.map((r) => r.BillCode), []);
  check("J. both bills share SalaryMonth June",
    mixed.map((r) => r.SalaryMonth), ["June", "June"]);
  check("J. the period filter resolves the SALARY month",
    /salaryParts = salaryMonthPartsOf\(/.test(routeSrc), true);
  check("J. it reuses the register's resolver rather than a copy",
    /salaryMonthPartsOf,\s*\n\} = require\("\.\/chequeRegister"\)/.test(routeSrc), true);
  check("J. month handling is the shared utility, not a copy",
    /require\("\.\.\/utils\/salaryMonthKey"\)/.test(routeSrc), true);

  /* ---------------- K ---------------- */
  section("K — workflow and authorization rules are enforced");

  const statuses = [
    row({ InstituteCode: "BD-01", EmployeeId: 21, EmployeeName: "Approved", NetSalary: 100, WorkflowStatus: "APPROVED" }),
    row({ InstituteCode: "BD-01", EmployeeId: 22, EmployeeName: "Locked", NetSalary: 100, WorkflowStatus: "LOCKED" }),
    row({ InstituteCode: "BD-01", EmployeeId: 23, EmployeeName: "Draft", NetSalary: 100, WorkflowStatus: "DRAFT" }),
    row({ InstituteCode: "BD-01", EmployeeId: 24, EmployeeName: "Submitted", NetSalary: 100, WorkflowStatus: "SUBMITTED" }),
    row({ InstituteCode: "BD-01", EmployeeId: 25, EmployeeName: "Returned", NetSalary: 100, WorkflowStatus: "RETURNED" }),
    row({ InstituteCode: "BD-01", EmployeeId: 26, EmployeeName: "Verified", NetSalary: 100, WorkflowStatus: "VERIFIED" }),
  ];
  check("K. only APPROVED and LOCKED are paid",
    filterBankCopyRows(statuses, { month: 6, year: 2026 }).map((r) => r.EmployeeName),
    ["Approved", "Locked"]);
  check("K. it reuses the register's status set",
    /APPROVED_WORKFLOW_STATUSES/.test(routeSrc), true);
  check("K. the SQL also filters on those statuses",
    /IN \(N'APPROVED', N'LOCKED'\)/.test(routeSrc), true);
  /*
     Scoped by the two-payment-type change: DA Difference is excluded from the
     REGULAR payment file, not from the report as a whole. The SQL exclusion
     below is what keeps the regular file free of DA rows; the DA file is a
     separate query path, asserted in section M.
  */
  check("K. DA Difference bills are excluded from the REGULAR payment type",
    /<> N'DA DIFFERENCE'/.test(routeSrc) &&
      /<> N'DIFFERENCE'/.test(routeSrc), true);
  check("K. archived bills are excluded",
    /ISNULL\(b\.IsArchived, 0\) = 0/.test(routeSrc), true);
  check("K. the API is authenticated and permission-gated",
    /\/api\/bank-copy",\s*\.\.\.authed,\s*requirePermissionPrefix\(/.test(serverSrc), true);
  check("K. section filtering uses SectionId",
    filterBankCopyRows(
      [row({ InstituteCode: "BD-01", EmployeeId: 31, NetSalary: 1, SectionId: 2 }),
       row({ InstituteCode: "OGE-01", EmployeeId: 32, NetSalary: 1, SectionId: 1 })],
      { month: 6, year: 2026, sectionId: 1 }
    ).map((r) => r.InstituteCode), ["OGE-01"]);

  /* ---------------- L ---------------- */
  section("L — no existing calculation was touched");

  check("L. the route writes nothing to the database",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeSrc), false);
  check("L. no TA master lookup", /TransportAllowanceMaster/.test(routeSrc), false);
  check("L. no DA master lookup", /DAMaster/.test(routeSrc), false);
  check("L. no NPS or deduction recomputation",
    /calculateNps|CEILING/.test(routeSrc), false);
  check("L. amounts are only read and summed",
    /round2\(row\.NetSalary\)/.test(routeSrc), true);
  check("L. the shared grid toolbar was not modified for this report",
    /hiddenActions=\{\["excel", "print"\]\}/.test(pageSrc), true);

  /* ---------------- M ---------------- */
  section("M — two separate payment files (Regular / DA Difference)");

  /* 1. default */
  check("1. no paymentType means REGULAR", parsePaymentType({}), "REGULAR");
  check("1. an empty value means REGULAR",
    parsePaymentType({ paymentType: "" }), "REGULAR");
  check("1. an unknown value normalises to REGULAR, never throws",
    parsePaymentType({ paymentType: "SOMETHING_ELSE" }), "REGULAR");
  check("1. the two supported values",
    [PAYMENT_REGULAR, PAYMENT_DA_DIFFERENCE], ["REGULAR", "DA_DIFFERENCE"]);
  check("1. DA is accepted case- and separator-insensitively",
    [parsePaymentType({ paymentType: "da_difference" }),
     parsePaymentType({ paymentType: "DA DIFFERENCE" }),
     parsePaymentType({ paymentType: "da-difference" })],
    ["DA_DIFFERENCE", "DA_DIFFERENCE", "DA_DIFFERENCE"]);
  check("1. the constants are the shared ones, not new strings",
    /CATEGORY_REGULAR,\s*\n\s*CATEGORY_DA_DIFFERENCE/.test(routeSrc), true);

  /* 2-3. REGULAR scope */
  check("2. REGULAR excludes DA Difference in SQL, by category and by type",
    /<> N'DIFFERENCE'/.test(routeSrc) && /<> N'DA DIFFERENCE'/.test(routeSrc), true);
  check("3. REGULAR still includes an Old Salary bill (bill month != salary month)",
    buildBankCopyRows(
      filterBankCopyRows(
        [row({ ...BM_MAY, InstituteCode: "CPD-06", EmployeeId: 60,
               EmployeeName: "Old Bill", NetSalary: 7000 })],
        { month: 6, year: 2026 }
      )
    ).filter((r) => r.type === "EMPLOYEE").map((r) => r.amount), [7000]);
  check("3. and a plain Regular bill",
    buildBankCopyRows(
      filterBankCopyRows(
        [row({ InstituteCode: "CPD-06", EmployeeId: 61, NetSalary: 8000 })],
        { month: 6, year: 2026 }
      )
    ).filter((r) => r.type === "EMPLOYEE").map((r) => r.amount), [8000]);

  /* 4-5. DA scope */
  const daRows = buildDaBankCopyRows(filterDaBankCopyRows(DA_ROWS, { month: 6, year: 2026 }));
  check("4. the DA file is built only from DA rows", daRows.length, 5);
  check("4. every DA line is an employee payment",
    daRows.every((r) => r.type === "EMPLOYEE"), true);
  {
    /* Comments are stripped: the builder's docblock legitimately says the
       word "NetSalary" while explaining that it never reads one. */
    const daBuilderCode = routeSrc
      .slice(
        routeSrc.indexOf("function buildDaBankCopyRows"),
        routeSrc.indexOf("async function buildBankCopyReport")
      )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    check("5. the DA builder never reads a salary NetSalary",
      /NetSalary/.test(daBuilderCode), false);
    check("5. nor any regular deduction field",
      /ProfessionalTax|IncomeTax|GrossSalary|ChequeAmount/.test(daBuilderCode), false);
    check("5. it reads only the stored net difference",
      /row\.net/.test(daBuilderCode), true);
  }
  check("5. the DA path uses the shared DA loader, not the salary query",
    /loadDaDifferenceRows\(\)/.test(routeSrc), true);

  /* 6-7. eligibility */
  check("6. DA accepts APPROVED and LOCKED only",
    filterDaBankCopyRows(
      [daRow({ instituteCode: "CPD-06", employeeId: 70, net: 1, workflowStatus: "APPROVED" }),
       daRow({ instituteCode: "CPD-06", employeeId: 71, net: 1, workflowStatus: "LOCKED" }),
       daRow({ instituteCode: "CPD-06", employeeId: 72, net: 1, workflowStatus: "PENDING" }),
       daRow({ instituteCode: "CPD-06", employeeId: 73, net: 1, workflowStatus: "RETURNED" }),
       daRow({ instituteCode: "CPD-06", employeeId: 74, net: 1, workflowStatus: "REJECTED" })],
      { month: 6, year: 2026 }
    ).map((r) => r.employeeId), [70, 71]);
  check("6. it reuses the register's status set, not a copy",
    /APPROVED_WORKFLOW_STATUSES\.has\(\s*\n?\s*String\(row\.workflowStatus/.test(routeSrc) ||
      /APPROVED_WORKFLOW_STATUSES\.has\(row\.workflowStatus\)/.test(routeSrc), true);
  check("7. archived DA bills are excluded by the shared loader's own SQL",
    /WHERE ISNULL\(c\.IsArchived, 0\) = 0/.test(loaderSrc), true);
  check("7. the DA path adds no archived rows of its own",
    /IsArchived/.test(routeSrc.slice(routeSrc.indexOf("async function loadApprovedDaRows"))), false);

  /* 8. the payment amount */
  check("8. the DA amount is the stored net difference, not the gross",
    daRows.map((r) => r.amount), [2700, 3600, 900, 4500, 1800]);
  check("8. the gross TotalDifferenceAmount is never paid",
    daRows.some((r) => [5000, 4000, 3000, 2000, 1000].includes(r.amount)), false);
  check("8. the builder reads row.net (TotalNetDifferenceAmount)",
    /amount: round2\(row\.net\)/.test(routeSrc), true);
  check("8. the loader maps net from TotalNetDifferenceAmount",
    /net: round2\(row\.TotalNetDifferenceAmount\)/.test(loaderSrc), true);
  check("8. no fabricated zero stands in for a missing DA amount",
    /differenceAmount \|\| 0|net \|\| 0/.test(routeSrc), false);

  /* 9. bank account */
  check("9. every DA line carries the employee's own bank account",
    daRows.map((r) => r.bankAccount), ["9003", "9002", "9005", "9001", "9004"]);
  check("9. the account is the existing EmployeeMaster column, additively selected",
    /em\.BankAccountNumber\s+AS EmployeeBankAccount/.test(loaderSrc), true);
  check("9. no new column was invented in the loader",
    /ALTER TABLE|ADD [A-Za-z]+ DECIMAL|CREATE TABLE/.test(loaderSrc), false);

  /* 10. no institute rows */
  check("10. the DA file emits no INSTITUTE row",
    daRows.filter((r) => r.type === "INSTITUTE").length, 0);
  check("10. no PT or IT is read anywhere in the DA path",
    /ProfessionalTax|IncomeTax/.test(
      routeSrc.slice(routeSrc.indexOf("function buildDaBankCopyRows"))
    ), false);
  check("10. and no zero-tax placeholder line is created",
    /taxTotal/.test(routeSrc.slice(routeSrc.indexOf("function buildDaBankCopyRows"))), false);

  /* 11. the same employee in both files */
  {
    const inRegular = buildBankCopyRows(
      filterBankCopyRows(
        [row({ InstituteCode: "CPD-06", EmployeeId: 500, EmployeeName: "Shared",
               EmployeeBankAccount: "9500", NetSalary: 25000 })],
        { month: 6, year: 2026 }
      )
    ).filter((r) => r.type === "EMPLOYEE");
    const inDa = buildDaBankCopyRows(
      filterDaBankCopyRows(
        [daRow({ instituteCode: "CPD-06", employeeId: 500, employeeName: "Shared",
                 bankAccount: "9500", differenceAmount: 3300, nps: 300, net: 3000 })],
        { month: 6, year: 2026 }
      )
    );
    check("11. the employee is paid once in the regular file",
      inRegular.map((r) => r.amount), [25000]);
    check("11. and once, separately, in the DA file", inDa.map((r) => r.amount), [3000]);
    check("11. the two amounts are never combined",
      inRegular[0].amount + inDa[0].amount !== inRegular[0].amount &&
        inRegular[0].amount !== inDa[0].amount, true);
    check("11. neither file contains the other's amount",
      [inRegular[0].amount === 3000, inDa[0].amount === 25000], [false, false]);
  }

  /* 12. columns */
  check("12. still exactly five columns", XLSX_COLUMNS.length, 5);
  check("12. with the unchanged labels",
    XLSX_COLUMNS.map((c) => c.label),
    ["Sr. No.", "CODE", "EMPLOYEE NAME", "BANK ACCOUNT NUMBER", "AMOUNT"]);
  check("12. a DA row exposes exactly those five keys",
    XLSX_COLUMNS.every((c) => Object.prototype.hasOwnProperty.call(daRows[0], c.key)), true);
  check("12. the DA heading names the file",
    DA_HEADING[0], "DA DIFFERENCE BANK COPY");
  check("12. the regular heading is unchanged", HEADING[0], "BANK COPY");
  check("12. only the title line differs between the two headings",
    DA_HEADING.slice(1), HEADING.slice(1));

  /* 13. numbering */
  check("13. DA Sr. Nos. are a dense 1..n over employee rows",
    daRows.map((r) => r.srNo), [1, 2, 3, 4, 5]);
  check("13. numbering happens after ordering, in one place",
    /let empNo = 1;[\s\S]{0,220}srNo: empNo\+\+/.test(routeSrc), true);

  /* 14. ordering */
  check("14. DA institutes keep the natural code order",
    [...new Set(daRows.map((r) => r.code))],
    ["CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
  check("14. CPD-100 is last, not second (lexical order would differ)",
    daRows[daRows.length - 1].code, "CPD-100");
  check("14. employees keep the bill's DisplayOrder inside an institute",
    daRows.filter((r) => r.code === "CPD-06").map((r) => r.name), ["Alpha", "Bravo"]);
  check("14. the DA path reuses the same comparator, not a copy",
    /const ordered = \[\.\.\.byInstitute\.values\(\)\]\.sort\(compareInstituteGroups\);/
      .test(routeSrc.slice(routeSrc.indexOf("function buildDaBankCopyRows"))), true);

  /* 15. period */
  check("15. DA is filtered by SALARY MONTH, like the regular file",
    filterDaBankCopyRows(DA_ROWS, { month: 5, year: 2026 }).length, 0);
  check("15. the selected month returns them all",
    filterDaBankCopyRows(DA_ROWS, { month: 6, year: 2026 }).length, 5);
  check("15. it reuses the shared month utilities",
    /matchesFilterMonthYear\(parts, month, year\)/.test(routeSrc), true);
  check("15. the regular period logic is untouched",
    /const salaryParts = salaryMonthPartsOf\(/.test(routeSrc), true);
  check("15. the stale BILL MONTH comment is corrected",
    /The month filter is the SALARY MONTH/.test(routeSrc), true);
  check("15. and no BILL MONTH claim remains in that docblock",
    /The month filter is the BILL MONTH/.test(routeSrc), false);

  /* 16. screen and export agree */
  check("16. the export reuses the same report builder",
    /const data = await buildBankCopyReport\(req\.query \|\| \{\}\);/.test(routeSrc), true);
  check("16. paymentType is parsed once, inside that builder",
    (routeSrc.match(/parsePaymentType\(query\)/g) || []).length, 1);
  check("16. the api helper threads paymentType for both calls",
    /params\.set\("paymentType"/.test(apiSrc), true);
  check("16. through the one shared param builder",
    (apiSrc.match(/buildFilterParams\(filters\)/g) || []).length, 2);
  check("16. the page sends it with every request",
    /paymentType,\n\s*\};/.test(pageSrc), true);
  check("16. the page offers exactly the two payment types",
    /Regular Salary Bank Copy/.test(pageSrc) && /DA Difference Bank Copy/.test(pageSrc), true);
  check("16. defaulting to Regular",
    /useState\("REGULAR"\)/.test(pageSrc), true);
  check("16. reusing the existing field class, not a redesign",
    (pageSrc.match(/className="bc-field"/g) || []).length, 4);

  /* 17. the regular file is untouched */
  check("17. regular rows are still the stored Net Salary",
    /amount: round2\(row\.NetSalary\)/.test(routeSrc), true);
  check("17. the regular institute line is still PT + IT",
    /group\.taxTotal \+ toNum\(row\.ProfessionalTax\) \+ toNum\(row\.IncomeTax\)/.test(routeSrc), true);
  check("17. regular rows, order and amounts are unchanged (only the serial rule changed)",
    buildBankCopyRows(ROWS).map((r) => [r.type, r.code, r.srNo, r.amount]),
    [["INSTITUTE", "CPD-06", 1, 900], ["EMPLOYEE", "CPD-06", 2, 30000],
     ["EMPLOYEE", "CPD-06", 3, 40000], ["INSTITUTE", "CPD-17", 4, 200],
     ["EMPLOYEE", "CPD-17", 5, 10000], ["INSTITUTE", "CPD-25", 6, 300],
     ["EMPLOYEE", "CPD-25", 7, 50000], ["EMPLOYEE", "CPD-100", 8, 20000]]);
  check("17. and its total is unchanged",
    buildBankCopyRows(ROWS).reduce((s, r) => s + Number(r.amount), 0), 151400);
  check("17. the route still writes nothing to the database",
    /INSERT INTO|UPDATE dbo\.|DELETE FROM/.test(routeSrc), false);
  check("17. no calculation helper was introduced",
    /calculateNps|CEILING|Math\.ceil/.test(routeSrc), false);

  /* ---------------- N ---------------- */
  section("N — a zero or negative DA payable is not a payment instruction");

  /* 1-2. zero and negative are dropped */
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 801, employeeName: "Zero Payable",
              bankAccount: "9801", differenceAmount: 5000, nps: 500, net: 0 }),
      daRow({ instituteCode: "CPD-06", employeeId: 802, employeeName: "Negative",
              bankAccount: "9802", differenceAmount: 0, nps: 100, net: -100,
              displayOrder: 2 }),
      daRow({ instituteCode: "CPD-06", employeeId: 803, employeeName: "Payable",
              bankAccount: "9803", differenceAmount: 3300, nps: 300, net: 3000,
              displayOrder: 3 }),
    ], { month: 6, year: 2026 }));
    check("1. a zero-payable employee is excluded",
      out.some((r) => r.employeeId === 801), false);
    check("2. a negative-payable employee is excluded",
      out.some((r) => r.employeeId === 802), false);
    check("1-2. only the payable employee remains",
      out.map((r) => [r.name, r.amount]), [["Payable", 3000]]);
    check("1. a zero row is dropped, never shown as 0.00",
      out.some((r) => Number(r.amount) === 0), false);
  }

  /* 3. two bills aggregating above zero stay, at the summed amount */
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 810, employeeName: "Two Bills",
              bankAccount: "9810", billCode: "DA-A", net: 0, displayOrder: 1 }),
      daRow({ instituteCode: "CPD-06", employeeId: 810, employeeName: "Two Bills",
              bankAccount: "9810", billCode: "DA-B", net: 4200, displayOrder: 1 }),
    ], { month: 6, year: 2026 }));
    check("3. the employee is still shown", out.length, 1);
    check("3. at the aggregated amount, not the zero component",
      out[0].amount, 4200);
    check("3. as a single credit, never two lines",
      out.filter((r) => r.employeeId === 810).length, 1);
  }
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 811, employeeName: "Offset Up",
              bankAccount: "9811", billCode: "DA-A", net: 5000 }),
      daRow({ instituteCode: "CPD-06", employeeId: 811, employeeName: "Offset Up",
              bankAccount: "9811", billCode: "DA-B", net: -1500 }),
    ], { month: 6, year: 2026 }));
    check("3. a negative correction reduces but does not remove a positive total",
      out.map((r) => r.amount), [3500]);
  }

  /* 4. two bills cancelling exactly */
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 820, employeeName: "Cancels",
              bankAccount: "9820", billCode: "DA-A", net: 2500 }),
      daRow({ instituteCode: "CPD-06", employeeId: 820, employeeName: "Cancels",
              bankAccount: "9820", billCode: "DA-B", net: -2500 }),
    ], { month: 6, year: 2026 }));
    check("4. an employee whose bills cancel to zero is excluded", out.length, 0);
    check("4. the positive component alone is never paid",
      out.some((r) => r.amount === 2500), false);
  }
  check("4. filtering happens after aggregation, not before",
    /const payable = flat\.filter/.test(routeSrc2()) &&
      routeSrc2().indexOf("const payable = flat.filter") >
        routeSrc2().indexOf("existing.amount = round2(existing.amount + toNum(row.net))"),
    true);

  /* 5. dense numbering */
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 830, bankAccount: "1", net: 100, displayOrder: 1 }),
      daRow({ instituteCode: "CPD-06", employeeId: 831, bankAccount: "2", net: 0, displayOrder: 2 }),
      daRow({ instituteCode: "CPD-06", employeeId: 832, bankAccount: "3", net: 200, displayOrder: 3 }),
      daRow({ instituteCode: "CPD-17", employeeId: 833, bankAccount: "4", net: -5, displayOrder: 1 }),
      daRow({ instituteCode: "CPD-17", employeeId: 834, bankAccount: "5", net: 300, displayOrder: 2 }),
    ], { month: 6, year: 2026 }));
    check("5. Sr. Nos. are dense with no gap where rows were removed",
      out.map((r) => r.srNo), [1, 2, 3]);
    check("5. and belong to the surviving employees",
      out.map((r) => r.employeeId), [830, 832, 834]);
    check("5. numbering happens after the filter",
      routeSrc2().indexOf("const payable = flat.filter") <
        routeSrc2().indexOf("let empNo = 1;\n  return payable"), true);

    /* 6. TOTAL excludes the dropped employees */
    check("6. the total counts only displayed employees",
      out.reduce((sum, r) => sum + Number(r.amount), 0), 600);
    check("6. the dropped negative did not reduce it",
      out.reduce((sum, r) => sum + Number(r.amount), 0) !== 595, true);
  }

  /* 7. an all-zero month */
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 840, bankAccount: "1", net: 0 }),
      daRow({ instituteCode: "CPD-17", employeeId: 841, bankAccount: "2", net: 0 }),
    ], { month: 6, year: 2026 }));
    check("7. an all-zero DA month produces no employee rows", out.length, 0);
    check("7. which the screen renders as its existing no-data state",
      /report && rows\.length > 0 \?/.test(pageSrc), true);
    check("7. no zero-amount placeholder line is emitted",
      out.some((r) => Number(r.amount) === 0), false);
  }

  /* 8-9. the source fields are unchanged by this fix */
  check("8. the DA amount is still the stored net difference",
    /amount: round2\(row\.net\)/.test(routeSrc2()), true);
  check("8. the loader still maps net from TotalNetDifferenceAmount",
    /net: round2\(row\.TotalNetDifferenceAmount\)/.test(loaderSrc), true);
  check("8. TotalDifferenceAmount is still not the payment amount",
    /amount: round2\(row\.differenceAmount\)/.test(routeSrc2()), false);
  check("9. the employee bank account is still EmployeeMaster's",
    /em\.BankAccountNumber\s+AS EmployeeBankAccount/.test(loaderSrc), true);
  check("9. and every surviving DA line carries it",
    buildDaBankCopyRows(filterDaBankCopyRows(DA_ROWS, { month: 6, year: 2026 }))
      .every((r) => r.bankAccount !== ""), true);

  /* 10-11. the regular file is untouched by this fix */
  check("10. regular rows, order and amounts are still unchanged",
    buildBankCopyRows(ROWS).map((r) => [r.type, r.code, r.srNo, r.amount]),
    [["INSTITUTE", "CPD-06", 1, 900], ["EMPLOYEE", "CPD-06", 2, 30000],
     ["EMPLOYEE", "CPD-06", 3, 40000], ["INSTITUTE", "CPD-17", 4, 200],
     ["EMPLOYEE", "CPD-17", 5, 10000], ["INSTITUTE", "CPD-25", 6, 300],
     ["EMPLOYEE", "CPD-25", 7, 50000], ["EMPLOYEE", "CPD-100", 8, 20000]]);
  check("10. and its total is unchanged", buildBankCopyRows(ROWS)
    .reduce((s, r) => s + Number(r.amount), 0), 151400);
  {
    /* 11. the regular copy KEEPS a zero-net employee — deliberately not
       changed by this fix, which applies only to the DA payment file. */
    const out = buildBankCopyRows([
      row({ InstituteCode: "CPD-06", EmployeeId: 850, EmployeeName: "Zero Net",
            EmployeeBankAccount: "9850", NetSalary: 0 }),
    ]);
    check("11. a zero-net regular employee is still shown",
      out.map((r) => [r.type, r.name, r.amount]), [["EMPLOYEE", "Zero Net", 0]]);
    check("11. the payable filter is not applied to the regular builder",
      /const payable = flat\.filter/.test(
        routeSrc2().slice(
          routeSrc2().indexOf("function buildBankCopyRows"),
          routeSrc2().indexOf("function buildDaBankCopyRows")
        )
      ), false);
    check("11. the regular zero-tax institute rule is also unchanged",
      /if \(group\.taxTotal > 0\)/.test(routeSrc2()), true);
  }

  /* 12-17. every earlier DA guarantee still holds after the fix */
  check("12. non-approved DA workflow rows are still excluded",
    filterDaBankCopyRows([
      daRow({ instituteCode: "CPD-06", employeeId: 860, net: 100, workflowStatus: "OPEN" }),
      daRow({ instituteCode: "CPD-06", employeeId: 861, net: 100, workflowStatus: "PENDING" }),
      daRow({ instituteCode: "CPD-06", employeeId: 862, net: 100, workflowStatus: "APPROVED" }),
      daRow({ instituteCode: "CPD-06", employeeId: 863, net: 100, workflowStatus: "LOCKED" }),
    ], { month: 6, year: 2026 }).map((r) => r.employeeId), [862, 863]);
  check("13. archived DA bills are still excluded by the shared loader",
    /WHERE ISNULL\(c\.IsArchived, 0\) = 0/.test(loaderSrc), true);
  check("14. the section filter still applies",
    filterDaBankCopyRows([
      daRow({ instituteCode: "BD-01", employeeId: 870, net: 100, sectionId: 2 }),
      daRow({ instituteCode: "OGE-01", employeeId: 871, net: 100, sectionId: 1 }),
    ], { month: 6, year: 2026, sectionId: 1 }).map((r) => r.employeeId), [871]);
  check("15. the salary-month filter still applies",
    [filterDaBankCopyRows(DA_ROWS, { month: 5, year: 2026 }).length,
     filterDaBankCopyRows(DA_ROWS, { month: 6, year: 2026 }).length], [0, 5]);
  {
    const out = buildDaBankCopyRows(filterDaBankCopyRows(DA_ROWS, { month: 6, year: 2026 }));
    check("16. natural institute ordering is preserved",
      [...new Set(out.map((r) => r.code))],
      ["CPD-06", "CPD-17", "CPD-25", "CPD-100"]);
    check("17. DisplayOrder within an institute is preserved",
      out.filter((r) => r.code === "CPD-06").map((r) => r.name), ["Alpha", "Bravo"]);
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(74));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main();
