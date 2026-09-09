/*
  11_CreateSalaryComponentTables.sql
  Safe create — NO changes to SalaryBillCodes.
  SalaryEmployeeDetails is preserved; child table added only.
*/

SET NOCOUNT ON;
GO

/* =========================================================
   A. SalaryComponentMaster
   ========================================================= */
IF OBJECT_ID(N'dbo.SalaryComponentMaster', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryComponentMaster (
        SalaryComponentId   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ComponentCode       NVARCHAR(50)  NOT NULL,
        ComponentName       NVARCHAR(200) NOT NULL,
        ComponentType       NVARCHAR(30)  NOT NULL,
        CalculationType     NVARCHAR(30)  NOT NULL,
        IsEarning           BIT           NOT NULL CONSTRAINT DF_SCM_IsEarning DEFAULT (1),
        IsDeduction         BIT           NOT NULL CONSTRAINT DF_SCM_IsDeduction DEFAULT (0),
        IsActive            BIT           NOT NULL CONSTRAINT DF_SCM_IsActive DEFAULT (1),
        DisplayOrder        INT           NULL,
        /* Documents which existing master supplies rates (no data duplication) */
        RuleSource          NVARCHAR(50)  NULL,
        CreatedDate         DATETIME2(0)  NOT NULL CONSTRAINT DF_SCM_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy           NVARCHAR(200) NULL,
        ModifiedDate        DATETIME2(0)  NULL,
        ModifiedBy          NVARCHAR(200) NULL,
        CONSTRAINT UQ_SalaryComponentMaster_ComponentCode UNIQUE (ComponentCode),
        CONSTRAINT CK_SCM_EarningOrDeduction CHECK (
            (IsEarning = 1 AND IsDeduction = 0)
            OR (IsEarning = 0 AND IsDeduction = 1)
        )
    );
    PRINT 'Created dbo.SalaryComponentMaster';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.SalaryComponentMaster', N'RuleSource') IS NULL
        ALTER TABLE dbo.SalaryComponentMaster ADD RuleSource NVARCHAR(50) NULL;
    PRINT 'SalaryComponentMaster exists — preserved.';
END
GO

/* =========================================================
   B. SalaryComponentRule
   ========================================================= */
IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryComponentRule (
        SalaryComponentRuleId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SalaryComponentId     INT           NOT NULL,
        PayRevisionId         INT           NULL,
        CityClassId           INT           NULL,
        DesignationId         INT           NULL,
        EmployeeClass         NVARCHAR(50)  NULL,
        EffectiveFrom         DATE          NOT NULL,
        EffectiveTo           DATE          NULL,
        Percentage            DECIMAL(10,4) NULL,
        FixedAmount           DECIMAL(18,2) NULL,
        Formula               NVARCHAR(MAX) NULL,
        IsActive              BIT           NOT NULL CONSTRAINT DF_SCR_IsActive DEFAULT (1),
        CreatedDate           DATETIME2(0)  NOT NULL CONSTRAINT DF_SCR_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy             NVARCHAR(200) NULL,
        ModifiedDate          DATETIME2(0)  NULL,
        ModifiedBy            NVARCHAR(200) NULL
    );
    PRINT 'Created dbo.SalaryComponentRule';
END
ELSE
BEGIN
    PRINT 'SalaryComponentRule exists — preserved.';
END
GO

/* =========================================================
   C. SalaryEmployeeComponentDetails (child of SED)
   Current SalaryEmployeeDetails keeps wide amount columns
   (BasicPay, DA, HRA, …). This child stores normalized
   calculated component lines without altering SED.
   ========================================================= */
IF OBJECT_ID(N'dbo.SalaryEmployeeComponentDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEmployeeComponentDetails (
        SalaryEmployeeComponentDetailId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SalaryEmployeeDetailId          INT           NOT NULL,
        SalaryComponentId               INT           NOT NULL,
        Amount                          DECIMAL(18,2) NOT NULL CONSTRAINT DF_SECD_Amount DEFAULT (0),
        CalculationBase                 DECIMAL(18,2) NULL,
        Rate                            DECIMAL(10,4) NULL,
        Remarks                         NVARCHAR(500) NULL,
        CreatedDate                     DATETIME2(0)  NOT NULL CONSTRAINT DF_SECD_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy                       NVARCHAR(200) NULL,
        ModifiedDate                    DATETIME2(0)  NULL,
        ModifiedBy                      NVARCHAR(200) NULL,
        CONSTRAINT UQ_SECD_Detail_Component UNIQUE (SalaryEmployeeDetailId, SalaryComponentId)
    );
    PRINT 'Created dbo.SalaryEmployeeComponentDetails';
END
ELSE
BEGIN
    PRINT 'SalaryEmployeeComponentDetails exists — preserved.';
END
GO

PRINT '11_CreateSalaryComponentTables completed.';
GO
