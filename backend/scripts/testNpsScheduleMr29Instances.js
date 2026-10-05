/**
 * NPS Schedule Summary — two saved Bill Month instances of MR-29.
 *
 * Salary Month AUG-2026, BillCodeId 1018, institute MR-29. The rows are
 * NOT pre-joined. They are assembled the way loadEmployeeSalaryRows does:
 *   WorkflowId 62  LOCKED  Bill Month JUL-2026
 *                  3 employees in SalaryEntryBillEmployeeDetails, NPS 10+20+30
 *                  Schedule No. only on SalaryEntryBillHeader (SCH-JUL-MR29)
 *   WorkflowId 52  LOCKED  Bill Month AUG-2026
 *                  3 employees in SalaryEmployeeDetails, NPS 100+200+300
 *                  Schedule No. on SalaryEntryBillHeader (SCH-AUG-MR29)
 *
 * The live page showed only AUG-2026 because the report grouped by
 * institute + salary-bill code. That key keeps the first employee row's
 * Bill Month and Schedule No. and folds the other instance into it.
 * REGULAR includes that OLD JUL row; it is not a bill-type exclusion.
 *   WorkflowId 80  Bill Month JUN-2026  header schedule, NPS 0 — no report row
 *   WorkflowId 81  Bill Month MAY-2026  DRAFT, NPS 999 — no report row
 *
 * A single institute+bill-code group would hide JUL behind AUG. This test
 * fails if that happens.
 *
 * Usage: cd backend && npm run test:nps-schedule-mr29
 */
const path = require("path");
const Module = require("module");

const BILLS = [
  {
    BillCodeId: 1018,
    BillCode: "AUG-2026",
    BillMonth: "AUG-2026",
    SalaryMonth: "August",
    SalaryMonthNumber: "08",
    SalaryYear: "2026",
    BillCategory: "Salary",
    BillType: "Salary",
    IsArchived: 0,
  },
];

const INSTITUTES = [
  { InstituteCode: "MR-29", InstituteName: "Observation Home", SectionId: 11, SectionSrNo: 1, SectionName: "CPD Section" },
  { InstituteCode: "CPD-06", InstituteName: "Probation", SectionId: 11, SectionSrNo: 1, SectionName: "CPD Section" },
];

const WORKFLOWS = [
  { WorkflowId: 62, SalaryBillCodeId: 1018, InstituteCode: "MR-29", BillMonth: "JUL-2026", Status: "LOCKED", NPSScheduleNo: null, BillNo: "701", BillDate: "2026-08-11" },
  { WorkflowId: 52, SalaryBillCodeId: 1018, InstituteCode: "MR-29", BillMonth: "AUG-2026", Status: "LOCKED", NPSScheduleNo: "SCH-AUG-WORKFLOW", BillNo: "849", BillDate: "2026-09-03" },
  { WorkflowId: 80, SalaryBillCodeId: 1018, InstituteCode: "MR-29", BillMonth: "JUN-2026", Status: "APPROVED", NPSScheduleNo: "SCH-JUN-MR29", BillNo: "600", BillDate: "2026-07-01" },
  { WorkflowId: 81, SalaryBillCodeId: 1018, InstituteCode: "MR-29", BillMonth: "MAY-2026", Status: "DRAFT", NPSScheduleNo: "SCH-MAY-MR29", BillNo: null, BillDate: null },
  { WorkflowId: 70, SalaryBillCodeId: 1018, InstituteCode: "CPD-06", BillMonth: "AUG-2026", Status: "APPROVED", NPSScheduleNo: null, BillNo: null, BillDate: null },
];

/* Canonical Bill Month (AUG-2026) lives here. JUL must not be read from this table. */
const SALARY_EMPLOYEE_DETAILS = [
  detail({ code: "MR-29", billMonth: null, emp: 5201, name: "A Aug 1", nps: 100 }),
  detail({ code: "MR-29", billMonth: null, emp: 5202, name: "A Aug 2", nps: 200 }),
  detail({ code: "MR-29", billMonth: null, emp: 5203, name: "A Aug 3", nps: 300 }),
  detail({ code: "CPD-06", billMonth: null, emp: 4001, name: "Only Aug", nps: 9999 }),
];

/* Earlier Bill Months live here, keyed by their own BillMonth. */
const SALARY_ENTRY_BILL_EMPLOYEE_DETAILS = [
  detail({ code: "MR-29", billMonth: "JUL-2026", emp: 6201, name: "Z Jul 1", nps: 10 }),
  detail({ code: "MR-29", billMonth: "JUL-2026", emp: 6202, name: "Z Jul 2", nps: 20 }),
  detail({ code: "MR-29", billMonth: "JUL-2026", emp: 6203, name: "Z Jul 3", nps: 30 }),
  detail({ code: "MR-29", billMonth: "JUN-2026", emp: 3025, name: "Jun No Nps", nps: 0 }),
  detail({ code: "MR-29", billMonth: "MAY-2026", emp: 3026, name: "May Draft", nps: 999 }),
];

