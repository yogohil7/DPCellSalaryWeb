/*
  27_SalaryEmployeeDetails_BasicRates.sql
  Persist DA%/HRA% on salary snapshot so Basic edits can recalc DA/HRA after reopen.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'SalaryEmployeeDetails table not found.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'DAPercentage') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails
    ADD DAPercentage DECIMAL(9,4) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'HRAPercentage') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails
    ADD HRAPercentage DECIMAL(9,4) NULL;
GO

PRINT 'SalaryEmployeeDetails DAPercentage/HRAPercentage ensured.';
GO
