/**
 * READ-ONLY: run the REAL Salary Entry "Get Data" handler
 * (GET /api/salary-entry/employees in routes/salaryEntry.js) in-process
 * against the live database, for each requested Bill Month, and print
 * exactly what the browser would receive. No HTTP server, no login.
 *
 * GET /employees never writes (it only SELECTs); this script adds nothing.
 *
 * Usage:  cd D:\DPCellSalaryWeb\backend
 *         node scripts/traceSalaryEntryGet.js
 *         node scripts/traceSalaryEntryGet.js DDRS-16 AUG-2026 JUL-26 AUG-26
 */
require("dotenv").config();
const { connectDB, sql } = require("../db");

const INSTITUTE = process.argv[2] || "DDRS-16";
const BILL_CODE = process.argv[3] || "AUG-2026";
const BILL_MONTHS = process.argv.slice(4).length ? process.argv.slice(4) : ["JUL-26", "AUG-26"];
const SALARY_MONTH = "AUG-2026";

async function runGet(router, query) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === "/employees" && l.route.methods.get
  );
  let status = 200;
  let body = null;
  const res = {
    status(c) { status = c; return this; },
    json(p) { body = p; return this; },
  };
  await layer.route.stack[0].handle({ query, body: {}, user: { userName: "trace-script" } }, res);
  return { status, body };
}

async function main() {
  await connectDB();
  const router = require("../routes/salaryEntry");

  console.log("\n=== Bill codes that DISPLAY as", BILL_CODE, "in the Salary Entry dropdown ===");
  const codes = await sql.query`
    SELECT BillCodeId, BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear, Status
    FROM dbo.SalaryBillCodes
    WHERE BillCode = ${BILL_CODE} OR BillCode LIKE ${BILL_CODE + "-BM-%"}
    ORDER BY BillCodeId`;
  console.table(codes.recordset);

  console.log(`=== Workflow rows for those bill codes / ${INSTITUTE} ===`);
  const wf = await sql.query`
    SELECT w.WorkflowId, w.SalaryBillCodeId, b.BillCode, w.BillMonth, w.Status
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE w.InstituteCode = ${INSTITUTE}
      AND (b.BillCode = ${BILL_CODE} OR b.BillCode LIKE ${BILL_CODE + "-BM-%"})
    ORDER BY w.WorkflowId`;
  console.table(wf.recordset);

  const targets = [BILL_CODE, ...codes.recordset.map((r) => r.BillCode).filter((c) => c !== BILL_CODE)];
  for (const code of targets) {
    for (const billMonth of BILL_MONTHS) {
      const { status, body } = await runGet(router, {
        billCode: code, instituteCode: INSTITUTE, billMonth, salaryMonth: SALARY_MONTH,
      });
      const b = body?.bill || {};
      console.log(`\n--- GET /employees billCode=${code} billMonth=${billMonth} -> HTTP ${status}`);
      if (status !== 200) { console.log("  message:", body?.message); continue; }
      console.log({
        "bill.billCodeId": b.billCodeId,
        "bill.billCode": b.billCode,
        "bill.billMonth": b.billMonth,
        "bill.status": b.status,
        "bill.workflowBillMonth": b.workflowBillMonth,
        "bill.workflowId": b.workflowId,
        "bill.instanceBillMonth": b.instanceBillMonth,
        "bill.resolvedMasterStatus": b.resolvedMasterStatus,
        "bill.masterStatus": b.masterStatus,
        "bill.codeStamp": b.codeStamp,
        employeeRows: (body.data || []).length,
      });
    }
  }
  console.log("\nAlso appended to backend/logs/salary-entry-trace.log.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