function detail(o) {
  return {
    Id: o.emp,
    SalaryBillCodeId: 1018,
    InstituteCode: o.code,
    BillMonth: o.billMonth,
    EmployeeId: o.emp,
    EmployeeName: o.name,
    EmployeeCode: String(o.emp),
    GPFNPSNumber: o.pran || "",
    NPS: o.nps,
    BasicPay: 30000,
    GrossSalary: 40000,
    NetSalary: 35000,
  };
}

function canonicalBillMonth(bill) {
  return `${String(bill.SalaryMonth || "").trim().slice(0, 3).toUpperCase()}-${bill.SalaryYear}`;
}

function sameMonth(a, b) {
  return String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
}

/**
 * The recordset loadEmployeeSalaryRows() gets back. This follows
 * instanceEmployeeRowsSql(): canonical / "-BM-" instances read
 * SalaryEmployeeDetails; every earlier Bill Month reads
 * SalaryEntryBillEmployeeDetails for that workflow's own BillMonth.
 * Approved and locked workflows only — the outer query's status filter.
 */
function loadEmployeeRowsFromSourceTables() {
  const rows = [];
  for (const workflow of WORKFLOWS) {
    const status = String(workflow.Status || "").trim().toUpperCase();
    if (status !== "APPROVED" && status !== "LOCKED") continue;
    const bill = BILLS.find((item) => item.BillCodeId === workflow.SalaryBillCodeId);
    if (!bill || bill.IsArchived) continue;
    if (String(bill.BillCategory || "").toUpperCase() === "DIFFERENCE") continue;
    if (String(bill.BillType || "").toUpperCase() === "DA DIFFERENCE") continue;
    const canonical = canonicalBillMonth(bill);
    const variant = /-BM-[A-Z]{3}$/i.test(String(bill.BillCode || "").trim());
    const institute = INSTITUTES.find((item) => item.InstituteCode === workflow.InstituteCode) || {};
    const sources = [];
    if (sameMonth(workflow.BillMonth, canonical) || variant) {
      sources.push(
        ...SALARY_EMPLOYEE_DETAILS.filter(
          (row) =>
            row.SalaryBillCodeId === workflow.SalaryBillCodeId &&
            row.InstituteCode === workflow.InstituteCode
        )
      );
    }
    if (!sameMonth(workflow.BillMonth, canonical) && !variant) {
      sources.push(
        ...SALARY_ENTRY_BILL_EMPLOYEE_DETAILS.filter(
          (row) =>
            row.SalaryBillCodeId === workflow.SalaryBillCodeId &&
            row.InstituteCode === workflow.InstituteCode &&
            sameMonth(row.BillMonth, workflow.BillMonth)
        )
      );
    }
    for (const employee of sources) {
      rows.push({
        BillCodeId: bill.BillCodeId,
        BillCode: bill.BillCode,
        MasterBillMonth: bill.BillMonth,
        BillMonth: variant ? bill.BillMonth : workflow.BillMonth,
        InstanceBillMonth: workflow.BillMonth,
        WorkflowBillMonth: workflow.BillMonth,
        ReportWorkflowId: workflow.WorkflowId,
        WorkflowId: workflow.WorkflowId,
        SalaryMonth: bill.SalaryMonth,
        SalaryMonthNumber: bill.SalaryMonthNumber,
        SalaryYear: bill.SalaryYear,
        BillCategory: bill.BillCategory,
        BillType: bill.BillType,
        InstituteCode: workflow.InstituteCode,
        InstituteName: institute.InstituteName || workflow.InstituteCode,
        SectionId: institute.SectionId,
        SectionSrNo: institute.SectionSrNo,
        SectionName: institute.SectionName,
        WorkflowStatus: status,
        BillNo: workflow.BillNo,
        BillDate: workflow.BillDate,
        NPSScheduleNo: workflow.NPSScheduleNo,
        DetailId: employee.Id,
        EmployeeId: employee.EmployeeId,
        EmployeeName: employee.EmployeeName,
        EmployeeCode: employee.EmployeeCode,
        GPFNPSNumber: employee.GPFNPSNumber,
        NPS: employee.NPS,
        BasicPay: employee.BasicPay,
        GrossSalary: employee.GrossSalary,
        NetSalary: employee.NetSalary,
      });
    }
  }
  return rows;
}

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
  /* A Schedule No. exists, but this instance has no saved NPS amount. */
  {
    SalaryBillCodeId: 1018,
    InstituteCode: "MR-29",
    BillMonth: "JUN-2026",
    BillNo: "600",
    BillDate: "2026-07-01",
    NPSScheduleNo: "SCH-JUN-MR29",
  },
];

