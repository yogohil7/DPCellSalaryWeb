/*
  38_DADifferenceMonthLock.sql

  Dedicated month lock for DA Difference Master / Entry.
  Does NOT reuse SalaryBillCodes.Status (that remains Salary Bill Code Master).

  Unique identity: (LockYear, LockMonthNumber) — one lock row per calendar month.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

IF OBJECT_ID(N'dbo.DADifferenceMonthLock', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DADifferenceMonthLock (
        DADifferenceMonthLockId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DADifferenceMonthLock PRIMARY KEY,

        /* Normalized calendar month key (never display strings). */
        LockYear         INT NOT NULL,
        LockMonthNumber  TINYINT NOT NULL,

        /* Display label e.g. JUN-2026 */
        MonthLabel       NVARCHAR(20) NOT NULL,

        IsLocked         BIT NOT NULL
            CONSTRAINT DF_DADiffMonthLock_IsLocked DEFAULT (1),

        LockedDate       DATETIME2(0) NULL,
        LockedBy         NVARCHAR(200) NULL,
        LockedByUserId   INT NULL,
        Remarks          NVARCHAR(500) NULL,

        CreatedDate      DATETIME2(0) NOT NULL
            CONSTRAINT DF_DADiffMonthLock_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy        NVARCHAR(200) NULL,
        UpdatedDate      DATETIME2(0) NULL,
        UpdatedBy        NVARCHAR(200) NULL,

        CONSTRAINT UQ_DADiffMonthLock_YearMonth UNIQUE (LockYear, LockMonthNumber),
        CONSTRAINT CK_DADiffMonthLock_Month CHECK (LockMonthNumber BETWEEN 1 AND 12),
        CONSTRAINT CK_DADiffMonthLock_Year CHECK (LockYear BETWEEN 1900 AND 2100)
    );

    PRINT 'Created table dbo.DADifferenceMonthLock.';
END
ELSE
    PRINT 'dbo.DADifferenceMonthLock already exists - skipped.';
GO

PRINT 'Migration 38 (DA Difference Month Lock) complete.';
GO
