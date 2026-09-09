/*
  02_CreateMasterTables.sql
  SAFE: Create missing tables / add missing columns only.
  Inspected existing DB on 2026-08-25 — do NOT drop or recreate existing objects.
*/

USE DPCELLSalaryWebDB;
GO

/* =========================================================
   A. Districts (EXISTS) — keep Status; optionally add IsActive
   ========================================================= */
IF OBJECT_ID(N'dbo.Districts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Districts (
        DistrictId    INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DistrictName  NVARCHAR(200) NOT NULL,
        Status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_Districts_Status DEFAULT (N'Active'),
        IsActive      BIT           NOT NULL CONSTRAINT DF_Districts_IsActive DEFAULT (1),
        CreatedDate   DATETIME2(0)  NOT NULL CONSTRAINT DF_Districts_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy     NVARCHAR(200) NULL,
        ModifiedDate  DATETIME2(0)  NULL,
        ModifiedBy    NVARCHAR(200) NULL,
        CONSTRAINT UQ_Districts_DistrictName UNIQUE (DistrictName)
    );
    PRINT 'Created dbo.Districts';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Districts', N'IsActive') IS NULL
        ALTER TABLE dbo.Districts ADD IsActive BIT NULL;
    PRINT 'Districts exists — preserved.';
END
GO

IF COL_LENGTH(N'dbo.Districts', N'IsActive') IS NOT NULL
BEGIN
    UPDATE dbo.Districts
    SET IsActive = CASE WHEN UPPER(ISNULL(Status, N'Active')) IN (N'ACTIVE', N'1') THEN 1 ELSE 0 END
    WHERE IsActive IS NULL;
END
GO

/* =========================================================
   B. CityClasses (EXISTS)
   ========================================================= */
