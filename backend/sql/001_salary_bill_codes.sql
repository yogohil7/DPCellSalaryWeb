/*
  DP Cell Salary Management System
  Migration: Salary Bill Codes + Audit Log

  Run in SQL Server Management Studio against your DP Cell database, OR:
  sqlcmd -S YourServer -d YourDatabase -E -i backend/sql/001_salary_bill_codes.sql
*/

IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryBillCodes (
        BillCodeId           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BillCode             NVARCHAR(50)  NOT NULL,
        BillMonth            NVARCHAR(10)  NULL,      -- legacy/compat; mirrored from SalaryMonth
        SalaryMonth          NVARCHAR(10)  NOT NULL,  -- e.g. AUG-26 (only required month)
        SalaryMonthNumber    NVARCHAR(2)   NULL,     -- e.g. 08 (legacy form support)
        SalaryYear           NVARCHAR(4)   NOT NULL,  -- e.g. 2026
        BillCategory         NVARCHAR(50)  NOT NULL,  -- Salary / Difference
        BillType             NVARCHAR(100) NOT NULL,  -- Regular Salary / DA Difference ...
        Description          NVARCHAR(500) NULL,
        Status               NVARCHAR(20)  NOT NULL CONSTRAINT DF_SalaryBillCodes_Status DEFAULT (N'OPEN'),
        CreatedDate          DATETIME2(0)  NOT NULL CONSTRAINT DF_SalaryBillCodes_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy            NVARCHAR(100) NULL,
        CompletedDate        DATETIME2(0)  NULL,
        CompletedBy          NVARCHAR(100) NULL,
        LockedDate           DATETIME2(0)  NULL,
        LockedBy             NVARCHAR(100) NULL,
        CopiedFromBillCode   NVARCHAR(50)  NULL,
        UpdatedDate          DATETIME2(0)  NULL,
        UpdatedBy            NVARCHAR(100) NULL,
        CONSTRAINT UQ_SalaryBillCodes_BillCode UNIQUE (BillCode),
        CONSTRAINT CK_SalaryBillCodes_Status CHECK (Status IN (N'OPEN', N'COMPLETED', N'LOCKED'))
    );

    CREATE INDEX IX_SalaryBillCodes_Status ON dbo.SalaryBillCodes (Status);
    CREATE INDEX IX_SalaryBillCodes_SalaryYear ON dbo.SalaryBillCodes (SalaryYear);
END
GO

/* Add missing columns if table already existed with an older shape */
IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.SalaryBillCodes', 'BillMonth') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD BillMonth NVARCHAR(10) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'CompletedDate') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD CompletedDate DATETIME2(0) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'CompletedBy') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD CompletedBy NVARCHAR(100) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'LockedDate') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD LockedDate DATETIME2(0) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'LockedBy') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD LockedBy NVARCHAR(100) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'CopiedFromBillCode') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD CopiedFromBillCode NVARCHAR(50) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'UpdatedDate') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD UpdatedDate DATETIME2(0) NULL;

    IF COL_LENGTH('dbo.SalaryBillCodes', 'UpdatedBy') IS NULL
        ALTER TABLE dbo.SalaryBillCodes ADD UpdatedBy NVARCHAR(100) NULL;
END
GO

IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLogs (
        AuditLogId     BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ModuleName     NVARCHAR(100) NOT NULL,
        ActionName     NVARCHAR(100) NOT NULL,
        EntityKey      NVARCHAR(100) NULL,
        SourceKey      NVARCHAR(100) NULL,
        NewKey         NVARCHAR(100) NULL,
        Details        NVARCHAR(1000) NULL,
        UserName       NVARCHAR(100) NULL,
        FullName       NVARCHAR(200) NULL,
        CreatedDate    DATETIME2(0)  NOT NULL CONSTRAINT DF_AuditLogs_CreatedDate DEFAULT (SYSUTCDATETIME())
    );

    CREATE INDEX IX_AuditLogs_Module_Created ON dbo.AuditLogs (ModuleName, CreatedDate DESC);
END
GO

PRINT 'Salary Bill Codes migration completed.';
GO
