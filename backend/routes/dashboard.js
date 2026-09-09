/**
 * DASHBOARD SUMMARY
 *
 * One authenticated aggregate for the Dashboard cards. Every number comes
 * from the live database — no hard-coded values, no fallbacks.
 *
 * Current salary month: the latest OPEN SalaryBillCodes salary period
 * (SalaryYear + SalaryMonthNumber), salary category only. BillMonth is
 * never used to determine the period. If no OPEN month exists, the latest
 * non-archived salary month is used so the dashboard never goes blank;
 * if no salary month exists at all, salaryMonth is null and all metrics 0.
 *
 * Metric sources (existing semantics reused, nothing recalculated):
 * - salaryBills:     OPEN SalaryBillCodes of the month, non-archived, non-DA
 * - employees:       EmployeeMaster active rule (IsActive + Status)
 * - pendingApproval: workflow SUBMITTED/RESUBMITTED/VERIFIED (approval queue)
 * - salaryEntry:     workflow DRAFT without ReturnedToAuditorId (regular bills)
 * - verification:    workflow SUBMITTED/RESUBMITTED
 * - approvalDetails: workflow VERIFIED
 * - returnedBills:   workflow RETURNED + REJECTED-with-auditor (correction queue)
 * - variationReport: employees whose NetSalary differs current vs previous
 *                    month (same current-minus-previous population concept as
 *                    the Variation Report), plus joiners/leavers
 * - finalSalaryBill: COMPLETED/LOCKED SalaryBillCodes of the month, non-DA
 *
 * Workflow metrics join SalaryBillInstituteWorkflow to SalaryBillCodes and
 * always exclude archived bills. DA Difference bills are included in the
 * approval-derived queues (pending/verification/approval/returned) because
 * the approval workflow explicitly handles them; they are excluded from the
 * salary-bill cards, which count regular salary bills only.
 */

const express = require("express");
const { sql } = require("../db");

const router = express.Router();

function isDaCategory(billCategory, billType) {
  const cat = String(billCategory == null ? "Salary" : billCategory)
    .trim()
    .toUpperCase();
  const typ = String(billType == null ? "" : billType).trim().toUpperCase();
  return cat === "DIFFERENCE" || typ === "DA DIFFERENCE";
}

function formatSalaryMonthLabel(salaryMonth, salaryYear) {
  const raw = String(salaryMonth || "").trim();
  const lead = (raw.match(/^[A-Za-z]+/) || [""])[0].slice(0, 3).toUpperCase();
  if (!lead || !salaryYear) return "";
  return `${lead}-${salaryYear}`;
}

/* Latest salary period, salary category only. OPEN first, latest fallback. */
async function resolveSalaryMonth(onlyOpen) {
  const result = onlyOpen
    ? await sql.query`
      SELECT TOP 1
        LTRIM(RTRIM(b.SalaryYear)) AS SalaryYear,
        TRY_CAST(b.SalaryMonthNumber AS INT) AS SalaryMonthNumber,
        b.SalaryMonth AS SalaryMonth
      FROM dbo.SalaryBillCodes b
      WHERE UPPER(LTRIM(RTRIM(b.Status))) = N'OPEN'
        AND ISNULL(b.IsArchived, 0) = 0
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
        AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      ORDER BY LTRIM(RTRIM(b.SalaryYear)) DESC,
        TRY_CAST(b.SalaryMonthNumber AS INT) DESC,
        b.BillCodeId DESC
    `
    : await sql.query`
      SELECT TOP 1
        LTRIM(RTRIM(b.SalaryYear)) AS SalaryYear,
        TRY_CAST(b.SalaryMonthNumber AS INT) AS SalaryMonthNumber,
        b.SalaryMonth AS SalaryMonth
      FROM dbo.SalaryBillCodes b
      WHERE ISNULL(b.IsArchived, 0) = 0
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
        AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      ORDER BY LTRIM(RTRIM(b.SalaryYear)) DESC,
        TRY_CAST(b.SalaryMonthNumber AS INT) DESC,
        b.BillCodeId DESC
    `;
  const row = result.recordset[0];
  if (!row || row.SalaryMonthNumber == null) return null;
  return {
    salaryYear: String(row.SalaryYear),
    salaryMonthNumber: Number(row.SalaryMonthNumber),
    salaryMonth: row.SalaryMonth || "",
  };
}

async function currentMonth() {
  return (await resolveSalaryMonth(true)) || (await resolveSalaryMonth(false));
}