IF OBJECT_ID(N'dbo.CityClasses', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CityClasses (
        CityClassId   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SrNo          INT NOT NULL,
        CityClassName NVARCHAR(50) NOT NULL,
        Status        NVARCHAR(20) NOT NULL CONSTRAINT DF_CityClasses_Status DEFAULT (N'Active'),
        IsActive      BIT NOT NULL CONSTRAINT DF_CityClasses_IsActive DEFAULT (1),
        CreatedDate   DATETIME2(0) NOT NULL CONSTRAINT DF_CityClasses_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy     NVARCHAR(200) NULL,
        ModifiedDate  DATETIME2(0) NULL,
        ModifiedBy    NVARCHAR(200) NULL,
        CONSTRAINT UQ_CityClasses_Name UNIQUE (CityClassName)
    );
    PRINT 'Created dbo.CityClasses';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.CityClasses', N'IsActive') IS NULL
        ALTER TABLE dbo.CityClasses ADD IsActive BIT NULL;
    PRINT 'CityClasses exists — preserved.';
END
GO

IF COL_LENGTH(N'dbo.CityClasses', N'IsActive') IS NOT NULL
BEGIN
    UPDATE dbo.CityClasses
    SET IsActive = CASE WHEN UPPER(ISNULL(Status, N'Active')) IN (N'ACTIVE', N'1') THEN 1 ELSE 0 END
    WHERE IsActive IS NULL;
END
GO

/* =========================================================
   C. Sections (EXISTS) — add SectionCode if missing
   CONFLICT NOTE:
   Existing table uses SrNo + SectionName + Status (ACTIVE/INACTIVE).
   Proposed SectionCode added as nullable unique (filtered) to avoid breaking data.
   ========================================================= */
IF OBJECT_ID(N'dbo.Sections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sections (
        SectionId     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SrNo          INT NULL,
        SectionCode   NVARCHAR(50) NOT NULL,
        SectionName   NVARCHAR(200) NOT NULL,
        Status        NVARCHAR(20) NOT NULL CONSTRAINT DF_Sections_Status DEFAULT (N'ACTIVE'),
        IsActive      BIT NOT NULL CONSTRAINT DF_Sections_IsActive DEFAULT (1),
        CreatedDate   DATETIME NOT NULL CONSTRAINT DF_Sections_CreatedDate DEFAULT (GETDATE()),
        CreatedBy     NVARCHAR(100) NULL,
        ModifiedDate  DATETIME NULL,
        ModifiedBy    NVARCHAR(100) NULL,
        CONSTRAINT UQ_Sections_SectionCode UNIQUE (SectionCode),
        CONSTRAINT UQ_Sections_SectionName UNIQUE (SectionName)
    );
    PRINT 'Created dbo.Sections';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Sections', N'SectionCode') IS NULL
        ALTER TABLE dbo.Sections ADD SectionCode NVARCHAR(50) NULL;
    IF COL_LENGTH(N'dbo.Sections', N'IsActive') IS NULL
        ALTER TABLE dbo.Sections ADD IsActive BIT NULL;
    PRINT 'Sections exists — preserved; SectionCode/IsActive ensured.';
END
GO

/* Backfill SectionCode from SectionName slug when null */
IF COL_LENGTH(N'dbo.Sections', N'SectionCode') IS NOT NULL
BEGIN
    UPDATE dbo.Sections
    SET SectionCode = LEFT(REPLACE(UPPER(SectionName), N' ', N'-'), 50)
    WHERE SectionCode IS NULL AND SectionName IS NOT NULL;

    /* Deduplicate SectionCode if needed by appending SectionId */
    ;WITH d AS (
        SELECT SectionId, SectionCode,
               ROW_NUMBER() OVER (PARTITION BY SectionCode ORDER BY SectionId) AS rn
        FROM dbo.Sections
        WHERE SectionCode IS NOT NULL
    )
    UPDATE s
    SET SectionCode = LEFT(s.SectionCode + N'-' + CAST(s.SectionId AS NVARCHAR(20)), 50)
    FROM dbo.Sections s
    INNER JOIN d ON d.SectionId = s.SectionId
    WHERE d.rn > 1;
END
GO

IF COL_LENGTH(N'dbo.Sections', N'IsActive') IS NOT NULL
BEGIN
    UPDATE dbo.Sections
    SET IsActive = CASE WHEN UPPER(ISNULL(Status, N'ACTIVE')) = N'ACTIVE' THEN 1 ELSE 0 END
    WHERE IsActive IS NULL;
END
GO

/* =========================================================
   D. Designations (EXISTS)
   ========================================================= */
IF OBJECT_ID(N'dbo.Designations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Designations (
        DesignationId   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DesignationCode NVARCHAR(50) NOT NULL,
        DesignationName NVARCHAR(200) NOT NULL,
        DesignationType NVARCHAR(100) NULL,
        EmployeeClass   NVARCHAR(50) NULL,
        Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_Designations_Status DEFAULT (N'Active'),
        IsActive        BIT NOT NULL CONSTRAINT DF_Designations_IsActive DEFAULT (1),
        CreatedDate     DATETIME2(0) NOT NULL CONSTRAINT DF_Designations_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy       NVARCHAR(200) NULL,
        ModifiedDate    DATETIME2(0) NULL,
        ModifiedBy      NVARCHAR(200) NULL,
        CONSTRAINT UQ_Designations_DesignationCode UNIQUE (DesignationCode)
    );
    PRINT 'Created dbo.Designations';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Designations', N'IsActive') IS NULL
        ALTER TABLE dbo.Designations ADD IsActive BIT NULL;
    PRINT 'Designations exists — preserved.';
END
GO

/* =========================================================
   E. Institutes (EXISTS — PRESERVE DATA)
   Already has DistrictId, CityClassId, SectionId, text columns.
   ========================================================= */
IF OBJECT_ID(N'dbo.Institutes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Institutes (
        InstituteId         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SectionId           INT NULL,
        InstituteCode       NVARCHAR(50) NOT NULL,
        InstituteName       NVARCHAR(250) NOT NULL,
        InstituteDistrict   NVARCHAR(100) NULL,
        DistrictId          INT NULL,
        CityClass           NVARCHAR(10) NULL,
        CityClassId         INT NULL,
        InstituteAddress    NVARCHAR(500) NULL,
        BankAccountNumber   NVARCHAR(50) NULL,
        Status              NVARCHAR(20) NOT NULL CONSTRAINT DF_Institutes_Status DEFAULT (N'Active'),
        CreatedDate         DATETIME NOT NULL CONSTRAINT DF_Institutes_CreatedDate DEFAULT (GETDATE()),
        CreatedBy           NVARCHAR(100) NULL,
        ModifiedDate        DATETIME NULL,
        ModifiedBy          NVARCHAR(100) NULL,
        CONSTRAINT UQ_Institutes_InstituteCode UNIQUE (InstituteCode)
    );
    PRINT 'Created dbo.Institutes';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Institutes', N'DistrictId') IS NULL
        ALTER TABLE dbo.Institutes ADD DistrictId INT NULL;
    IF COL_LENGTH(N'dbo.Institutes', N'CityClassId') IS NULL
        ALTER TABLE dbo.Institutes ADD CityClassId INT NULL;
    IF COL_LENGTH(N'dbo.Institutes', N'SectionId') IS NULL
        ALTER TABLE dbo.Institutes ADD SectionId INT NULL;
    PRINT 'Institutes exists — data preserved; ID columns ensured.';
END
GO

/* Backfill DistrictId / CityClassId from text columns when possible */
UPDATE i
SET DistrictId = d.DistrictId
FROM dbo.Institutes i
INNER JOIN dbo.Districts d
  ON d.DistrictName = ISNULL(i.InstituteDistrict, i.District)
WHERE i.DistrictId IS NULL;

UPDATE i
SET CityClassId = c.CityClassId
FROM dbo.Institutes i
INNER JOIN dbo.CityClasses c
  ON c.CityClassName = i.CityClass
WHERE i.CityClassId IS NULL;
GO

/* =========================================================
   Roles / Users (EXIST) — add Users.InstituteId if missing
   ========================================================= */
IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        RoleId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RoleName NVARCHAR(100) NOT NULL UNIQUE,
        Description NVARCHAR(250) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Roles_IsActive DEFAULT (1)
    );
