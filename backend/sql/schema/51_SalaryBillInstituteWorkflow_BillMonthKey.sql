/*
  51_SalaryBillInstituteWorkflow_BillMonthKey.sql

  Makes the institute approval/lock workflow Bill-Month-specific, so a
  JUL-2026 bill instance and an AUG-2026 bill instance of the SAME
  SalaryBillCodeId + Institute (e.g. AUG-2026 / DDRS-16) can be
  independently DRAFT -> SUBMITTED -> ... -> APPROVED -> LOCKED without
  one instance's status affecting the other (2026-09-24 follow-up to
  migrations 48/49/50).

  dbo.SalaryBillInstituteWorkflow.BillMonth already exists (migration 48),
  added there as a nullable display-only column. This migration:

    1. Backfills BillMonth for every row that does not already hold the
       bill's own CANONICAL Bill Month (3-letter month + year of
       SalaryMonth/SalaryYear on the joined SalaryBillCodes row, e.g.
       'AUG-2026') - overwriting any value migration 48's display-only
       write may have left there, since that column was never previously
       part of a row's identity. Before this migration there was exactly
       one workflow row per (SalaryBillCodeId, InstituteCode), and it
       always represented that bill's own canonical Salary Month; the
       backfill makes that existing meaning explicit in the new key
       rather than changing it. No Status / SubmittedBy / ApprovedBy /
       LockedBy / returned-state value is touched.
    2. Makes BillMonth NOT NULL.
    3. Replaces UQ_SBIW_Bill_Institute (SalaryBillCodeId, InstituteCode)
       with UQ_SBIW_Bill_Institute_Month (SalaryBillCodeId, InstituteCode,
       BillMonth), so a NEW workflow row can now be created for an
       earlier Bill Month instance of the same bill + institute without
       colliding with the existing (canonical) row.

  Every step is guarded so the script is safe to run again on a database
  that has already taken it: the Step 1 backfill runs only before the key
  is widened, so a rerun can never relabel a legitimate non-canonical
  instance. Migration 48 is a prerequisite and must run first.

  Does not touch Status, approval history, returned-bill assignment, or
  any other column. Does not drop or rename SalaryBillInstituteWorkflow
  or any other table.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryBillInstituteWorkflow is missing. Run migration 29 first.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillMonth') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryBillInstituteWorkflow.BillMonth is missing. Run migration 48 first.', 16, 1);
    RETURN;
END;
GO

/* Step 1 - backfill every row to its bill's own canonical Bill Month.

   RERUN SAFETY (2026-09-24 fix): this backfill is only correct in the
   pre-widening world, where there is exactly ONE row per
   (SalaryBillCodeId, InstituteCode) and it is by definition the canonical
   instance. Once UQ_SBIW_Bill_Institute_Month exists, legitimate
   non-canonical rows (e.g. a JUL-2026 instance of the AUG-2026 bill) exist
   too, and relabelling them to AUG-2026 would silently merge two
   independent bills. So both backfill statements run ONLY while the widened
   key has not been created yet; on any rerun they are skipped. */
IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow')
      AND name = N'UQ_SBIW_Bill_Institute_Month'
)
BEGIN
    UPDATE w
    SET w.BillMonth = UPPER(LEFT(LTRIM(RTRIM(ISNULL(b.SalaryMonth, N''))), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE b.SalaryMonth IS NOT NULL
      AND b.SalaryYear IS NOT NULL
      AND (
            w.BillMonth IS NULL
         OR w.BillMonth <> UPPER(LEFT(LTRIM(RTRIM(ISNULL(b.SalaryMonth, N''))), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
      );

    /* Any row whose SalaryBillCodes master is missing SalaryMonth/SalaryYear
       (should not happen in practice) falls back to a literal placeholder so
       Step 2's NOT NULL conversion never fails the whole migration. */
    UPDATE dbo.SalaryBillInstituteWorkflow
    SET BillMonth = N'UNKNOWN'
    WHERE BillMonth IS NULL OR LTRIM(RTRIM(BillMonth)) = N'';

    PRINT 'Backfilled SalaryBillInstituteWorkflow.BillMonth to each bill''s canonical Bill Month.';
END
ELSE
    PRINT 'UQ_SBIW_Bill_Institute_Month already exists - backfill skipped (rerun).';
GO

/* Step 2 - make BillMonth NOT NULL (only if it is not already). */
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow')
      AND name = N'BillMonth'
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
        ALTER COLUMN BillMonth NVARCHAR(10) NOT NULL;
    PRINT 'SalaryBillInstituteWorkflow.BillMonth is now NOT NULL.';
END
GO

/* Step 3 - swap the unique constraint. */
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow')
      AND name = N'UQ_SBIW_Bill_Institute'
)
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
        DROP CONSTRAINT UQ_SBIW_Bill_Institute;
    PRINT 'Dropped UQ_SBIW_Bill_Institute.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow')
      AND name = N'UQ_SBIW_Bill_Institute_Month'
)
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
        ADD CONSTRAINT UQ_SBIW_Bill_Institute_Month
        UNIQUE (SalaryBillCodeId, InstituteCode, BillMonth);
    PRINT 'Added UQ_SBIW_Bill_Institute_Month.';
END
ELSE
    PRINT 'UQ_SBIW_Bill_Institute_Month already exists.';
GO

PRINT '51_SalaryBillInstituteWorkflow_BillMonthKey.sql complete.';
GO
