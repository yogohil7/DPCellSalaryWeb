/*
  37_SalaryBillInstituteWorkflow_BillNoDate.sql
  Persist Salary Entry Bill No. and Bill Date per institute workflow.
*/
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillNo') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
      ADD BillNo NVARCHAR(50) NULL;
    PRINT 'Added SalaryBillInstituteWorkflow.BillNo';
END
ELSE
    PRINT 'SalaryBillInstituteWorkflow.BillNo already exists';
GO

IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillDate') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryBillInstituteWorkflow
      ADD BillDate DATE NULL;
    PRINT 'Added SalaryBillInstituteWorkflow.BillDate';
END
ELSE
    PRINT 'SalaryBillInstituteWorkflow.BillDate already exists';
GO

PRINT 'Migration 37 (BillNo / BillDate) complete.';
GO
