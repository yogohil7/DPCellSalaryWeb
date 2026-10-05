/**
 * NPS Schedule Summary — two saved Bill Month instances of MR-29.
 *
 * Salary Month AUG-2026, BillCodeId 1018, institute MR-29:
 *   WorkflowId 62  Bill Month JUL-2026  schedule SCH-JUL-MR29  NPS 100+50
 *   WorkflowId 52  Bill Month AUG-2026  schedule SCH-AUG-MR29  NPS 200
 *
 * Calls the real buildNpsScheduleReport (the GET /api/nps-schedule body)
 * against a stubbed database. No schedule number, count, or amount is
 * invented inside the report; each value comes from the fixture row.
 *
 * Usage: cd backend && npm run test:nps-schedule-mr29
 */
const path = require("path");
const Module = require("module");

const HEADERS = [
  {
    SalaryBillCodeId: 1018,
    InstituteCode: "MR-29",
    BillMonth: "JUL-2026",
    BillNo: "701",
    BillDate: "2026-08-11",
    NPSScheduleNo: "SCH-JUL-MR29",
  },
  {
    SalaryBillCodeId: 1018,
    InstituteCode: "MR-29",
    BillMonth: "AUG-2026",
    BillNo: "849",
    BillDate: "2026-09-03",
    NPSScheduleNo: "SCH-AUG-MR29",
  },
];

function employee(o) {
  return {
    BillCodeId: 1018,
    BillCode: "AUG-2026",
    MasterBillMonth: "August",
    BillMonth: o.billMonth,
    InstanceBillMonth: o.billMonth,
    WorkflowBillMonth: o.billMonth,
    ReportWorkflowId: o.workflowId,
    WorkflowId: o.workflowId,
    SalaryMonth: "August",
    SalaryMonthNumber: "08",
    SalaryYear: "2026",
    BillCategory: "Salary",
    BillType: "Salary",
    InstituteCode: o.code,
    InstituteName: o.name || o.code,
    SectionId: 11,
    SectionSrNo: 1,
    SectionName: "CPD Section",
    WorkflowStatus: "APPROVED",
    BillNo: null,
    BillDate: null,
    NPSScheduleNo: null,
    DetailId: o.detailId,
    EmployeeId: o.emp,
    EmployeeName: o.empName,
    EmployeeCode: String(o.emp),
    GPFNPSNumber: o.pran || "",
    NPS: o.nps,
    BasicPay: 30000,
    GrossSalary: 40000,
    NetSalary: 35000,
  };
}

const EMPLOYEES = [
  employee({
    code: "MR-29", name: "Observation Home", billMonth: "JUL-2026",
    workflowId: 62, detailId: 1, emp: 3021, empName: "Jul Emp A", nps: 100, pran: "P1",
  }),
  employee({
    code: "MR-29", name: "Observation Home", billMonth: "JUL-2026",
    workflowId: 62, detailId: 2, emp: 3022, empName: "Jul Emp B", nps: 50, pran: "P2",
  }),
  employee({
    code: "MR-29", name: "Observation Home", billMonth: "AUG-2026",
    workflowId: 52, detailId: 3, emp: 3023, empName: "Aug Emp", nps: 200, pran: "P3",
  }),
  /* Zero NPS on the July instance must not add a person or an amount. */
  employee({
    code: "MR-29", name: "Observation Home", billMonth: "JUL-2026",
    workflowId: 62, detailId: 4, emp: 3024, empName: "Jul Zero", nps: 0,
  }),
  /* A different institute with one instance must stay one row. */
  employee({
    code: "CPD-06", name: "Probation", billMonth: "AUG-2026",
    workflowId: 70, detailId: 5, emp: 4001, empName: "Only Aug", nps: 9999,
  }),
];

function query(strings) {
  const text = (typeof strings === "string" ? strings : Array.isArray(strings) ? strings.join("?") : String(strings)).replace(/\s+/g, " ");
  if (/MasterDesignationName/.test(text) || /InstanceWorkflowId/.test(text)) {
    return { recordset: EMPLOYEES };
  }
  if (/SalaryEntryBillHeader/i.test(text)) return { recordset: HEADERS };
  if (/COL_LENGTH/i.test(text)) return { recordset: [{ Present: 1 }] };
  if (/DADifference/i.test(text)) return { recordset: [{ Bill: 0, Detail: 0 }] };
  return { recordset: [] };
}

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
const stub = new Module(dbPath, null);
stub.filename = dbPath;
stub.loaded = true;
stub.exports = {
  sql: {
    query: (s, ...v) => Promise.resolve(query(s, v)),
    Request: function R() {
      return { query: (s) => Promise.resolve(query(s)), input() { return this; } };
    },
  },
  connectDB: async () => true,
};
require.cache[dbPath] = stub;

const { buildNpsScheduleReport, XLSX_COLUMNS } = require("../routes/npsSchedule");

let passed = 0;
let failed = 0;
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

function excelRows(rows) {
  return rows.map((row) =>
    XLSX_COLUMNS.map((column) => {
      const value = row[column.key];
      if (column.type === "number") return Number(value || 0);
      return value == null ? "" : String(value);
    })
  );
}

(async () => {
  const report = await buildNpsScheduleReport({
    month: 8,
    year: 2026,
    billType: "REGULAR",
    instituteCode: "MR-29",
  });
  const mr = report.rows.map((r) => ({
    code: r.instituteCode,
    billMonth: r.billMonth,
    billType: r.billType,
    scheduleNo: r.scheduleNo,
    count: r.employeeCount,
    amount: r.amount,
    workflowId: r.workflowId,
  }));
  console.log("API rows for Salary Month AUG-2026 / MR-29:");
  console.log(JSON.stringify(mr, null, 2));

  check("exactly two MR-29 rows", report.rows.length, 2);
  check("Bill Months are JUL-2026 then AUG-2026", mr.map((r) => r.billMonth), ["JUL-2026", "AUG-2026"]);
  check("each instance keeps its own schedule number", mr.map((r) => r.scheduleNo), ["SCH-JUL-MR29", "SCH-AUG-MR29"]);
  check("counts come from that instance's NPS employees", mr.map((r) => r.count), [2, 1]);
  check("amounts come from that instance's stored NPS", mr.map((r) => r.amount), [150, 200]);
  check("Bill Types stay OLD and REGULAR", mr.map((r) => r.billType), ["OLD", "REGULAR"]);
  check("workflow ids stay distinct", mr.map((r) => r.workflowId), [62, 52]);
  check("total equals the two rows", report.totals, { employeeCount: 3, amount: 350 });

  const all = await buildNpsScheduleReport({ month: 8, year: 2026, billType: "REGULAR" });
  const cpd = all.rows.filter((r) => r.instituteCode === "CPD-06");
  check("single-instance CPD-06 is still one row", cpd.map((r) => [r.billMonth, r.amount, r.employeeCount]), [["AUG-2026", 9999, 1]]);
  check("MR-29 is still two rows in the unfiltered report", all.rows.filter((r) => r.instituteCode === "MR-29").length, 2);

  const screen = mr.map((r) => [r.billMonth, r.scheduleNo, r.count, r.amount]);
  const excel = excelRows(report.rows).map((cells) => [cells[3], cells[5], cells[6], cells[7]]);
  check("Excel export rows match the screen rows", excel, screen);

  console.log(`\nPassed: ${passed}    Failed: ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
