/*
  15_ValidateSalaryComponents.sql
  Read-only validation after salary-component upgrade.
  Does not modify SalaryBillCodes or existing master data.
*/

SET NOCOUNT ON;
GO

PRINT '=== Validation: required tables ===';
SELECT v.TableName,
       CASE WHEN OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NOT NULL THEN N'OK' ELSE N'MISSING' END AS Status
FROM (VALUES
    (N'SalaryBillCodes'),
    (N'SalaryEmployeeDetails'),
    (N'SalaryComponentMaster'),
    (N'SalaryComponentRule'),
    (N'SalaryEmployeeComponentDetails'),
    (N'DAMaster'),
    (N'HRAMaster'),
    (N'MedicalAllowanceMaster'),
    (N'TransportAllowanceMaster'),
    (N'PayRevisionMaster'),
    (N'PayMatrixMaster'),
    (N'EmployeePayHistory'),
    (N'CityClasses'),
    (N'Designations')
) v(TableName);
GO

PRINT '=== Validation: SalaryBillCodes unchanged shape (key columns) ===';
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'SalaryBillCodes'
ORDER BY ORDINAL_POSITION;
GO

PRINT '=== Validation: counts ===';
SELECT N'SalaryBillCodes' AS TableName, COUNT(1) AS Cnt FROM dbo.SalaryBillCodes
UNION ALL SELECT N'SalaryEmployeeDetails', COUNT(1) FROM dbo.SalaryEmployeeDetails
UNION ALL SELECT N'SalaryComponentMaster', COUNT(1) FROM dbo.SalaryComponentMaster
UNION ALL SELECT N'SalaryComponentRule', COUNT(1) FROM dbo.SalaryComponentRule
UNION ALL SELECT N'DAMaster', COUNT(1) FROM dbo.DAMaster
UNION ALL SELECT N'HRAMaster', COUNT(1) FROM dbo.HRAMaster
UNION ALL SELECT N'MedicalAllowanceMaster', COUNT(1) FROM dbo.MedicalAllowanceMaster
UNION ALL SELECT N'TransportAllowanceMaster', COUNT(1) FROM dbo.TransportAllowanceMaster
UNION ALL SELECT N'PayRevisionMaster', COUNT(1) FROM dbo.PayRevisionMaster
UNION ALL SELECT N'PayMatrixMaster', COUNT(1) FROM dbo.PayMatrixMaster
UNION ALL SELECT N'EmployeePayHistory', COUNT(1) FROM dbo.EmployeePayHistory;
GO

PRINT '=== Validation: duplicate component codes ===';
SELECT ComponentCode, COUNT(1) AS Cnt
FROM dbo.SalaryComponentMaster
GROUP BY ComponentCode
HAVING COUNT(1) > 1;
GO

PRINT '=== Validation: overlapping active rules ===';
SELECT
    a.SalaryComponentRuleId AS RuleA,
    b.SalaryComponentRuleId AS RuleB,
    a.SalaryComponentId
FROM dbo.SalaryComponentRule a
INNER JOIN dbo.SalaryComponentRule b
    ON a.SalaryComponentId = b.SalaryComponentId
   AND a.SalaryComponentRuleId < b.SalaryComponentRuleId
   AND a.IsActive = 1
   AND b.IsActive = 1
   AND ISNULL(a.PayRevisionId, -1) = ISNULL(b.PayRevisionId, -1)
   AND ISNULL(a.CityClassId, -1) = ISNULL(b.CityClassId, -1)
   AND ISNULL(a.DesignationId, -1) = ISNULL(b.DesignationId, -1)
   AND ISNULL(a.EmployeeClass, N'') = ISNULL(b.EmployeeClass, N'')
   AND a.EffectiveFrom <= ISNULL(b.EffectiveTo, CONVERT(DATE, '9999-12-31'))
   AND ISNULL(a.EffectiveTo, CONVERT(DATE, '9999-12-31')) >= b.EffectiveFrom;
GO

PRINT '=== Validation: orphan FKs (component structures) ===';
SELECT N'SCR->Component' AS CheckName, COUNT(1) AS Orphans
FROM dbo.SalaryComponentRule r
LEFT JOIN dbo.SalaryComponentMaster c ON c.SalaryComponentId = r.SalaryComponentId
WHERE c.SalaryComponentId IS NULL
UNION ALL
SELECT N'SCR->PayRevision', COUNT(1)
FROM dbo.SalaryComponentRule r
LEFT JOIN dbo.PayRevisionMaster p ON p.PayRevisionId = r.PayRevisionId
WHERE r.PayRevisionId IS NOT NULL AND p.PayRevisionId IS NULL
UNION ALL
SELECT N'SCR->CityClass', COUNT(1)
FROM dbo.SalaryComponentRule r
LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = r.CityClassId
WHERE r.CityClassId IS NOT NULL AND cc.CityClassId IS NULL
UNION ALL
SELECT N'SCR->Designation', COUNT(1)
FROM dbo.SalaryComponentRule r
LEFT JOIN dbo.Designations d ON d.DesignationId = r.DesignationId
WHERE r.DesignationId IS NOT NULL AND d.DesignationId IS NULL
UNION ALL
SELECT N'SECD->SED', COUNT(1)
FROM dbo.SalaryEmployeeComponentDetails x
LEFT JOIN dbo.SalaryEmployeeDetails s ON s.Id = x.SalaryEmployeeDetailId
WHERE s.Id IS NULL
UNION ALL
SELECT N'SECD->Component', COUNT(1)
FROM dbo.SalaryEmployeeComponentDetails x
LEFT JOIN dbo.SalaryComponentMaster c ON c.SalaryComponentId = x.SalaryComponentId
WHERE c.SalaryComponentId IS NULL
UNION ALL
SELECT N'PayMatrix->PayRevision', COUNT(1)
FROM dbo.PayMatrixMaster m
LEFT JOIN dbo.PayRevisionMaster p ON p.PayRevisionId = m.PayRevisionId
WHERE m.PayRevisionId IS NOT NULL AND p.PayRevisionId IS NULL;
GO

PRINT '=== Validation: procedures ===';
SELECT name
FROM sys.procedures
WHERE name IN (
    N'usp_SalaryComponent_GetAll',
    N'usp_SalaryComponent_Save',
    N'usp_SalaryComponent_Delete',
    N'usp_SalaryComponentRule_Get',
    N'usp_SalaryComponentRule_Save',
    N'usp_SalaryComponentRule_Delete',
    N'usp_Salary_GetEmployeeCalculation'
)
ORDER BY name;
GO

PRINT '=== Validation: sample components ===';
SELECT SalaryComponentId, ComponentCode, ComponentName, ComponentType, CalculationType,
       IsEarning, IsDeduction, RuleSource, DisplayOrder
FROM dbo.SalaryComponentMaster
ORDER BY DisplayOrder, ComponentCode;
GO

PRINT '15_ValidateSalaryComponents completed.';
GO
