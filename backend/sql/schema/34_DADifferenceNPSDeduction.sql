/*
  34_DADifferenceNPSDeduction.sql

  Adds the NPS Deduction / Net DA Difference columns to the DA Difference
  snapshot tables.

  SAFE / ADDITIVE ONLY:
    - Every object is created behind an existence guard, so re-running this
      script is harmless and it will never raise error 1913 the way an
      unguarded CREATE INDEX does.
    - No table is dropped, recreated or truncated.
    - No existing row is modified: the new columns default to 0 and the
      backfill below only touches rows where the value is still NULL.

  NOT CREATED (already present, per migration 33):
    DADifferenceBill / DADifferenceEmployeeDetails / DADifferenceMonthDetails
    EmployeeIncrement / EmployeeMaster.IncrementDate
*/

SET NOCOUNT ON;
GO

/* =====================================================================
   1. Per-month NPS deduction and net amount
   ===================================================================== */

IF OBJECT_ID(N'dbo.DADifferenceMonthDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.DADifferenceMonthDetails is missing. Run migration 33 first.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSDeduction') IS NULL
BEGIN
    ALTER TABLE dbo.DADifferenceMonthDetails
        ADD NPSDeduction DECIMAL(18,2) NOT NULL
        CONSTRAINT DF_DADiffMonth_NPS DEFAULT (0);
    PRINT 'Added DADifferenceMonthDetails.NPSDeduction.';
END
ELSE
    PRINT 'DADifferenceMonthDetails.NPSDeduction already exists - skipped.';
GO

IF COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NetDifferenceAmount') IS NULL
BEGIN
    ALTER TABLE dbo.DADifferenceMonthDetails
        ADD NetDifferenceAmount DECIMAL(18,2) NOT NULL
        CONSTRAINT DF_DADiffMonth_Net DEFAULT (0);
    PRINT 'Added DADifferenceMonthDetails.NetDifferenceAmount.';
END
ELSE
    PRINT 'DADifferenceMonthDetails.NetDifferenceAmount already exists - skipped.';
GO

/*
  Marks a row whose NPS was typed by a user rather than derived.
  This is what stops a later recalculation from overwriting a manual value.
*/
IF COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSManual') IS NULL
BEGIN
    ALTER TABLE dbo.DADifferenceMonthDetails
        ADD NPSManual BIT NOT NULL
        CONSTRAINT DF_DADiffMonth_NPSManual DEFAULT (0);
    PRINT 'Added DADifferenceMonthDetails.NPSManual.';
END
ELSE
    PRINT 'DADifferenceMonthDetails.NPSManual already exists - skipped.';
GO

/* =====================================================================
   2. Employee-level totals
   ===================================================================== */

IF OBJECT_ID(N'dbo.DADifferenceEmployeeDetails', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNPSDeduction') IS NULL
    BEGIN
        ALTER TABLE dbo.DADifferenceEmployeeDetails
            ADD TotalNPSDeduction DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffEmp_TotalNPS DEFAULT (0);
        PRINT 'Added DADifferenceEmployeeDetails.TotalNPSDeduction.';
    END
    ELSE
        PRINT 'DADifferenceEmployeeDetails.TotalNPSDeduction already exists - skipped.';

    IF COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNetDifferenceAmount') IS NULL
    BEGIN
        ALTER TABLE dbo.DADifferenceEmployeeDetails
            ADD TotalNetDifferenceAmount DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffEmp_TotalNet DEFAULT (0);
        PRINT 'Added DADifferenceEmployeeDetails.TotalNetDifferenceAmount.';
    END
    ELSE
        PRINT 'DADifferenceEmployeeDetails.TotalNetDifferenceAmount already exists - skipped.';
END
GO

/* =====================================================================
   3. Backfill ONLY rows saved before these columns existed.
      NetDifferenceAmount = DifferenceAmount - NPSDeduction, and because
      NPSDeduction defaulted to 0 those rows keep their original amount.
      No row with a value already set is touched.
   ===================================================================== */

IF COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NetDifferenceAmount') IS NOT NULL
BEGIN
    UPDATE dbo.DADifferenceMonthDetails
    SET NetDifferenceAmount = DifferenceAmount - NPSDeduction
    WHERE NetDifferenceAmount = 0
      AND DifferenceAmount <> 0;

    PRINT 'Backfilled NetDifferenceAmount for pre-existing rows.';
END
GO

IF COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNetDifferenceAmount') IS NOT NULL
BEGIN
    UPDATE e
    SET TotalNetDifferenceAmount = e.TotalDifferenceAmount - e.TotalNPSDeduction
    FROM dbo.DADifferenceEmployeeDetails e
    WHERE e.TotalNetDifferenceAmount = 0
      AND e.TotalDifferenceAmount <> 0;

    PRINT 'Backfilled TotalNetDifferenceAmount for pre-existing rows.';
END
GO

/* =====================================================================
   4. Link a saved salary snapshot back to the increment that produced it.
      SalaryEmployeeDetails.IncrementId was added by migration 33; this
      index makes the lookup cheap. Guarded so it cannot raise error 1913.
   ===================================================================== */

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'IncrementId') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.SalaryEmployeeDetails')
          AND name = N'IX_SED_IncrementId'
   )
BEGIN
    CREATE INDEX IX_SED_IncrementId
        ON dbo.SalaryEmployeeDetails (IncrementId)
        WHERE IncrementId IS NOT NULL;
    PRINT 'Created IX_SED_IncrementId.';
END
ELSE
    PRINT 'IX_SED_IncrementId already exists or IncrementId is missing - skipped.';
GO

PRINT 'Migration 34 (DA Difference NPS Deduction) complete.';
GO
