/*
  26_SalaryEmployeeDetails_CLA.sql
  Additive CLA snapshot column for Salary Entry historical bills.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NULL
BEGIN
    RAISERROR(N'SalaryEmployeeDetails table not found.', 16, 1);
    RETURN;
END;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'CLA') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails
    ADD CLA DECIMAL(18,2) NOT NULL CONSTRAINT DF_SED_CLA DEFAULT (0);
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'CLAMasterId') IS NULL
    ALTER TABLE dbo.SalaryEmployeeDetails ADD CLAMasterId INT NULL;
GO

PRINT 'SalaryEmployeeDetails CLA columns ensured.';
GO
