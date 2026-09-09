/*
  43_SalaryBillCodes_BillMonth_Unique.sql

  Allow multiple Salary Bill Codes for the same Salary Month when Bill Month differs.

  Replaces:
    UQ_SalaryBillCodes_Period_Category_Type
      (SalaryMonth, SalaryYear, BillCategory, BillType)

  With:
    UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type
      (BillMonth, SalaryMonth, SalaryYear, BillCategory, BillType)

  Prerequisite: BillMonth values must already be canonical (e.g. MAY-2026),
  which the apply script normalizes before running this file.
*/

UPDATE dbo.SalaryBillCodes
SET BillMonth = SalaryMonth
WHERE BillMonth IS NULL OR LTRIM(RTRIM(BillMonth)) = N'';
GO

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
      AND name = N'UQ_SalaryBillCodes_Period_Category_Type'
)
BEGIN
    DROP INDEX UQ_SalaryBillCodes_Period_Category_Type ON dbo.SalaryBillCodes;
    PRINT 'Dropped UQ_SalaryBillCodes_Period_Category_Type.';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
      AND name = N'UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type'
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dbo.SalaryBillCodes
        GROUP BY BillMonth, SalaryMonth, SalaryYear, BillCategory, BillType
        HAVING COUNT(*) > 1
    )
    BEGIN
        RAISERROR(
            N'Cannot create UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type because duplicate BillMonth+SalaryMonth business keys exist.',
            16,
            1
        );
    END
    ELSE
    BEGIN
        CREATE UNIQUE INDEX UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type
            ON dbo.SalaryBillCodes (BillMonth, SalaryMonth, SalaryYear, BillCategory, BillType);
        PRINT 'Created UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type.';
    END
END
ELSE
BEGIN
    PRINT 'UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type already exists.';
END
GO

PRINT '43_SalaryBillCodes_BillMonth_Unique.sql completed.';
GO
