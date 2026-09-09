/*
  10_Validation.sql
*/

USE DPCELLSalaryWebDB;
GO

PRINT '=== REQUIRED TABLES ===';
SELECT name AS TableName
FROM sys.tables
WHERE name IN (
    N'Districts', N'CityClasses', N'Sections', N'Designations', N'Institutes',
    N'EmployeeMaster', N'PayRevisionMaster', N'PayMatrixMaster', N'EmployeePayHistory',
    N'DAMaster', N'HRAMaster', N'MedicalAllowanceMaster', N'TransportAllowanceMaster',
    N'SalaryBillCodes', N'SalaryEmployeeDetails', N'Users', N'Roles', N'AuditLogs',
    N'SalaryComponentMaster', N'SalaryComponentRule', N'SalaryEmployeeComponentDetails'
)
ORDER BY name;

PRINT '=== INSTITUTE JOIN CHECK ===';
SELECT
    i.InstituteId,
    i.InstituteCode,
    i.InstituteName,
    i.DistrictId,
    d.DistrictName,
    i.CityClassId,
    cc.CityClassName,
    i.InstituteDistrict,
    i.CityClass
FROM dbo.Institutes i
LEFT JOIN dbo.Districts d ON i.DistrictId = d.DistrictId
LEFT JOIN dbo.CityClasses cc ON i.CityClassId = cc.CityClassId;

PRINT '=== ORPHAN Institute DistrictId ===';
SELECT i.*
FROM dbo.Institutes i
LEFT JOIN dbo.Districts d ON d.DistrictId = i.DistrictId
WHERE i.DistrictId IS NOT NULL AND d.DistrictId IS NULL;

PRINT '=== ORPHAN Institute CityClassId ===';
SELECT i.*
FROM dbo.Institutes i
LEFT JOIN dbo.CityClasses c ON c.CityClassId = i.CityClassId
WHERE i.CityClassId IS NOT NULL AND c.CityClassId IS NULL;

PRINT '=== DUPLICATE PAY MATRIX ===';
SELECT PayRevisionId, Level, CellNo, COUNT(1) AS Cnt
FROM dbo.PayMatrixMaster
WHERE PayRevisionId IS NOT NULL
GROUP BY PayRevisionId, Level, CellNo
HAVING COUNT(1) > 1;

PRINT '=== FOREIGN KEYS ===';
SELECT
    fk.name AS ForeignKeyName,
    OBJECT_NAME(fk.parent_object_id) AS ParentTable,
    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ParentColumn,
    OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ReferencedColumn
FROM sys.foreign_keys fk
INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
ORDER BY ParentTable, ForeignKeyName;

PRINT '=== PROCEDURES ===';
SELECT name
FROM sys.procedures
WHERE name LIKE N'usp_%' OR name LIKE N'sp_%'
ORDER BY name;

PRINT '10_Validation completed.';
GO
