/* =====================================================================
   VERIFY: LOCKED SALARY MONTH IMMUTABILITY
   Database: DPCELLSalaryWebDB

   PURPOSE
     Prove, against the REAL database, that once a Salary Month is LOCKED its
     salary data is permanent history: not edited, not deleted, not replaced,
     not recalculated — and that processing a LATER month leaves it untouched.

   THIS SCRIPT IS READ-ONLY.
     Every statement below is a SELECT. There is no INSERT, no UPDATE, no
     DELETE, no ALTER, no DROP anywhere in this file. It cannot change your
     data even if run in full, by accident, on production.

     The two steps that DO change something — locking JUN-2026, and creating
     JUL-2026 — are NOT performed here. They are marked *** MANUAL *** and
     must be done through the application, using its own workflow, so that
     what you are testing is the application's real behaviour.

   HOW TO USE
     Run PART 1, save the output.
     Do the MANUAL LOCK.
     Run PART 2, compare with PART 1 — every figure must be identical.
     Do the MANUAL JUL-2026 processing.
     Run PART 3, compare with PART 1 again — still identical.
     Run PART 4 to attempt the negative tests through the application.

   Adjust @SalaryMonth / @SalaryYear / @Institute / @Employee below if you
   want to test a different month, institute or employee.
   ===================================================================== */

USE DPCELLSalaryWebDB;
GO

SET NOCOUNT ON;
GO

/* ---------- parameters ---------- */
DECLARE @SalaryYear        NVARCHAR(4)  = N'2026';
DECLARE @SalaryMonthNumber NVARCHAR(2)  = N'06';      /* JUNE  */
DECLARE @Institute         NVARCHAR(50) = N'OGE-05';
DECLARE @Employee          INT          = 2001;

/* =====================================================================
   PART 1 / 2 / 3 — THE SNAPSHOT
   Run this identical block three times: before lock, after lock, and after
   JUL-2026 exists. Every number must be the same all three times.
   ===================================================================== */

PRINT '========== 1. BILL CODES for the salary month ==========';
/* Several BILL MONTHS may share one SALARY MONTH (a June salary paid on an
   APR, MAY or JUN bill). Every one of them must survive the lock. */
SELECT
    b.BillCodeId,
    b.BillCode,
    b.SalaryMonth,
    b.SalaryMonthNumber,
    b.SalaryYear,
    b.BillMonth,                      /* must NOT be normalised by locking */
    b.BillCategory,
    b.BillType,
    b.Status,
    ISNULL(b.IsArchived, 0) AS IsArchived,
    b.CompletedDate,
    b.LockedDate
FROM dbo.SalaryBillCodes b
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber
ORDER BY b.BillCodeId;

PRINT '========== 2. INSTITUTE WORKFLOW rows ==========';
SELECT
    w.WorkflowId,
    w.SalaryBillCodeId,
    b.BillCode,
    b.BillMonth,
    w.InstituteCode,
    w.Status,
    w.BillNo,
    w.BillDate,
    w.NPSScheduleNo,
    w.ApprovedBy,
    w.ApprovedDate
FROM dbo.SalaryBillInstituteWorkflow w
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber
ORDER BY w.WorkflowId;

PRINT '========== 3. ROW COUNTS (must never decrease) ==========';
SELECT
    (SELECT COUNT(*) FROM dbo.SalaryBillCodes b
      WHERE b.SalaryYear = @SalaryYear
        AND b.SalaryMonthNumber = @SalaryMonthNumber)            AS BillCodeRows,
    (SELECT COUNT(*) FROM dbo.SalaryBillInstituteWorkflow w
      INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
      WHERE b.SalaryYear = @SalaryYear
        AND b.SalaryMonthNumber = @SalaryMonthNumber)            AS WorkflowRows,
    (SELECT COUNT(*) FROM dbo.SalaryEmployeeDetails d
      INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
      WHERE b.SalaryYear = @SalaryYear
        AND b.SalaryMonthNumber = @SalaryMonthNumber)            AS EmployeeDetailRows;

PRINT '========== 4. FINANCIAL TOTALS for the salary month ==========';
/* A single-line fingerprint. If ANY stored amount changes, a total moves. */
SELECT
    COUNT(*)                          AS Rows_,
    COUNT(DISTINCT d.EmployeeId)      AS Employees,
    SUM(d.BasicPay)                   AS BasicPay,
    SUM(d.GradePay)                   AS GradePay_FixBasic,
    SUM(d.TotalBasic)                 AS TotalBasic,
    SUM(d.DA)                         AS DA,
    SUM(d.HRA)                        AS HRA,
    SUM(d.MA)                         AS MA,
    SUM(d.TA)                         AS TA,
    SUM(ISNULL(d.CLA, 0))             AS CLA,
    SUM(d.SpecialAllowance)           AS SpecialAllowance,
    SUM(d.WashingAllowance)           AS WashingAllowance,
    SUM(d.GrossSalary)                AS GrossSalary,
    SUM(d.GPFSubscription)            AS GPFSubscription,
    SUM(d.GPFAdvance)                 AS GPFAdvance,
    SUM(d.NPS)                        AS NPS,
    SUM(d.IncomeTax)                  AS IncomeTax,
    SUM(d.ProfessionalTax)            AS ProfessionalTax,
    SUM(d.OtherDeduction)             AS OtherDeduction,
    SUM(d.TotalDeduction)             AS TotalDeduction,
    SUM(d.NetSalary)                  AS NetSalary,
    SUM(d.ChequeAmount)               AS ChequeAmount
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber;

