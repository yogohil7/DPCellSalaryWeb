/*
  49_SalaryEntryBillHeader.sql

  Per-Bill-Month bill header (Bill No. / Bill Date / NPS Schedule No.).

  BUSINESS RULE (2026-09-24, follow-up to migration 48): Salary Month
  determines the salary data and the SalaryBillCodes master row (e.g.
  AUG-2026). Bill Month is the actual payment/passed-month instance of that
  same salary bill, and each Bill Month instance needs its OWN Bill No. /
  Bill Date / NPS Schedule No. — a JUL-2026 bill and an AUG-2026 bill for
  the same AUG-2026 salary data are two separate paperwork instances that
  must never overwrite each other.

  dbo.SalaryBillInstituteWorkflow is deliberately NOT touched by this
  migration: it stays exactly one row per (SalaryBillCodeId, InstituteCode)
  and remains the single source of truth for approval/submit/return/lock
  status, unaffected by which Bill Month was last entered. Its own
  BillNo/BillDate/NPSScheduleNo columns (migrations 37 / 45) are left in
  place and untouched by Salary Entry going forward — Cheque Register keeps
  reading them until it is migrated to this new table (see 51_*).

  Additive, idempotent: safe to run against a database that already has
  this table (does nothing) or does not yet have it (creates it). Does not
  drop or alter any existing table, column, index or constraint.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEntryBillHeader', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEntryBillHeader (
        HeaderId          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_SalaryEntryBillHeader PRIMARY KEY,
        SalaryBillCodeId  INT NOT NULL,
        InstituteCode     NVARCHAR(50) NOT NULL,
        BillMonth         NVARCHAR(10) NOT NULL,
        BillNo            NVARCHAR(50) NULL,
        BillDate          DATE NULL,
        NPSScheduleNo     NVARCHAR(100) NULL,
        CreatedDate       DATETIME2(0) NOT NULL
            CONSTRAINT DF_SEBH_CreatedDate DEFAULT (SYSUTCDATETIME()),
        UpdatedDate       DATETIME2(0) NULL,
        UpdatedBy         NVARCHAR(200) NULL,
        CONSTRAINT UQ_SEBH_Bill_Institute_Month
            UNIQUE (SalaryBillCodeId, InstituteCode, BillMonth)
    );

    CREATE INDEX IX_SEBH_Bill_Institute
        ON dbo.SalaryEntryBillHeader (SalaryBillCodeId, InstituteCode);

    PRINT 'Created dbo.SalaryEntryBillHeader';
END
ELSE
    PRINT 'dbo.SalaryEntryBillHeader already exists';
GO

PRINT '49_SalaryEntryBillHeader.sql complete.';
GO
