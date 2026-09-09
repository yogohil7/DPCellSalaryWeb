/*
  33_DADifferenceAndEmployeeIncrement.sql

  Adds the DA Difference module and the Employee Increment module.

  SAFE / ADDITIVE ONLY:
    - Creates tables only when they are missing.
    - Never drops, renames, truncates or recreates anything.
    - Never touches existing salary, bill or approval data.

  DELIBERATELY NOT CREATED (they would duplicate existing architecture):
    - DARevisionMaster / DARevisionRates
        dbo.DAMaster already IS the DA rate history:
        DAPercentage + EffectiveFrom + EffectiveTo + PayRevisionId.
        The DA rate for any month is resolved from it by effective date.
    - A second bill-code table
        A DA Difference bill reuses dbo.SalaryBillCodes with
        BillCategory = 'Difference' and BillType = 'DA Difference',
        which already produces codes such as AUG-2026-DA-DIFF.
    - A second approval/workflow table
        DA Difference reuses dbo.SalaryBillInstituteWorkflow and
        dbo.SalaryBillApprovalHistory, keyed by (SalaryBillCodeId, InstituteCode).
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

/* =====================================================================
   1. DADifferenceBill
   One row per DA Difference bill code. Holds the difference PERIOD.
   ===================================================================== */

IF OBJECT_ID(N'dbo.DADifferenceBill', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DADifferenceBill (
        DADifferenceBillId       INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DADifferenceBill PRIMARY KEY,

        /* The AUG-2026-DA-DIFF row in dbo.SalaryBillCodes. */
        SalaryBillCodeId         INT NOT NULL,
        BillCode                 NVARCHAR(50) NOT NULL,

        /* Month the difference is PAID in (e.g. August 2026). */
        PaymentSalaryMonth       NVARCHAR(20) NOT NULL,
        PaymentSalaryMonthNumber NVARCHAR(2)  NOT NULL,
        PaymentSalaryYear        NVARCHAR(4)  NOT NULL,

        /* Difference period, inclusive (e.g. JAN-2026 .. APR-2026). */
        FromSalaryMonth          NVARCHAR(20) NOT NULL,
        FromSalaryMonthNumber    NVARCHAR(2)  NOT NULL,
        FromSalaryYear           NVARCHAR(4)  NOT NULL,
        ToSalaryMonth            NVARCHAR(20) NOT NULL,
        ToSalaryMonthNumber      NVARCHAR(2)  NOT NULL,
        ToSalaryYear             NVARCHAR(4)  NOT NULL,

        Description              NVARCHAR(500) NULL,
        Status                   NVARCHAR(20)  NOT NULL
            CONSTRAINT DF_DADiffBill_Status DEFAULT (N'OPEN'),

        CreatedDate              DATETIME2(0) NOT NULL
            CONSTRAINT DF_DADiffBill_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy                NVARCHAR(200) NULL,
        UpdatedDate              DATETIME2(0) NULL,
        UpdatedBy                NVARCHAR(200) NULL,

        CONSTRAINT UQ_DADiffBill_SalaryBillCodeId UNIQUE (SalaryBillCodeId),
        CONSTRAINT CK_DADiffBill_Status CHECK (
            Status IN (N'OPEN', N'COMPLETED', N'LOCKED')
        )
    );

    PRINT 'Created table dbo.DADifferenceBill.';
END
ELSE
    PRINT 'dbo.DADifferenceBill already exists - skipped.';
GO

IF OBJECT_ID(N'dbo.DADifferenceBill', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_DADiffBill_SalaryBillCodes'
   )
BEGIN
    ALTER TABLE dbo.DADifferenceBill
        ADD CONSTRAINT FK_DADiffBill_SalaryBillCodes
        FOREIGN KEY (SalaryBillCodeId)
        REFERENCES dbo.SalaryBillCodes (BillCodeId);

    PRINT 'Added FK_DADiffBill_SalaryBillCodes.';
END
GO


/* =====================================================================
   2. DADifferenceEmployeeDetails
   One row per employee per DA Difference bill per institute.
   Holds the employee-level TOTAL across the whole period.
   ===================================================================== */

IF OBJECT_ID(N'dbo.DADifferenceEmployeeDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DADifferenceEmployeeDetails (
        DADifferenceEmployeeDetailId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DADifferenceEmployeeDetails PRIMARY KEY,

        DADifferenceBillId       INT NOT NULL,
        SalaryBillCodeId         INT NOT NULL,
        EmployeeId               INT NOT NULL,
        InstituteId              INT NULL,
        InstituteCode            NVARCHAR(50) NOT NULL,

        EmployeeName             NVARCHAR(200) NULL,
        EmployeeCode             NVARCHAR(50)  NULL,
        Designation              NVARCHAR(200) NULL,
        EmployeeType             NVARCHAR(20)  NULL,
        PayLevel                 NVARCHAR(50)  NULL,

        /* Sum of DADifferenceMonthDetails.DifferenceAmount for this employee. */
        TotalDifferenceAmount    DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffEmp_Total DEFAULT (0),

        DisplayOrder             INT NULL,

        CreatedDate              DATETIME2(0) NOT NULL
            CONSTRAINT DF_DADiffEmp_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy                NVARCHAR(200) NULL,
        UpdatedDate              DATETIME2(0) NULL,
        UpdatedBy                NVARCHAR(200) NULL,

        CONSTRAINT UQ_DADiffEmp_Bill_Employee_Institute
            UNIQUE (DADifferenceBillId, EmployeeId, InstituteCode)
    );

    CREATE INDEX IX_DADiffEmp_Bill_Institute
        ON dbo.DADifferenceEmployeeDetails (DADifferenceBillId, InstituteCode);

    PRINT 'Created table dbo.DADifferenceEmployeeDetails.';
END
ELSE
    PRINT 'dbo.DADifferenceEmployeeDetails already exists - skipped.';
GO


/* =====================================================================
   3. DADifferenceMonthDetails
   PERMANENT PAYMENT SNAPSHOT — one row per employee per historical month.
   Once written, a later change to DAMaster must NOT alter these values.
   ===================================================================== */

IF OBJECT_ID(N'dbo.DADifferenceMonthDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DADifferenceMonthDetails (
        DADifferenceMonthDetailId    INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DADifferenceMonthDetails PRIMARY KEY,

        DADifferenceBillId           INT NOT NULL,
        DADifferenceEmployeeDetailId INT NULL,
        EmployeeId                   INT NOT NULL,
        InstituteCode                NVARCHAR(50) NOT NULL,

        /* Historical month, e.g. 'JAN-2026' / '01' / '2026'. */
        SalaryMonth                  NVARCHAR(20) NOT NULL,
        SalaryMonthNumber            NVARCHAR(2)  NOT NULL,
        SalaryYear                   NVARCHAR(4)  NOT NULL,

        /* Which historical salary bill the snapshot was read from. */
        SourceSalaryBillCodeId       INT NULL,
        SourceBillCode               NVARCHAR(50) NULL,

        HistoricalBasic              DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffMonth_HistBasic DEFAULT (0),
        OldDARate                    DECIMAL(9,4)  NULL,
        OldDA                        DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffMonth_OldDA DEFAULT (0),
        RevisedDARate                DECIMAL(9,4)  NOT NULL
            CONSTRAINT DF_DADiffMonth_RevRate DEFAULT (0),
        RevisedDA                    DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffMonth_RevDA DEFAULT (0),
        DifferenceAmount             DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_DADiffMonth_Diff DEFAULT (0),

        /* Set when no salary snapshot existed for that month. */
        SnapshotMissing              BIT NOT NULL
            CONSTRAINT DF_DADiffMonth_Missing DEFAULT (0),
        Remarks                      NVARCHAR(500) NULL,

        CreatedDate                  DATETIME2(0) NOT NULL
            CONSTRAINT DF_DADiffMonth_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy                    NVARCHAR(200) NULL,

        CONSTRAINT UQ_DADiffMonth_Bill_Emp_Inst_Month
            UNIQUE (DADifferenceBillId, EmployeeId, InstituteCode,
                    SalaryYear, SalaryMonthNumber)
    );

    CREATE INDEX IX_DADiffMonth_Bill_Institute
        ON dbo.DADifferenceMonthDetails (DADifferenceBillId, InstituteCode);

    PRINT 'Created table dbo.DADifferenceMonthDetails.';
END
ELSE
    PRINT 'dbo.DADifferenceMonthDetails already exists - skipped.';
GO

IF OBJECT_ID(N'dbo.DADifferenceMonthDetails', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.DADifferenceBill', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_DADiffMonth_Bill'
   )
BEGIN
    ALTER TABLE dbo.DADifferenceMonthDetails
        ADD CONSTRAINT FK_DADiffMonth_Bill
        FOREIGN KEY (DADifferenceBillId)
        REFERENCES dbo.DADifferenceBill (DADifferenceBillId);

    PRINT 'Added FK_DADiffMonth_Bill.';
END
GO

IF OBJECT_ID(N'dbo.DADifferenceEmployeeDetails', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.DADifferenceBill', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_DADiffEmp_Bill'
   )
BEGIN
    ALTER TABLE dbo.DADifferenceEmployeeDetails
        ADD CONSTRAINT FK_DADiffEmp_Bill
        FOREIGN KEY (DADifferenceBillId)
        REFERENCES dbo.DADifferenceBill (DADifferenceBillId);

    PRINT 'Added FK_DADiffEmp_Bill.';
END
GO


/* =====================================================================
   4. EmployeeIncrement
   Complete, append-only increment history. Historical rows are never
   overwritten; superseding an increment marks it Cancelled instead.
   ===================================================================== */

IF OBJECT_ID(N'dbo.EmployeeIncrement', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeIncrement (
        IncrementId          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_EmployeeIncrement PRIMARY KEY,

        EmployeeId           INT NOT NULL,
        IncrementDate        DATE NOT NULL,

        PreviousBasic        DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_EmpInc_PrevBasic DEFAULT (0),
        IncrementAmount      DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_EmpInc_Amount DEFAULT (0),
        NewBasic             DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_EmpInc_NewBasic DEFAULT (0),

        PreviousPayLevel     NVARCHAR(50) NULL,
        NewPayLevel          NVARCHAR(50) NULL,
        PreviousCellNo       INT NULL,
        NewCellNo            INT NULL,
        PayRevisionId        INT NULL,
        PayMatrixId          INT NULL,

        /* 'YYYY-MM' — the first salary month the new Basic applies to. */
        EffectiveMonth       NVARCHAR(7) NOT NULL,
        EffectiveDate        DATE NOT NULL,

        Status               NVARCHAR(20) NOT NULL
            CONSTRAINT DF_EmpInc_Status DEFAULT (N'Active'),
        Remarks              NVARCHAR(500) NULL,

        /* Which salary bill first applied it (audit only). */
        SalaryBillCodeId     INT NULL,
        InstituteCode        NVARCHAR(50) NULL,
        AppliedAutomatically BIT NOT NULL
            CONSTRAINT DF_EmpInc_Auto DEFAULT (0),

        CreatedDate          DATETIME2(0) NOT NULL
            CONSTRAINT DF_EmpInc_CreatedDate DEFAULT (SYSUTCDATETIME()),
        CreatedBy            NVARCHAR(200) NULL,
        UpdatedDate          DATETIME2(0) NULL,
        UpdatedBy            NVARCHAR(200) NULL,

        CONSTRAINT CK_EmpInc_Status CHECK (
            Status IN (N'Active', N'Cancelled')
        )
    );

    /* One ACTIVE increment per employee per effective month. */
    CREATE UNIQUE INDEX UQ_EmpInc_Employee_Month_Active
        ON dbo.EmployeeIncrement (EmployeeId, EffectiveMonth)
        WHERE Status = N'Active';

    CREATE INDEX IX_EmpInc_Employee_EffectiveDate
        ON dbo.EmployeeIncrement (EmployeeId, EffectiveDate);

    PRINT 'Created table dbo.EmployeeIncrement.';
END
ELSE
    PRINT 'dbo.EmployeeIncrement already exists - skipped.';
GO

IF OBJECT_ID(N'dbo.EmployeeIncrement', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE name = N'FK_EmpInc_EmployeeMaster'
   )
BEGIN
    ALTER TABLE dbo.EmployeeIncrement
        ADD CONSTRAINT FK_EmpInc_EmployeeMaster
        FOREIGN KEY (EmployeeId)
        REFERENCES dbo.EmployeeMaster (EmployeeId);

    PRINT 'Added FK_EmpInc_EmployeeMaster.';
END
GO


/* =====================================================================
   5. EmployeeMaster.IncrementDate
   MonthOfIncrement (INT) already exists. IncrementDate is added so a
   full date (01-Jul-2026 / 01-Jan-2026 / 01-Oct-2026) can be stored
   where the month alone is not enough.
   ===================================================================== */

IF OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.EmployeeMaster', N'IncrementDate') IS NULL
BEGIN
    ALTER TABLE dbo.EmployeeMaster ADD IncrementDate DATE NULL;
    PRINT 'Added EmployeeMaster.IncrementDate.';
END
ELSE
    PRINT 'EmployeeMaster.IncrementDate already present - skipped.';
GO


/* =====================================================================
   6. Salary snapshot completeness (requirement Q)
   SalaryEmployeeDetails must retain CLA and the pay-level context so a
   later DA Difference run can read a faithful historical snapshot.
   Migrations 24/26/27 add most of these; these guards are for databases
   that have not run them.
   ===================================================================== */

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'CLA') IS NULL
    BEGIN
        ALTER TABLE dbo.SalaryEmployeeDetails
            ADD CLA DECIMAL(18,2) NOT NULL
            CONSTRAINT DF_SED_CLA_33 DEFAULT (0);
        PRINT 'Added SalaryEmployeeDetails.CLA.';
    END;

    IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'DARate') IS NULL
    BEGIN
        ALTER TABLE dbo.SalaryEmployeeDetails ADD DARate DECIMAL(9,4) NULL;
        PRINT 'Added SalaryEmployeeDetails.DARate.';
    END;

    IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'HRARate') IS NULL
    BEGIN
        ALTER TABLE dbo.SalaryEmployeeDetails ADD HRARate DECIMAL(9,4) NULL;
        PRINT 'Added SalaryEmployeeDetails.HRARate.';
    END;

    IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'IncrementId') IS NULL
    BEGIN
        ALTER TABLE dbo.SalaryEmployeeDetails ADD IncrementId INT NULL;
        PRINT 'Added SalaryEmployeeDetails.IncrementId.';
    END;
END
GO

/* Index used by the DA Difference historical lookup. */
IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.SalaryEmployeeDetails')
          AND name = N'IX_SED_Bill_Institute_Employee'
   )
BEGIN
    CREATE INDEX IX_SED_Bill_Institute_Employee
        ON dbo.SalaryEmployeeDetails (SalaryBillCodeId, InstituteCode, EmployeeId);
    PRINT 'Created IX_SED_Bill_Institute_Employee.';
END
GO

PRINT 'Migration 33 (DA Difference + Employee Increment) complete.';
GO
