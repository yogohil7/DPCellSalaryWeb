/*
  16_EmployeePayLevelColumns.sql
  Additive only — do not drop/recreate EmployeeMaster.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.EmployeeMaster', N'PayLevel') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD PayLevel INT NULL;

    IF COL_LENGTH(N'dbo.EmployeeMaster', N'PayMatrixCellNo') IS NULL
        ALTER TABLE dbo.EmployeeMaster ADD PayMatrixCellNo INT NULL;

    PRINT 'EmployeeMaster PayLevel / PayMatrixCellNo ensured.';
END
GO

/* Backfill from PayMatrixMaster when possible */
IF COL_LENGTH(N'dbo.EmployeeMaster', N'PayLevel') IS NOT NULL
   AND COL_LENGTH(N'dbo.EmployeeMaster', N'PayMatrixCellNo') IS NOT NULL
BEGIN
    UPDATE e
    SET
        PayLevel = COALESCE(e.PayLevel, m.Level),
        PayMatrixCellNo = COALESCE(e.PayMatrixCellNo, m.CellNo),
        PayRevisionId = COALESCE(e.PayRevisionId, m.PayRevisionId),
        BasicPay = COALESCE(e.BasicPay, m.BasicPay)
    FROM dbo.EmployeeMaster e
    INNER JOIN dbo.PayMatrixMaster m ON m.PayMatrixId = e.PayMatrixId
    WHERE e.PayMatrixId IS NOT NULL;
END
GO

PRINT '16_EmployeePayLevelColumns completed.';
GO
