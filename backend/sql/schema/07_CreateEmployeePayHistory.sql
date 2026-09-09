/*
  07_CreateEmployeePayHistory.sql
  + safe EmployeeMaster column additions
*/

USE DPCELLSalaryWebDB;
GO

/* EmployeeMaster exists — add missing ID columns only */
IF OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeMaster (
        EmployeeId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmployeeCode NVARCHAR(50) NOT NULL,
        EmployeeName NVARCHAR(250) NOT NULL,
        FirstName NVARCHAR(100) NULL,
        MiddleName NVARCHAR(100) NULL,
        LastName NVARCHAR(100) NULL,
        InstituteId INT NOT NULL,
        SectionId INT NULL,
        DesignationId INT NOT NULL,
        EmployeeClass NVARCHAR(50) NULL,
        EmployeeType NVARCHAR(50) NULL,
        DateOfBirth DATE NULL,
        DateOfJoining DATE NULL,
        DateOfRetirement DATE NULL,
        Gender NVARCHAR(20) NULL,
        PAN NVARCHAR(20) NULL,
        AadhaarLast4 NVARCHAR(4) NULL,
        BankAccountNumber NVARCHAR(50) NULL,
        BankName NVARCHAR(100) NULL,
        IFSCCode NVARCHAR(20) NULL,
        PayRevisionId INT NULL,
        PayMatrixId INT NULL,
        BasicPay DECIMAL(18,2) NULL,
        EffectiveDate DATE NULL,
        EmploymentStatus NVARCHAR(50) NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeMaster_Status DEFAULT (N'Active'),
        IsActive BIT NOT NULL CONSTRAINT DF_EmployeeMaster_IsActive DEFAULT (1),
        CreatedDate DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeMaster_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(200) NULL,
        ModifiedDate DATETIME2(0) NULL,
        ModifiedBy NVARCHAR(200) NULL
    );
    PRINT 'Created EmployeeMaster';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'SectionId') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD SectionId INT NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'PayRevisionId') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD PayRevisionId INT NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'BasicPay') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD BasicPay DECIMAL(18,2) NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'EffectiveDate') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD EffectiveDate DATE NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'FirstName') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD FirstName NVARCHAR(100) NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'MiddleName') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD MiddleName NVARCHAR(100) NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'LastName') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD LastName NVARCHAR(100) NULL;
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'IsActive') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD IsActive BIT NULL;
    PRINT 'EmployeeMaster exists — additive columns ensured.';
END
GO

IF OBJECT_ID(N'dbo.EmployeePayHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeePayHistory (
        EmployeePayHistoryId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmployeeId      INT NOT NULL,
        PayRevisionId   INT NULL,
        PayMatrixId     INT NULL,
        Level           INT NULL,
        CellNo          INT NULL,
        BasicPay        DECIMAL(18,2) NOT NULL,
        EffectiveFrom   DATE NOT NULL,
        EffectiveTo     DATE NULL,
        Reason          NVARCHAR(200) NULL,
        OrderNo         NVARCHAR(100) NULL,
        Remarks         NVARCHAR(500) NULL,
        CreatedDate     DATETIME2(0) NOT NULL CONSTRAINT DF_EPH_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy       NVARCHAR(200) NULL
    );
    CREATE INDEX IX_EmployeePayHistory_Employee ON dbo.EmployeePayHistory (EmployeeId, EffectiveFrom DESC);
    PRINT 'Created EmployeePayHistory';
END
ELSE
BEGIN
    PRINT 'EmployeePayHistory already exists — preserved.';
END
GO

/* Allowance masters: add PayRevisionId / CityClassId when missing (nullable) */
IF OBJECT_ID(N'dbo.DAMaster', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.DAMaster', N'PayRevisionId') IS NULL
    ALTER TABLE dbo.DAMaster ADD PayRevisionId INT NULL;
GO

IF OBJECT_ID(N'dbo.HRAMaster', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.HRAMaster', N'PayRevisionId') IS NULL
        ALTER TABLE dbo.HRAMaster ADD PayRevisionId INT NULL;
    IF COL_LENGTH(N'dbo.HRAMaster', N'CityClassId') IS NULL
        ALTER TABLE dbo.HRAMaster ADD CityClassId INT NULL;
    IF COL_LENGTH(N'dbo.HRAMaster', N'EffectiveFrom') IS NULL
        ALTER TABLE dbo.HRAMaster ADD EffectiveFrom DATE NULL;
    IF COL_LENGTH(N'dbo.HRAMaster', N'EffectiveTo') IS NULL
        ALTER TABLE dbo.HRAMaster ADD EffectiveTo DATE NULL;
END
GO

/* Backfill HRA CityClassId from text CityClass */
IF COL_LENGTH(N'dbo.HRAMaster', N'CityClassId') IS NOT NULL
BEGIN
    UPDATE h
    SET CityClassId = c.CityClassId,
        EffectiveFrom = ISNULL(h.EffectiveFrom, h.EffectiveDate)
    FROM dbo.HRAMaster h
    LEFT JOIN dbo.CityClasses c ON c.CityClassName = h.CityClass
    WHERE h.CityClassId IS NULL OR h.EffectiveFrom IS NULL;
END
GO

IF OBJECT_ID(N'dbo.MedicalAllowanceMaster', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.MedicalAllowanceMaster', N'PayRevisionId') IS NULL
        ALTER TABLE dbo.MedicalAllowanceMaster ADD PayRevisionId INT NULL;
    IF COL_LENGTH(N'dbo.MedicalAllowanceMaster', N'DesignationId') IS NULL
        ALTER TABLE dbo.MedicalAllowanceMaster ADD DesignationId INT NULL;
END
GO

IF OBJECT_ID(N'dbo.TransportAllowanceMaster', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'PayRevisionId') IS NULL
        ALTER TABLE dbo.TransportAllowanceMaster ADD PayRevisionId INT NULL;
    IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'CityClassId') IS NULL
        ALTER TABLE dbo.TransportAllowanceMaster ADD CityClassId INT NULL;
    IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'EmployeeClass') IS NULL
        ALTER TABLE dbo.TransportAllowanceMaster ADD EmployeeClass NVARCHAR(50) NULL;
    /* Existing amount column is TAAmount — do not rename or replace. */
END
GO

IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'CityClassId') IS NOT NULL
BEGIN
    UPDATE t
    SET CityClassId = c.CityClassId
    FROM dbo.TransportAllowanceMaster t
    INNER JOIN dbo.CityClasses c ON c.CityClassName = t.CityClass
    WHERE t.CityClassId IS NULL;
END
GO

/*
  CONFLICT — SalaryBillCodes:
  Existing table is MONTHLY salary bill workflow (BillCode AUG-2026, OPEN/COMPLETED/LOCKED).
  Proposed earning/deduction component codes (BASIC/DA/HRA) would DESTROY that design.
  NO structural replace performed. Keep as-is.
*/
PRINT 'NOTE: dbo.SalaryBillCodes preserved as monthly bill codes (not earning/deduction master).';
GO

PRINT '07 Employee/history + allowance additive columns completed.';
GO