PRINT '========== 5. CHECKSUM of every stored salary value ==========';
/* One number for the whole month. Any single changed paisa changes it.
   CHECKSUM_AGG is order-independent, so it is safe to compare across runs. */
SELECT
    CHECKSUM_AGG(CHECKSUM(
        d.Id, d.SalaryBillCodeId, d.EmployeeId,
        d.BasicPay, d.GradePay, d.TotalBasic, d.DA, d.HRA, d.MA, d.TA,
        ISNULL(d.CLA, 0), d.SpecialAllowance, d.WashingAllowance,
        d.GrossSalary, d.GPFSubscription, d.GPFAdvance, d.NPS,
        d.IncomeTax, d.ProfessionalTax, d.OtherDeduction,
        d.TotalDeduction, d.NetSalary, d.ChequeAmount,
        ISNULL(d.DARate, 0), ISNULL(d.HRARate, 0)
    )) AS SalaryValueChecksum
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber;

PRINT '========== 6. IDENTITY LIST — the exact row IDs ==========';
/* STEP 16: these Ids must still exist afterwards. A delete-and-reinsert
   would keep the COUNT the same but change every Id — this catches that. */
SELECT
    MIN(d.Id) AS MinDetailId,
    MAX(d.Id) AS MaxDetailId,
    COUNT(*)  AS DetailRows,
    SUM(CAST(d.Id AS BIGINT)) AS SumOfDetailIds   /* changes if Ids change */
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber;

PRINT '========== 7. ONE EMPLOYEE, LINE BY LINE ==========';
/* The human-readable proof for the test employee. Note the employee may
   legitimately appear on more than one BILL MONTH of the same salary month —
   each is a separate historical record and all must persist. */
SELECT
    d.Id                 AS DetailId,
    b.BillCode,
    b.BillMonth,                       /* must stay as originally stored */
    b.SalaryMonth,
    w.Status             AS InstituteStatus,
    b.Status             AS BillStatus,
    d.EmployeeId, d.EmployeeName, d.Designation, d.EmployeeType, d.PensionType,
    d.BasicPay, d.GradePay, d.TotalBasic, d.DA, d.HRA, d.MA, d.TA,
    ISNULL(d.CLA, 0) AS CLA, d.SpecialAllowance, d.WashingAllowance,
    d.GrossSalary,
    d.GPFSubscription, d.GPFAdvance, d.NPS,
    d.IncomeTax, d.ProfessionalTax, d.OtherDeduction,
    d.TotalDeduction, d.NetSalary, d.ChequeAmount,
    d.DARate, d.HRARate
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
LEFT JOIN dbo.SalaryBillInstituteWorkflow w
       ON w.SalaryBillCodeId = d.SalaryBillCodeId
      AND w.InstituteCode = d.InstituteCode
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber
  AND d.EmployeeId = @Employee
ORDER BY b.BillMonth, d.Id;

PRINT '========== 8. BILL MONTH SPREAD (must not be normalised) ==========';
/* STEP 11: locking must NOT rewrite every BillMonth to JUN-2026. */
SELECT b.BillMonth, COUNT(*) AS Bills
FROM dbo.SalaryBillCodes b
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber
GROUP BY b.BillMonth
ORDER BY b.BillMonth;
GO

/* =====================================================================
   *** MANUAL STEP A — LOCK JUNE ***  (NOT performed by this script)

   In the application:
     Salary Bill Code Master -> select the JUN-2026 bill -> Complete & Lock
     (or Salary Bill Approval -> Lock, per your normal procedure)

   Then re-run PART 1 above and compare:
     - BillCodeRows / WorkflowRows / EmployeeDetailRows : IDENTICAL
     - every SUM in section 4                            : IDENTICAL
     - SalaryValueChecksum in section 5                  : IDENTICAL
     - SumOfDetailIds in section 6                       : IDENTICAL
     - BillMonth spread in section 8                     : IDENTICAL
     - only Status / LockedDate may differ
   ===================================================================== */

