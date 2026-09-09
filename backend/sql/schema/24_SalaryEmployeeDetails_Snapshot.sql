/*
  24_SalaryEmployeeDetails_Snapshot.sql
  Additive snapshot columns for historical salary bills.
  Does NOT drop/rename existing columns.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'SalaryEmployeeDetails table not found.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PensionType') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PensionType NVARCHAR(10) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'OtherEarnings') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD OtherEarnings DECIMAL(18,2) NOT NULL CONSTRAINT DF_SED_OtherEarnings DEFAULT (0);
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'NPPA') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD NPPA DECIMAL(18,2) NOT NULL CONSTRAINT DF_SED_NPPA DEFAULT (0);
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'NPSAdvance') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD NPSAdvance DECIMAL(18,2) NOT NULL CONSTRAINT DF_SED_NPSAdvance DEFAULT (0);
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'ChequeAmount') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD ChequeAmount DECIMAL(18,2) NOT NULL CONSTRAINT DF_SED_ChequeAmount DEFAULT (0);
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PayRevisionId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PayRevisionId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PayLevel') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PayLevel NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PayMatrixCellNo') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PayMatrixCellNo INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PayMatrixId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PayMatrixId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'DAMasterId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD DAMasterId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'HRAMasterId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD HRAMasterId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'PayrollConfigId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD PayrollConfigId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'CityClass') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD CityClass NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'AsOfDate') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD AsOfDate DATE NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'HraForcedZero') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD HraForcedZero BIT NOT NULL CONSTRAINT DF_SED_HraForcedZero DEFAULT (0);
GO

PRINT 'SalaryEmployeeDetails snapshot columns ensured.';
GO