async function buildDashboardSummary() {
  const month = await currentMonth();
  const zeroMetrics = {
    salaryBills: 0,
    employees: 0,
    pendingApproval: 0,
    salaryEntry: 0,
    verification: 0,
    approvalDetails: 0,
    returnedBills: 0,
    variationReport: 0,
    finalSalaryBill: 0,
  };
  if (!month) {
    return { salaryMonth: null, metrics: zeroMetrics };
  }
  const { salaryYear, salaryMonthNumber } = month;

  /* Bill-code cards for the current salary month. */
  const bills = await sql.query`
    SELECT
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(b.Status))) = N'OPEN' THEN 1 ELSE 0 END) AS OpenBills,
      SUM(CASE WHEN UPPER(LTRIM(RTRIM(b.Status))) IN (N'COMPLETED', N'LOCKED') THEN 1 ELSE 0 END) AS FinalBills
    FROM dbo.SalaryBillCodes b
    WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
      AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
      AND ISNULL(b.IsArchived, 0) = 0
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
  `;
  const billRow = bills.recordset[0] || {};

  /* Active employees — the project's established EmployeeMaster rule. */
  const employees = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.EmployeeMaster e
    WHERE ISNULL(e.IsActive, 1) = 1
      AND UPPER(ISNULL(e.Status, N'Active')) = N'ACTIVE'
  `;

  /* Workflow states for the current salary month (approval-derived queues). */
  const workflow = await sql.query`
    SELECT
      UPPER(LTRIM(RTRIM(w.Status))) AS Status,
      COUNT(*) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
      AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
      AND ISNULL(b.IsArchived, 0) = 0
    GROUP BY UPPER(LTRIM(RTRIM(w.Status)))
  `;
  const byStatus = {};
  for (const r of workflow.recordset || []) {
    byStatus[String(r.Status || "")] = Number(r.Cnt) || 0;
  }

  /* Drafts ready for Salary Entry: DRAFT rows not already with an auditor. */
  const drafts = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
      AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
      AND ISNULL(b.IsArchived, 0) = 0
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND UPPER(LTRIM(RTRIM(w.Status))) = N'DRAFT'
      AND w.ReturnedToAuditorId IS NULL
  `;

  /* Returned correction queue: RETURNED plus correctable REJECTED. */
  const returned = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
      AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
      AND ISNULL(b.IsArchived, 0) = 0
      AND (
        UPPER(LTRIM(RTRIM(w.Status))) = N'RETURNED'
        OR (
          UPPER(LTRIM(RTRIM(w.Status))) = N'REJECTED'
          AND w.ReturnedToAuditorId IS NOT NULL
        )
      )
  `;

  /* Variation population: current-vs-previous month NetSalary comparison
     over posted (approved/locked) salary bills — the same current-minus-
     previous concept the Variation Report is built on. */
  const prevMonthNumber = salaryMonthNumber === 1 ? 12 : salaryMonthNumber - 1;
  const prevYear = String(
    salaryMonthNumber === 1 ? Number(salaryYear) - 1 : Number(salaryYear)
  );
  const variation = await sql.query`
    WITH cur AS (
      SELECT d.EmployeeId, SUM(d.NetSalary) AS Net
      FROM dbo.SalaryEmployeeDetails d
      INNER JOIN dbo.SalaryBillCodes b
        ON b.BillCodeId = d.SalaryBillCodeId
      INNER JOIN dbo.SalaryBillInstituteWorkflow w
        ON w.SalaryBillCodeId = d.SalaryBillCodeId
       AND w.InstituteCode = d.InstituteCode
      WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
        AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
        AND ISNULL(b.IsArchived, 0) = 0
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
        AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
        AND UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      GROUP BY d.EmployeeId
    ),
    prev AS (
      SELECT d.EmployeeId, SUM(d.NetSalary) AS Net
      FROM dbo.SalaryEmployeeDetails d
      INNER JOIN dbo.SalaryBillCodes b
        ON b.BillCodeId = d.SalaryBillCodeId
      INNER JOIN dbo.SalaryBillInstituteWorkflow w
        ON w.SalaryBillCodeId = d.SalaryBillCodeId
       AND w.InstituteCode = d.InstituteCode
      WHERE LTRIM(RTRIM(b.SalaryYear)) = ${prevYear}
        AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${prevMonthNumber}
        AND ISNULL(b.IsArchived, 0) = 0
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
        AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
        AND UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      GROUP BY d.EmployeeId
    )
    SELECT COUNT(*) AS Cnt
    FROM cur
    FULL OUTER JOIN prev ON prev.EmployeeId = cur.EmployeeId
    WHERE cur.EmployeeId IS NULL
       OR prev.EmployeeId IS NULL
       OR ISNULL(cur.Net, 0) <> ISNULL(prev.Net, 0)
  `;

  const metrics = {
    salaryBills: Number(billRow.OpenBills) || 0,
    employees: Number((employees.recordset[0] || {}).Cnt) || 0,
    pendingApproval:
      (byStatus.SUBMITTED || 0) +
      (byStatus.RESUBMITTED || 0) +
      (byStatus.VERIFIED || 0),
    salaryEntry: Number((drafts.recordset[0] || {}).Cnt) || 0,
    verification: (byStatus.SUBMITTED || 0) + (byStatus.RESUBMITTED || 0),
    approvalDetails: byStatus.VERIFIED || 0,
    returnedBills: Number((returned.recordset[0] || {}).Cnt) || 0,
    variationReport: Number((variation.recordset[0] || {}).Cnt) || 0,
    finalSalaryBill: Number(billRow.FinalBills) || 0,
  };

  return {
    salaryMonth: formatSalaryMonthLabel(month.salaryMonth, month.salaryYear),
    metrics,
  };
}

/* GET /api/dashboard/summary — one aggregate for the Dashboard cards. */
router.get("/summary", async (_req, res) => {
  try {
    const data = await buildDashboardSummary();
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/dashboard/summary error:", error);
    res.status(500).json({ message: "Unable to load dashboard data." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testDashboardSummary.js). */
module.exports.buildDashboardSummary = buildDashboardSummary;
module.exports.formatSalaryMonthLabel = formatSalaryMonthLabel;
module.exports.isDaCategory = isDaCategory;