function query(strings) {
  const text = (typeof strings === "string" ? strings : Array.isArray(strings) ? strings.join("?") : String(strings)).replace(/\s+/g, " ");
  if (/MasterDesignationName/.test(text) || /InstanceWorkflowId/.test(text)) {
    return { recordset: loadEmployeeRowsFromSourceTables() };
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

const fs = require("fs");
const { buildNpsScheduleReport, XLSX_COLUMNS, scheduleGroupKey, mapSalaryScheduleRow } = require("../routes/npsSchedule");
const { instanceEmployeeRowsSql } = require("../utils/reportBillInstance");

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

  const derivedSql = instanceEmployeeRowsSql().replace(/\s+/g, " ");
  const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "npsSchedule.js"), "utf8");
  check("JUL employees are read from SalaryEntryBillEmployeeDetails",
    /JOIN dbo\.SalaryEntryBillEmployeeDetails ed1 .*ed1\.BillMonth = iw1\.BillMonth/.test(derivedSql),
    true);
  check("AUG employees are read from SalaryEmployeeDetails",
    /JOIN dbo\.SalaryEmployeeDetails ed0 /.test(derivedSql),
    true);
  check("the loader joins each instance by WorkflowId",
    /d\.InstanceWorkflowId = w\.WorkflowId/.test(
      fs.readFileSync(path.join(__dirname, "..", "routes", "employeeWiseSalary.js"), "utf8")
    ),
    true);
  check("grouping is workflow id plus Bill Month, not institute plus bill code",
    /wf:\$\{workflowId\}\|\$\{billMonth\}/.test(routeSrc) &&
      !/const key = `\$\{row\.instituteCode\}\|\$\{row\.billCodeId\}`;/.test(routeSrc),
    true);
  const loaded = loadEmployeeRowsFromSourceTables().filter((row) => row.InstituteCode === "MR-29" && Number(row.NPS) !== 0);
  check("source tables yield 3 JUL rows from SalaryEntryBillEmployeeDetails and 3 AUG rows from SalaryEmployeeDetails",
    loaded.map((row) => [row.WorkflowId, row.BillMonth, row.NPS]).sort((a, b) => a[0] - b[0] || a[2] - b[2]),
    [[52, "AUG-2026", 100], [52, "AUG-2026", 200], [52, "AUG-2026", 300],
     [62, "JUL-2026", 10], [62, "JUL-2026", 20], [62, "JUL-2026", 30]]);
  const byName = loadEmployeeRowsFromSourceTables()
    .filter((row) => row.InstituteCode === "MR-29" && Number(row.NPS) !== 0)
    .sort((a, b) => String(a.EmployeeName).localeCompare(String(b.EmployeeName)))
    .map((row) => mapSalaryScheduleRow(row));
  const collapsed = new Map();
  for (const row of byName) {
    const key = `${row.instituteCode}|${row.billCodeId}`;
    if (!collapsed.has(key)) {
      collapsed.set(key, {
        billMonth: row.paidMonth,
        scheduleNo: row.npsScheduleNo,
        billType: row.type,
        count: 0,
        amount: 0,
      });
    }
    const group = collapsed.get(key);
    group.count += 1;
    group.amount += row.nps;
  }
  check("the old institute+bill key keeps one AUG row and swallows JUL",
    [...collapsed.values()],
    [{ billMonth: "AUG-2026", scheduleNo: "SCH-AUG-WORKFLOW", billType: "REGULAR", count: 6, amount: 660 }]);
  check("the old institute+bill key would collapse both instances",
    new Set(report.rows.map((row) => `${row.instituteCode}|${row.billCodeId}`)).size,
    1);
  check("the current key keeps the two instances apart",
    report.rows.map((row) => scheduleGroupKey({
      paidMonth: row.billMonth,
      workflowId: row.workflowId,
      instituteCode: row.instituteCode,
      billCodeId: row.billCodeId,
    })),
    ["wf:62|JUL-2026", "wf:52|AUG-2026"]);
  check("JUL schedule number comes from its header, not the AUG workflow column",
    mr.find((row) => row.billMonth === "JUL-2026").scheduleNo,
    "SCH-JUL-MR29");
  check("AUG schedule number comes from its own header",
    mr.find((row) => row.billMonth === "AUG-2026").scheduleNo,
    "SCH-AUG-MR29");
  check("MAY-2026 draft is excluded",
    report.rows.some((row) => row.billMonth === "MAY-2026" || row.scheduleNo === "SCH-MAY-MR29"),
    false);

  check("JUN-2026 is absent because it has no saved NPS deduction",
    report.rows.some((r) => r.billMonth === "JUN-2026" || r.scheduleNo === "SCH-JUN-MR29"),
    false);
  check("exactly two MR-29 rows", report.rows.length, 2);
  check("Bill Months are JUL-2026 then AUG-2026", mr.map((r) => r.billMonth), ["JUL-2026", "AUG-2026"]);
  check("each instance keeps its own schedule number", mr.map((r) => r.scheduleNo), ["SCH-JUL-MR29", "SCH-AUG-MR29"]);
  check("counts come from that instance's NPS employees", mr.map((r) => r.count), [3, 3]);
  check("amounts come from that instance's stored NPS", mr.map((r) => r.amount), [60, 600]);
  check("Bill Types stay OLD and REGULAR", mr.map((r) => r.billType), ["OLD", "REGULAR"]);
  check("workflow ids stay distinct", mr.map((r) => r.workflowId), [62, 52]);
  check("total equals the two rows", report.totals, { employeeCount: 6, amount: 660 });
  check("REGULAR still returns the locked JUL instance",
    mr.map((r) => [r.workflowId, r.billType]),
    [[62, "OLD"], [52, "REGULAR"]]);

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