END
GO

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UserName NVARCHAR(100) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(255) NOT NULL,
        FullName NVARCHAR(200) NULL,
        RoleId INT NOT NULL,
        InstituteId INT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(200) NULL,
        ModifiedDate DATETIME2(0) NULL,
        ModifiedBy NVARCHAR(200) NULL
    );
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Users', N'InstituteId') IS NULL
        ALTER TABLE dbo.Users ADD InstituteId INT NULL;
    IF COL_LENGTH(N'dbo.Users', N'ModifiedDate') IS NULL
        ALTER TABLE dbo.Users ADD ModifiedDate DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Users', N'ModifiedBy') IS NULL
        ALTER TABLE dbo.Users ADD ModifiedBy NVARCHAR(200) NULL;
    IF COL_LENGTH(N'dbo.Users', N'CreatedBy') IS NULL
        ALTER TABLE dbo.Users ADD CreatedBy NVARCHAR(200) NULL;
    PRINT 'Users exists — PasswordHash preserved; InstituteId ensured.';
END
GO

/* =========================================================
   AuditLogs (EXISTS — different shape than proposed)
   CONFLICT: existing columns ModuleName/ActionName/EntityKey/...
   Proposed UserId/Action/TableName/OldValues NOT applied as replace.
   Add optional columns only if missing.
   ========================================================= */
IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLogs (
        AuditLogId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ModuleName NVARCHAR(100) NOT NULL,
        ActionName NVARCHAR(100) NOT NULL,
        EntityKey NVARCHAR(100) NULL,
        SourceKey NVARCHAR(100) NULL,
        NewKey NVARCHAR(100) NULL,
        Details NVARCHAR(1000) NULL,
        UserName NVARCHAR(100) NULL,
        FullName NVARCHAR(200) NULL,
        UserId INT NULL,
        TableName NVARCHAR(128) NULL,
        RecordId NVARCHAR(100) NULL,
        OldValues NVARCHAR(MAX) NULL,
        NewValues NVARCHAR(MAX) NULL,
        IPAddress NVARCHAR(64) NULL,
        CreatedDate DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLogs_CreatedDate DEFAULT (SYSDATETIME())
    );
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.AuditLogs', N'UserId') IS NULL
        ALTER TABLE dbo.AuditLogs ADD UserId INT NULL;
    IF COL_LENGTH(N'dbo.AuditLogs', N'TableName') IS NULL
        ALTER TABLE dbo.AuditLogs ADD TableName NVARCHAR(128) NULL;
    IF COL_LENGTH(N'dbo.AuditLogs', N'RecordId') IS NULL
        ALTER TABLE dbo.AuditLogs ADD RecordId NVARCHAR(100) NULL;
    IF COL_LENGTH(N'dbo.AuditLogs', N'OldValues') IS NULL
        ALTER TABLE dbo.AuditLogs ADD OldValues NVARCHAR(MAX) NULL;
    IF COL_LENGTH(N'dbo.AuditLogs', N'NewValues') IS NULL
        ALTER TABLE dbo.AuditLogs ADD NewValues NVARCHAR(MAX) NULL;
    IF COL_LENGTH(N'dbo.AuditLogs', N'IPAddress') IS NULL
        ALTER TABLE dbo.AuditLogs ADD IPAddress NVARCHAR(64) NULL;
    PRINT 'AuditLogs exists — preserved; optional audit columns ensured.';
END
GO

PRINT '02_CreateMasterTables completed.';
GO
