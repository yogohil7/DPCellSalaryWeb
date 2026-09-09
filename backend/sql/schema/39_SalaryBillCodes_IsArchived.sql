/*
  39_SalaryBillCodes_IsArchived.sql

  Soft-archive flag for Salary Bill Code Master testing cleanup.
  Preserves FK-linked historical salary rows without showing them as active masters.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'IsArchived') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryBillCodes
      ADD IsArchived BIT NOT NULL
        CONSTRAINT DF_SalaryBillCodes_IsArchived DEFAULT (0);
    PRINT 'Added SalaryBillCodes.IsArchived';
END
ELSE
    PRINT 'SalaryBillCodes.IsArchived already exists';
GO

PRINT 'Migration 39 (SalaryBillCodes.IsArchived) complete.';
GO
