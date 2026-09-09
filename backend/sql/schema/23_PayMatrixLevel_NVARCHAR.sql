/*
  23_PayMatrixLevel_NVARCHAR.sql
  Safe migration: Pay Matrix Level is alphanumeric (e.g. IS-1, IS-2), not INT.

  - Alter PayMatrixMaster.Level → NVARCHAR(50)
  - Alter EmployeeMaster.PayLevel → NVARCHAR(50)
  - Alter EmployeePayHistory.Level → NVARCHAR(50)
  - Recreate unique index (PayRevisionId, Level, CellNo)
  - Update Pay Matrix stored procedures for NVARCHAR Level
  - Additive Designation → Pay Matrix Level mapping table (no seed guesses)

  Does NOT drop tables or delete data.
*/
SET NOCOUNT ON;
GO

/* -------------------------------------------------------------------------- */
/* 1) PayMatrixMaster.Level INT → NVARCHAR(50)                                */
/* -------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.PayMatrixMaster', N'Level') IS NOT NULL
   AND EXISTS (
        SELECT 1
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.object_id = OBJECT_ID(N'dbo.PayMatrixMaster')
          AND c.name = N'Level'
          AND t.name IN (N'int', N'bigint', N'smallint', N'tinyint')
   )
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_PayMatrixMaster_Revision_Level_Cell'
          AND object_id = OBJECT_ID(N'dbo.PayMatrixMaster')
    )
        DROP INDEX UQ_PayMatrixMaster_Revision_Level_Cell ON dbo.PayMatrixMaster;

    ALTER TABLE dbo.PayMatrixMaster ALTER COLUMN Level NVARCHAR(50) NOT NULL;
    PRINT 'PayMatrixMaster.Level altered to NVARCHAR(50).';
END
ELSE
BEGIN
    PRINT 'PayMatrixMaster.Level already NVARCHAR (or missing) — skip alter.';
END
GO

IF OBJECT_ID(N'dbo.PayMatrixMaster', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_PayMatrixMaster_Revision_Level_Cell'
          AND object_id = OBJECT_ID(N'dbo.PayMatrixMaster')
   )
BEGIN
    CREATE UNIQUE INDEX UQ_PayMatrixMaster_Revision_Level_Cell
        ON dbo.PayMatrixMaster (PayRevisionId, Level, CellNo)
        WHERE PayRevisionId IS NOT NULL;
    PRINT 'Recreated UQ_PayMatrixMaster_Revision_Level_Cell.';
END
GO

/* -------------------------------------------------------------------------- */
/* 2) EmployeeMaster.PayLevel INT → NVARCHAR(50)                              */
/* -------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.EmployeeMaster', N'PayLevel') IS NOT NULL
   AND EXISTS (
        SELECT 1
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.object_id = OBJECT_ID(N'dbo.EmployeeMaster')
          AND c.name = N'PayLevel'
          AND t.name IN (N'int', N'bigint', N'smallint', N'tinyint')
   )
BEGIN
    ALTER TABLE dbo.EmployeeMaster ALTER COLUMN PayLevel NVARCHAR(50) NULL;
    PRINT 'EmployeeMaster.PayLevel altered to NVARCHAR(50).';
END
ELSE
BEGIN
    PRINT 'EmployeeMaster.PayLevel already NVARCHAR (or missing) — skip.';
END
GO

/* -------------------------------------------------------------------------- */
/* 3) EmployeePayHistory.Level INT → NVARCHAR(50)                             */
/* -------------------------------------------------------------------------- */
IF COL_LENGTH(N'dbo.EmployeePayHistory', N'Level') IS NOT NULL
   AND EXISTS (
        SELECT 1
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.object_id = OBJECT_ID(N'dbo.EmployeePayHistory')
          AND c.name = N'Level'
          AND t.name IN (N'int', N'bigint', N'smallint', N'tinyint')
   )
BEGIN
    ALTER TABLE dbo.EmployeePayHistory ALTER COLUMN Level NVARCHAR(50) NULL;
    PRINT 'EmployeePayHistory.Level altered to NVARCHAR(50).';
END
ELSE
BEGIN
    PRINT 'EmployeePayHistory.Level already NVARCHAR (or missing) — skip.';
END
GO

/* -------------------------------------------------------------------------- */
/* 4) Designation → Pay Matrix Level mapping (additive, empty)                */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.DesignationPayMatrixMapping', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DesignationPayMatrixMapping (
        MappingId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DesignationPayMatrixMapping PRIMARY KEY,
        DesignationId INT NOT NULL,
        PayRevisionId INT NOT NULL,
        PayMatrixLevel NVARCHAR(50) NOT NULL,
        DefaultCellNo INT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_DesigPayMap_IsActive DEFAULT (1),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_DesigPayMap_Status DEFAULT (N'Active'),
        CreatedDate DATETIME2(7) NOT NULL CONSTRAINT DF_DesigPayMap_Created DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(200) NULL,
        ModifiedDate DATETIME2(7) NULL,
        ModifiedBy NVARCHAR(200) NULL,
        CONSTRAINT UQ_DesigPayMap_Desig_Revision UNIQUE (DesignationId, PayRevisionId),
        CONSTRAINT FK_DesigPayMap_Designation FOREIGN KEY (DesignationId)
            REFERENCES dbo.Designations (DesignationId),
        CONSTRAINT FK_DesigPayMap_PayRevision FOREIGN KEY (PayRevisionId)
            REFERENCES dbo.PayRevisionMaster (PayRevisionId)
    );
    PRINT 'Created DesignationPayMatrixMapping.';
