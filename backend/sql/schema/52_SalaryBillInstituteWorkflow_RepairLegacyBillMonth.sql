/*
  52_SalaryBillInstituteWorkflow_RepairLegacyBillMonth.sql

  Repairs a pre-migration-51 workflow row that carries the WRONG Bill Month
  label, so a non-canonical Bill Month instance (e.g. JUL-2026 of the
  AUG-2026 salary bill) stops inheriting the canonical bill's status
  (e.g. LOCKED), and the canonical instance (AUG-2026) gets its own row
  back.

  HOW SUCH A ROW ARISES
  Before migration 51 there was exactly one workflow row per
  (SalaryBillCodeId, InstituteCode) - the canonical bill's row. The
  migration-48 Save Draft wrote the Bill Month being saved onto that single
  row (UPDATE ... SET BillMonth = <selected> WHERE bill AND institute). A
  JUL-2026 save therefore stamped 'JUL-2026' onto the AUG-2026 bill's row.
  Migration 51's backfill resets this only at the moment it runs; a save
  through the old backend after that (or a rerun ordering issue) leaves the
  canonical row labelled 'JUL-2026'. Once the key is (bill, institute,
  BillMonth), that row IS "the JUL-2026 workflow" to every lookup.

  WHAT THIS CHANGES - only BillMonth, only on a row that meets ALL of:
    1. its BillMonth differs from its bill's canonical label
       (UPPER(LEFT(SalaryMonth,3)) + '-' + SalaryYear - the exact
       expression migration 51 used);
    2. it is the ORIGINAL row for that bill + institute (lowest
       WorkflowId) - i.e. the row that existed before migration 51;
    3. no row with the canonical label already exists for that
       bill + institute (so the unique key can never collide);
    4. no dbo.SalaryEntryBillEmployeeDetails rows exist under its current
       label. A genuine non-canonical instance always has them: the current
       code creates a non-canonical workflow row only inside the same Save
       Draft transaction that writes that instance's employee rows.

  WHAT THIS NEVER CHANGES
  Status, SubmittedBy/ApprovedBy/LockedBy, returned-bill assignment,
  BillNo/BillDate/NPSScheduleNo, UpdatedDate/UpdatedBy, approval history,
  employee salary data. No row is inserted or deleted. No -BM- Bill Code
  is created.

  Idempotent: a second run finds no qualifying row and does nothing. Run
  `npm run diagnose:workflow-bill-month` first (read-only) to see exactly
  which rows, if any, this would relabel.

  Prerequisites: migrations 50 and 51.
*/
SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow')
      AND name = N'UQ_SBIW_Bill_Institute_Month'
)
BEGIN
    RAISERROR(N'UQ_SBIW_Bill_Institute_Month is missing. Run migration 51 first.', 16, 1);
    RETURN;
END;
GO

IF OBJECT_ID(N'dbo.SalaryEntryBillEmployeeDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryEntryBillEmployeeDetails is missing. Run migration 50 first.', 16, 1);
    RETURN;
END;
GO

DECLARE @Repaired TABLE (
    WorkflowId INT, SalaryBillCodeId INT, InstituteCode NVARCHAR(50),
    OldBillMonth NVARCHAR(10), NewBillMonth NVARCHAR(10), Status NVARCHAR(30)
);

;WITH Labelled AS (
    SELECT
        w.WorkflowId,
        UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4)) AS CanonicalBillMonth
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE b.SalaryMonth IS NOT NULL
      AND b.SalaryYear IS NOT NULL
)
UPDATE w
SET w.BillMonth = l.CanonicalBillMonth
OUTPUT inserted.WorkflowId, inserted.SalaryBillCodeId, inserted.InstituteCode,
       deleted.BillMonth, inserted.BillMonth, inserted.Status
INTO @Repaired
FROM dbo.SalaryBillInstituteWorkflow w
INNER JOIN Labelled l ON l.WorkflowId = w.WorkflowId
WHERE w.BillMonth <> l.CanonicalBillMonth
  AND w.WorkflowId = (
        SELECT MIN(o.WorkflowId)
        FROM dbo.SalaryBillInstituteWorkflow o
        WHERE o.SalaryBillCodeId = w.SalaryBillCodeId
          AND o.InstituteCode = w.InstituteCode
      )
  AND NOT EXISTS (
        SELECT 1 FROM dbo.SalaryBillInstituteWorkflow c
        WHERE c.SalaryBillCodeId = w.SalaryBillCodeId
          AND c.InstituteCode = w.InstituteCode
          AND c.BillMonth = l.CanonicalBillMonth
      )
  AND NOT EXISTS (
        SELECT 1 FROM dbo.SalaryEntryBillEmployeeDetails e
        WHERE e.SalaryBillCodeId = w.SalaryBillCodeId
          AND e.InstituteCode = w.InstituteCode
          AND e.BillMonth = w.BillMonth
      );

DECLARE @n INT = (SELECT COUNT(*) FROM @Repaired);
PRINT CONCAT('Relabelled ', @n, ' legacy workflow row(s) to their canonical Bill Month.');
SELECT * FROM @Repaired;
GO

PRINT '52_SalaryBillInstituteWorkflow_RepairLegacyBillMonth.sql complete.';
GO
