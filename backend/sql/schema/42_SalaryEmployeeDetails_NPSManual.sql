/*
  42_SalaryEmployeeDetails_NPSManual.sql

  Persist manual NPS override flag on Salary Entry employee snapshots so
  Save/Get Data/Submit do not overwrite user-entered NPS with auto calculation.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

IF COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'NPSManual') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryEmployeeDetails
      ADD NPSManual BIT NOT NULL
        CONSTRAINT DF_SED_NPSManual DEFAULT (0);
    PRINT 'Added SalaryEmployeeDetails.NPSManual.';
END
ELSE
    PRINT 'SalaryEmployeeDetails.NPSManual already exists - skipped.';
GO
