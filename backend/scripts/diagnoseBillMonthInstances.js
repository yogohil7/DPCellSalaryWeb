/**
 * READ-ONLY: every Bill Month instance of one Salary Bill Code + Institute,
 * with where its Bill No. / Bill Date live. SELECTs only - nothing is written.
 *
 * Usage:  cd D:\DPCellSalaryWeb\backend
 *         node scripts/diagnoseBillMonthInstances.js            (1018 / DDRS-16)
 *         node scripts/diagnoseBillMonthInstances.js 1018 DDRS-16
 */
require("dotenv").config();
const { connectDB } = require("../db");
const { instanceEmployeeRowsSql, queryReport, instanceBillMonthLabel, loadInstanceHeaders, resolveInstanceHeader } = require("../utils/reportBillInstance");

const BILL_CODE_ID = Number(process.argv[2] || 1018);
const INSTITUTE = String(process.argv[3] || "DDRS-16").replace(/'/g, "");

(async () => {
  await connectDB();
  const result = await queryReport(`
    SELECT
      b.BillCodeId, b.BillCode, b.SalaryMonth, b.SalaryYear, b.SalaryMonthNumber,
      b.BillMonth AS MasterBillMonth,
      w.WorkflowId, w.InstituteCode, w.BillMonth AS WorkflowBillMonth, w.Status AS WorkflowStatus,
      w.BillNo, w.BillDate, w.NPSScheduleNo,
      COUNT(d.EmployeeId)             AS EmployeeCount,
      ISNULL(SUM(d.GrossSalary), 0)   AS GrossAmount,
      ISNULL(SUM(d.TotalDeduction),0) AS TotalDeduction,
      ISNULL(SUM(d.NetSalary), 0)     AS NetAmount,
      ISNULL(SUM(d.ChequeAmount), 0)  AS ChequeAmount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    LEFT JOIN ${instanceEmployeeRowsSql()} d ON d.InstanceWorkflowId = w.WorkflowId
    WHERE w.SalaryBillCodeId = ${BILL_CODE_ID} AND w.InstituteCode = N'${INSTITUTE}'
    GROUP BY b.BillCodeId, b.BillCode, b.SalaryMonth, b.SalaryYear, b.SalaryMonthNumber, b.BillMonth,
      w.WorkflowId, w.InstituteCode, w.BillMonth, w.Status, w.BillNo, w.BillDate, w.NPSScheduleNo
    ORDER BY w.WorkflowId`);
  const headers = await loadInstanceHeaders();
  const rows = result.recordset.map((r) => {
    const billMonth = instanceBillMonthLabel(r);
    const h = headers.get(`${r.BillCodeId}|${String(r.InstituteCode).toUpperCase()}|${billMonth}`);
    const resolved = resolveInstanceHeader(headers, r, billMonth);
    return {
      WorkflowId: r.WorkflowId, BillCode: r.BillCode,
      SalaryMonth: `${r.SalaryMonth} ${r.SalaryYear}`, MasterBillMonth: r.MasterBillMonth,
      InstanceBillMonth: billMonth, Status: r.WorkflowStatus,
      "Header.BillNo": h ? h.BillNo : "(no header row)", "Header.BillDate": h ? h.BillDate : "",
      "WorkflowRow.BillNo": r.BillNo, "WorkflowRow.BillDate": r.BillDate,
      "=> Report BillNo": resolved.billNo || "(none stored)", "=> Report BillDate": resolved.billDate || "(none stored)",
      From: resolved.headerSource,
      Employees: r.EmployeeCount, Gross: r.GrossAmount, Deduction: r.TotalDeduction, Net: r.NetAmount, Cheque: r.ChequeAmount,
    };
  });
  console.log(`\nBill Month instances of BillCodeId ${BILL_CODE_ID} / ${INSTITUTE} (read-only):`);
  for (const r of rows) console.log(r);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
