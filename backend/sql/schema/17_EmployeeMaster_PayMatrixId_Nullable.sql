/*
  17_EmployeeMaster_PayMatrixId_Nullable.sql
  FIX employees do not use Pay Matrix — PayMatrixId must allow NULL.
  Additive / safe. No drops. No SalaryBillCodes changes.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.EmployeeMaster', N'PayMatrixId') IS NOT NULL
BEGIN
    /* Drop FK temporarily if present, alter nullability, recreate FK */
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EmployeeMaster_PayMatrix')
        ALTER TABLE dbo.EmployeeMaster DROP CONSTRAINT FK_EmployeeMaster_PayMatrix;

    ALTER TABLE dbo.EmployeeMaster ALTER COLUMN PayMatrixId INT NULL;

    IF OBJECT_ID(N'dbo.PayMatrixMaster', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EmployeeMaster_PayMatrix')
    BEGIN
        ALTER TABLE dbo.EmployeeMaster
            ADD CONSTRAINT FK_EmployeeMaster_PayMatrix
                FOREIGN KEY (PayMatrixId) REFERENCES dbo.PayMatrixMaster (PayMatrixId);
    END

    PRINT 'EmployeeMaster.PayMatrixId is now NULLABLE.';
END
GO

PRINT '17_EmployeeMaster_PayMatrixId_Nullable completed.';
GO
