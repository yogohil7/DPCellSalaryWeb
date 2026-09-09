/*
  13_SeedSalaryComponentMaster.sql
  Insert default components only when missing.
  RuleSource points at existing masters — does NOT copy DA/HRA/Medical/TA rows.
*/

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryComponentMaster', N'U') IS NULL
BEGIN
    PRINT 'SKIP seed — SalaryComponentMaster missing.';
END
ELSE
BEGIN
    ;WITH Seed AS (
        SELECT * FROM (VALUES
            (N'BASIC',           N'Basic Pay',                 N'BASIC',           N'MANUAL',                   1, 0, 10, N'PayMatrixMaster'),
            (N'DA',              N'Dearness Allowance',        N'DA',              N'PERCENTAGE_OF_BASIC',      1, 0, 20, N'DAMaster'),
            (N'HRA',             N'House Rent Allowance',      N'HRA',             N'PERCENTAGE_OF_BASIC',      1, 0, 30, N'HRAMaster'),
            (N'MEDICAL',         N'Medical Allowance',         N'MEDICAL',         N'FIXED',                    1, 0, 40, N'MedicalAllowanceMaster'),
            (N'TRANSPORT',       N'Transport Allowance',       N'TRANSPORT',       N'FIXED',                    1, 0, 50, N'TransportAllowanceMaster'),
            (N'SPECIAL',         N'Special Allowance',         N'SPECIAL',         N'MANUAL',                   1, 0, 60, N'SalaryComponentRule'),
            (N'OTHER_EARNING',   N'Other Earnings',            N'OTHER_EARNING',   N'MANUAL',                   1, 0, 70, N'SalaryComponentRule'),
            (N'PF',              N'Provident Fund',            N'PF',              N'PERCENTAGE_OF_BASIC_DA',   0, 1, 80, N'SalaryComponentRule'),
            (N'NPS',             N'NPS Contribution',          N'NPS',             N'PERCENTAGE_OF_BASIC_DA',   0, 1, 90, N'SalaryComponentRule'),
            (N'INCOME_TAX',      N'Income Tax',                N'INCOME_TAX',      N'MANUAL',                   0, 1, 100, N'SalaryComponentRule'),
            (N'OTHER_DEDUCTION', N'Other Deduction',           N'OTHER_DEDUCTION', N'MANUAL',                   0, 1, 110, N'SalaryComponentRule')
        ) AS v (
            ComponentCode, ComponentName, ComponentType, CalculationType,
            IsEarning, IsDeduction, DisplayOrder, RuleSource
        )
    )
    INSERT INTO dbo.SalaryComponentMaster (
        ComponentCode, ComponentName, ComponentType, CalculationType,
        IsEarning, IsDeduction, IsActive, DisplayOrder, RuleSource, CreatedBy
    )
    SELECT
        s.ComponentCode,
        s.ComponentName,
        s.ComponentType,
        s.CalculationType,
        s.IsEarning,
        s.IsDeduction,
        1,
        s.DisplayOrder,
        s.RuleSource,
        N'SCHEMA_SEED'
    FROM Seed s
    WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.SalaryComponentMaster m
        WHERE m.ComponentCode = s.ComponentCode
    );

    DECLARE @Cnt INT = (SELECT COUNT(1) FROM dbo.SalaryComponentMaster);
    PRINT CONCAT('Seeded SalaryComponentMaster. Total rows: ', @Cnt);
END
GO

PRINT '13_SeedSalaryComponentMaster completed.';
GO