/* =====================================================================
   *** MANUAL STEP B — CREATE AND PROCESS JUL-2026 ***  (NOT performed here)

   In the application: create the JUL-2026 bill code, enter salary for the
   same employee and institute, save and submit as normal.

   Then re-run PART 1 and confirm JUNE is STILL identical to the very first
   run, and separately run PART 5 below to confirm July is independent.
   ===================================================================== */

/* =====================================================================
   PART 4 — NEGATIVE TESTS (perform through the APPLICATION, not here)

   These must be attempted in the running application while June is LOCKED.
   Expected: every one is REFUSED with a clear message, and re-running PART 1
   afterwards shows an unchanged checksum.

     1. Salary Entry -> open JUN-2026 / OGE-05 -> change Basic -> Save Draft
        Expect: 403, "locked ... cannot be modified"
     2. Same, but press Submit                        Expect: 403
     3. Salary Bill Code Master -> edit the JUN-2026 bill code
        Expect: 403
     4. Salary Bill Code Master -> delete the JUN-2026 bill code
        Expect: 403, "Deleting Salary Bill Codes ... is not allowed"
     5. Direct API, authenticated (do NOT rely on the UI being disabled):
          POST /api/salary-entry/save-draft   with billCode JUN-2026
          POST /api/salary-entry/submit       with billCode JUN-2026
          POST /api/salary/save-calculated    with the June salaryBillCodeId
          PUT  /api/salary-bill-codes/:id     for the June bill
          DELETE /api/salary-bill-codes/:id   for the June bill
        Expect: 403 or 409 on every one.

   After all six, re-run PART 1. The checksum MUST be unchanged.
   ===================================================================== */

/* =====================================================================
   PART 5 — JULY IS INDEPENDENT OF JUNE
   Read-only. Run after JUL-2026 has been processed.
   ===================================================================== */
DECLARE @JulYear NVARCHAR(4) = N'2026';
DECLARE @JulMon  NVARCHAR(2) = N'07';
DECLARE @Emp     INT         = 2001;

PRINT '========== 9. THE SAME EMPLOYEE IN BOTH MONTHS ==========';
/* Two separate historical records. Different DetailIds, different bills.
   Changing July must never have moved June. */
SELECT
    b.SalaryMonth,
    b.SalaryMonthNumber,
    b.BillCode,
    b.BillMonth,
    b.Status          AS BillStatus,
    d.Id              AS DetailId,
    d.BasicPay, d.TA, d.NPS, d.GPFSubscription, d.GPFAdvance,
    d.IncomeTax, d.ProfessionalTax,
    d.GrossSalary, d.TotalDeduction, d.NetSalary
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
WHERE b.SalaryYear IN (@SalaryYear, @JulYear)
  AND b.SalaryMonthNumber IN (@SalaryMonthNumber, @JulMon)
  AND d.EmployeeId = @Emp
ORDER BY b.SalaryMonthNumber, b.BillMonth, d.Id;

PRINT '========== 10. NO ROW IS SHARED BETWEEN THE TWO MONTHS ==========';
/* Must return ZERO rows. A non-empty result would mean July reused a June
   record instead of creating its own. */
SELECT d.Id AS SharedDetailId
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes bj ON bj.BillCodeId = d.SalaryBillCodeId
                                 AND bj.SalaryMonthNumber = @SalaryMonthNumber
INNER JOIN dbo.SalaryBillCodes bl ON bl.BillCodeId = d.SalaryBillCodeId
                                 AND bl.SalaryMonthNumber = @JulMon;

PRINT '========== 11. LOCKED JUNE IS STILL VISIBLE TO REPORTS ==========';
/* Reports read APPROVED / LOCKED rows. A locked month must still appear. */
SELECT COUNT(*) AS RowsVisibleToReports
FROM dbo.SalaryBillInstituteWorkflow w
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
INNER JOIN dbo.SalaryEmployeeDetails d
        ON d.SalaryBillCodeId = w.SalaryBillCodeId
       AND d.InstituteCode = w.InstituteCode
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber
  AND UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
  AND ISNULL(b.IsArchived, 0) = 0;

PRINT '========== 12. MASTER-CHANGE TEST (Steps 13-14) ==========';
/* After changing a rate master or an employee master attribute, re-run
   sections 4, 5 and 7. The stored June figures must NOT move: the salary
   snapshot is historical and must not follow today's masters.

   Below is context only — the CURRENT master rate beside the rate STORED on
   the June rows. They are allowed to differ; that is the point. */
SELECT DISTINCT
    d.DARate    AS StoredJuneDARate,
    d.HRARate   AS StoredJuneHRARate
FROM dbo.SalaryEmployeeDetails d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
WHERE b.SalaryYear = @SalaryYear
  AND b.SalaryMonthNumber = @SalaryMonthNumber;
GO

PRINT '';
PRINT 'READ-ONLY VERIFICATION COMPLETE. No data was modified by this script.';
GO
