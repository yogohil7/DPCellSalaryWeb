/*
  Enforce one bill-code master record for a salary month/year/category/type.
  BillCode already has its own unique constraint; this protects the business key
  as well, including requests made outside the frontend.
*/
IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
         AND name = N'UQ_SalaryBillCodes_Period_Category_Type'
   )
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dbo.SalaryBillCodes
        GROUP BY SalaryMonth, SalaryYear, BillCategory, BillType
        HAVING COUNT(*) > 1
    )
    BEGIN
        RAISERROR(N'Cannot create UQ_SalaryBillCodes_Period_Category_Type because duplicate SalaryBillCodes business keys already exist.', 16, 1);
    END

    CREATE UNIQUE INDEX UQ_SalaryBillCodes_Period_Category_Type
        ON dbo.SalaryBillCodes (SalaryMonth, SalaryYear, BillCategory, BillType);
END
GO

