/*
  Make BillMonth optional. Salary Month is the only required month field.
  BillMonth is retained for compatibility and is mirrored from SalaryMonth by the API.
*/

IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.SalaryBillCodes', 'BillMonth') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.SalaryBillCodes ALTER COLUMN BillMonth NVARCHAR(10) NULL;
    END
END
GO

PRINT 'BillMonth is now optional on SalaryBillCodes.';
GO
