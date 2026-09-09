/*
  06_CreatePayMatrix.sql
  Unique rule: (PayRevisionId, Level, CellNo)
  Only create when PayRevisionId is populated for all rows.
*/

USE DPCELLSalaryWebDB;
GO

IF COL_LENGTH(N'dbo.PayMatrixMaster', N'PayRevisionId') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_PayMatrixMaster_Revision_Level_Cell'
          AND object_id = OBJECT_ID(N'dbo.PayMatrixMaster')
   )
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId IS NULL
    )
    AND NOT EXISTS (
        SELECT 1
        FROM dbo.PayMatrixMaster
        GROUP BY PayRevisionId, Level, CellNo
        HAVING COUNT(1) > 1
    )
    BEGIN
        CREATE UNIQUE INDEX UQ_PayMatrixMaster_Revision_Level_Cell
            ON dbo.PayMatrixMaster (PayRevisionId, Level, CellNo)
            WHERE PayRevisionId IS NOT NULL;
        PRINT 'Created unique index UQ_PayMatrixMaster_Revision_Level_Cell';
    END
    ELSE
    BEGIN
        PRINT 'SKIPPED unique index: null PayRevisionId or duplicate Level/Cell rows exist. Resolve data first.';
    END
END
ELSE
BEGIN
    PRINT 'Pay matrix unique index already present or PayRevisionId column missing.';
END
GO
