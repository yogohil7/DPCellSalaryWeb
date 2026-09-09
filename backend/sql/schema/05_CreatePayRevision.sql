/*
  05_CreatePayRevision.sql + 06_CreatePayMatrix.sql (combined section file)
  SAFE alterations for PayRevisionMaster / PayMatrixMaster linkage.
*/

USE DPCELLSalaryWebDB;
GO

/* =========================================================
   PayRevisionMaster (EXISTS)
   Existing columns: PayRevisionId, SrNo, RevisionCode, RevisionName,
   EffectiveFrom, EffectiveTo, Status, CreatedDate, CreatedBy, ModifiedDate, ModifiedBy
   ========================================================= */
IF OBJECT_ID(N'dbo.PayRevisionMaster', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PayRevisionMaster (
        PayRevisionId   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SrNo            INT NULL,
        RevisionCode    NVARCHAR(50) NOT NULL,
        RevisionName    NVARCHAR(200) NOT NULL,
        EffectiveFrom   DATE NULL,
        EffectiveTo     DATE NULL,
        Description     NVARCHAR(500) NULL,
        Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_PayRevision_Status DEFAULT (N'Active'),
        IsActive        BIT NOT NULL CONSTRAINT DF_PayRevision_IsActive DEFAULT (1),
        CreatedDate     DATETIME NOT NULL CONSTRAINT DF_PayRevision_CreatedDate DEFAULT (GETDATE()),
        CreatedBy       NVARCHAR(200) NULL,
        ModifiedDate    DATETIME NULL,
        ModifiedBy      NVARCHAR(200) NULL,
        CONSTRAINT UQ_PayRevisionMaster_Code UNIQUE (RevisionCode)
    );
    PRINT 'Created PayRevisionMaster';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.PayRevisionMaster', N'Description') IS NULL
        ALTER TABLE dbo.PayRevisionMaster ADD Description NVARCHAR(500) NULL;
    IF COL_LENGTH(N'dbo.PayRevisionMaster', N'IsActive') IS NULL
        ALTER TABLE dbo.PayRevisionMaster ADD IsActive BIT NULL;
    PRINT 'PayRevisionMaster exists — preserved.';
END
GO

IF COL_LENGTH(N'dbo.PayRevisionMaster', N'IsActive') IS NOT NULL
BEGIN
    UPDATE dbo.PayRevisionMaster
    SET IsActive = CASE WHEN UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' THEN 1 ELSE 0 END
    WHERE IsActive IS NULL;
END
GO

/* =========================================================
   PayMatrixMaster (EXISTS) — CRITICAL: add PayRevisionId
   Existing: PayMatrixId, PayCommission, Level, CellNo, BasicPay,
   EffectiveDate, Status, Created/Modified
   ========================================================= */
IF OBJECT_ID(N'dbo.PayMatrixMaster', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PayMatrixMaster (
        PayMatrixId    INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PayRevisionId  INT NOT NULL,
        PayCommission  NVARCHAR(100) NULL,
        Level          INT NOT NULL,
        CellNo         INT NOT NULL,
        BasicPay       DECIMAL(18,2) NOT NULL,
        EffectiveDate  DATE NULL,
        Status         NVARCHAR(20) NOT NULL CONSTRAINT DF_PayMatrix_Status DEFAULT (N'Active'),
        IsActive       BIT NOT NULL CONSTRAINT DF_PayMatrix_IsActive DEFAULT (1),
        CreatedDate    DATETIME2(0) NOT NULL CONSTRAINT DF_PayMatrix_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy      NVARCHAR(200) NULL,
        ModifiedDate   DATETIME2(0) NULL,
        ModifiedBy     NVARCHAR(200) NULL
    );
    PRINT 'Created PayMatrixMaster';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.PayMatrixMaster', N'PayRevisionId') IS NULL
        ALTER TABLE dbo.PayMatrixMaster ADD PayRevisionId INT NULL;
    IF COL_LENGTH(N'dbo.PayMatrixMaster', N'IsActive') IS NULL
        ALTER TABLE dbo.PayMatrixMaster ADD IsActive BIT NULL;
    PRINT 'PayMatrixMaster exists — PayRevisionId column ensured (nullable until backfilled).';
END
GO

IF COL_LENGTH(N'dbo.PayMatrixMaster', N'IsActive') IS NOT NULL
BEGIN
    UPDATE dbo.PayMatrixMaster
    SET IsActive = CASE WHEN UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' THEN 1 ELSE 0 END
    WHERE IsActive IS NULL;
END
GO

/* If matrix rows exist without revision, attach to default PR2016 when present */
IF COL_LENGTH(N'dbo.PayMatrixMaster', N'PayRevisionId') IS NOT NULL
BEGIN
    DECLARE @DefaultRevisionId INT =
        (SELECT TOP 1 PayRevisionId FROM dbo.PayRevisionMaster WHERE RevisionCode = N'PR2016');

    IF @DefaultRevisionId IS NOT NULL
    BEGIN
        UPDATE dbo.PayMatrixMaster
        SET PayRevisionId = @DefaultRevisionId
        WHERE PayRevisionId IS NULL;
    END
END
GO

PRINT '05/06 PayRevision + PayMatrix structural updates completed.';
GO
