/*
  48_SalaryBillInstituteWorkflow_BillMonth.sql

  Persist the actual Bill Month (payment/passed month) per institute salary
  bill, independent of the Salary Bill Code Master's own Salary Month.

  Business rule (2026-09-24): Bill Month and Salary Month are independent,
  except Bill Month must never be LATER than Salary Month. Salary Month
  continues to determine which SalaryBillCodes master row (and therefore
  which employee salary data) is used; Bill Month is purely the
  payment/passed month for that same salary bill and must be saved with the
  institute-specific bill instance, not the shared master row.

  Same additive, idempotent pattern as 37_SalaryBillInstituteWorkflow_BillNoDate.sql.
  Does NOT touch dbo.SalaryBillCodes.BillMonth (legacy/master column, left
  exactly as-is) and does NOT create/require any "-BM-" Bill Code variant.
*/
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillMonth') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
      ADD BillMonth NVARCHAR(10) NULL;
    PRINT 'Added SalaryBillInstituteWorkflow.BillMonth';
END
ELSE
    PRINT 'SalaryBillInstituteWorkflow.BillMonth already exists';
GO

PRINT 'Migration 48 (Bill Month persistence) complete.';
GO
