/*
  04_CreateIndexes.sql
*/

USE DPCELLSalaryWebDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Institutes_DistrictId' AND object_id = OBJECT_ID(N'dbo.Institutes'))
    CREATE INDEX IX_Institutes_DistrictId ON dbo.Institutes (DistrictId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Institutes_CityClassId' AND object_id = OBJECT_ID(N'dbo.Institutes'))
    CREATE INDEX IX_Institutes_CityClassId ON dbo.Institutes (CityClassId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PayMatrixMaster_PayRevisionId' AND object_id = OBJECT_ID(N'dbo.PayMatrixMaster'))
    AND COL_LENGTH(N'dbo.PayMatrixMaster', N'PayRevisionId') IS NOT NULL
    CREATE INDEX IX_PayMatrixMaster_PayRevisionId ON dbo.PayMatrixMaster (PayRevisionId);
GO

IF COL_LENGTH(N'dbo.Sections', N'SectionCode') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_Sections_SectionCode' AND object_id = OBJECT_ID(N'dbo.Sections')
   )
BEGIN
    /* Unique only for non-null codes */
    CREATE UNIQUE INDEX UQ_Sections_SectionCode
        ON dbo.Sections (SectionCode)
        WHERE SectionCode IS NOT NULL;
END
GO

PRINT '04_CreateIndexes completed.';
GO
