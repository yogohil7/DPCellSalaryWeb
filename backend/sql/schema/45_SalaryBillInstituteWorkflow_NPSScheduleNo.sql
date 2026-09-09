/*
  45_SalaryBillInstituteWorkflow_NPSScheduleNo.sql

  Persist the Salary Entry "NPS Schedule No." per institute workflow row.

  WHY HERE:
    dbo.SalaryBillInstituteWorkflow is keyed (SalaryBillCodeId, InstituteCode)
    and already stores the other Salary Entry header fields, BillNo and
    BillDate (migration 37). NPS Schedule No. is the same shape — one value
    per bill per institute — so it belongs on the same row rather than in a
    new table.

    Keying on SalaryBillCodeId is also what keeps Bill Month isolation
    intact: JUN-2026 and JUN-2026-BM-MAY are different BillCodeIds, so each
    keeps its own schedule number and neither can read the other's.

  SAFE / ADDITIVE ONLY:
    - Adds the column only when it is missing (COL_LENGTH guard).
    - Drops nothing, rewrites no existing row, changes no salary value.
*/

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryBillInstituteWorkflow is missing. Run migration 29 first.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'NPSScheduleNo') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
      ADD NPSScheduleNo NVARCHAR(50) NULL;
    PRINT 'Added SalaryBillInstituteWorkflow.NPSScheduleNo';
END
ELSE
    PRINT 'SalaryBillInstituteWorkflow.NPSScheduleNo already exists - skipped.';
GO

PRINT 'Migration 45 (NPS Schedule No.) complete.';
GO
