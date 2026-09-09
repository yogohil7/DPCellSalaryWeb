/*
  46_SalaryEmployeeDetails_TAManual.sql

  Persist "this TA was typed by the operator, not derived from the TA
  master" on the saved salary row.

  WHY:
    Salary Entry recomputes TA from the TA master on every save so that a
    Basic Pay edit can never leave a stale TA behind. That rule is correct,
    but it also overwrote a TA the operator entered by hand, so a bill
    saved with TA 7,200 reached Salary Bill Approval showing the master
    amount instead. Approval reads the stored row verbatim, so the value has
    to be right at the point it is stored.

    dbo.SalaryEmployeeDetails already carries exactly this flag for NPS
    (NPSManual, migration 42). TAManual is the same shape on the same row,
    so no new table and no new relationship are introduced.

  SAFE / ADDITIVE ONLY:
    - The column is added only when missing (COL_LENGTH guard), so
      re-running this script is harmless.
    - Nothing is dropped, truncated or recreated.
    - No existing row is rewritten: the column defaults to 0, which means
      "master-derived" and is exactly how every row saved so far behaved.
    - No salary, allowance or deduction amount is changed by this script.
*/

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryEmployeeDetails is missing. Run migration 03 first.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'TAManual') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryEmployeeDetails
        ADD TAManual BIT NOT NULL
        CONSTRAINT DF_SalaryEmployeeDetails_TAManual DEFAULT (0);
    PRINT 'Added SalaryEmployeeDetails.TAManual.';
END
ELSE
    PRINT 'SalaryEmployeeDetails.TAManual already exists - skipped.';
GO

PRINT 'Migration 46 (manual TA flag) complete.';
GO