END
ELSE
BEGIN
    PRINT 'DesignationPayMatrixMapping already exists.';
END
GO

/* -------------------------------------------------------------------------- */
/* 5) Stored procedures — Level as NVARCHAR(50)                               */
/* -------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_GetBasicPay
    @PayRevisionId INT,
    @Level NVARCHAR(50),
    @CellNo INT,
    @EffectiveDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Lvl NVARCHAR(50) = LTRIM(RTRIM(@Level));

    IF @EffectiveDate IS NOT NULL
    BEGIN
        SELECT TOP 1
            PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Lvl
          AND CellNo = @CellNo
          AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
          AND (EffectiveDate IS NULL OR EffectiveDate <= @EffectiveDate)
        ORDER BY EffectiveDate DESC, PayMatrixId DESC;

        IF @@ROWCOUNT > 0 RETURN;

        SELECT TOP 1
            PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Lvl
          AND CellNo = @CellNo
          AND (EffectiveDate IS NULL OR EffectiveDate <= @EffectiveDate)
        ORDER BY EffectiveDate DESC, PayMatrixId DESC;
        RETURN;
    END

    SELECT TOP 1
        PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo
      AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
    ORDER BY PayMatrixId DESC;

    IF @@ROWCOUNT > 0 RETURN;

    SELECT TOP 1
        PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo
    ORDER BY PayMatrixId DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Import
    @PayRevisionId INT,
    @Level NVARCHAR(50),
    @CellNo INT,
    @BasicPay DECIMAL(18,2),
    @EffectiveDate DATE = NULL,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ExistingId INT;
    DECLARE @Lvl NVARCHAR(50) = LTRIM(RTRIM(@Level));

    SELECT TOP 1 @ExistingId = PayMatrixId
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo;

    IF @ExistingId IS NULL
    BEGIN
        INSERT INTO dbo.PayMatrixMaster
            (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
        VALUES
            (
                @PayRevisionId,
                N'7th CPC',
                @Lvl,
                @CellNo,
                @BasicPay,
                @EffectiveDate,
                N'Active',
                1,
                @UserName
            );

        SELECT
            CAST(SCOPE_IDENTITY() AS INT) AS PayMatrixId,
            N'INSERTED' AS ActionName;
    END
    ELSE
    BEGIN
        UPDATE dbo.PayMatrixMaster
        SET
            BasicPay = @BasicPay,
            EffectiveDate = @EffectiveDate,
            Status = N'Active',
            IsActive = 1,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE PayMatrixId = @ExistingId;

        SELECT
            @ExistingId AS PayMatrixId,
            N'UPDATED' AS ActionName;
    END
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Save
    @PayMatrixId INT = NULL,
    @PayRevisionId INT,
    @PayCommission NVARCHAR(100) = NULL,
    @Level NVARCHAR(50),
    @CellNo INT,
    @BasicPay DECIMAL(18,2),
    @EffectiveDate DATE = NULL,
    @Status NVARCHAR(20) = N'Active',
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Lvl NVARCHAR(50) = LTRIM(RTRIM(@Level));

    IF @PayRevisionId IS NULL OR @Lvl IS NULL OR @Lvl = N'' OR @CellNo IS NULL
    BEGIN
        RAISERROR(N'PayRevisionId, Level and CellNo are required.', 16, 1);
        RETURN;
    END

    IF EXISTS (
        SELECT 1 FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Lvl
          AND CellNo = @CellNo
          AND (@PayMatrixId IS NULL OR PayMatrixId <> @PayMatrixId)
    )
    BEGIN
        RAISERROR(N'Duplicate Pay Matrix row for PayRevisionId + Level + CellNo.', 16, 1);
        RETURN;
    END

    IF @PayMatrixId IS NULL
    BEGIN
        INSERT INTO dbo.PayMatrixMaster
            (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
        VALUES
            (
                @PayRevisionId,
                @PayCommission,
                @Lvl,
                @CellNo,
                @BasicPay,
                @EffectiveDate,
                @Status,
                CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
                @UserName
            );
        SELECT SCOPE_IDENTITY() AS PayMatrixId;
    END
    ELSE
    BEGIN
        UPDATE dbo.PayMatrixMaster
        SET
            PayRevisionId = @PayRevisionId,
            PayCommission = @PayCommission,
            Level = @Lvl,
            CellNo = @CellNo,
            BasicPay = @BasicPay,
            EffectiveDate = @EffectiveDate,
            Status = @Status,
            IsActive = CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE PayMatrixId = @PayMatrixId;

        SELECT @PayMatrixId AS PayMatrixId;
    END
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_GetByRevision
    @PayRevisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        PayMatrixId,
        PayRevisionId,
        PayCommission,
        Level,
        CellNo,
        BasicPay,
        EffectiveDate,
        Status,
        IsActive
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY Level, CellNo;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Delete
    @PayMatrixId INT,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.PayMatrixMaster
    SET Status = N'Inactive',
        IsActive = 0,
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = @UserName
    WHERE PayMatrixId = @PayMatrixId;

    SELECT N'SOFT_DELETED' AS Result;
END
GO

PRINT '23_PayMatrixLevel_NVARCHAR.sql completed.';
GO
