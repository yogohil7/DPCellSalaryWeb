/* Employee-specific, date-effective salary component overrides. */
IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.SalaryComponentRule', N'EmployeeId') IS NULL
BEGIN
    ALTER TABLE dbo.SalaryComponentRule ADD EmployeeId INT NULL;
END
GO

IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.EmployeeMaster', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SCR_Employee')
BEGIN
    ALTER TABLE dbo.SalaryComponentRule
        ADD CONSTRAINT FK_SCR_Employee
        FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId);
END
GO

IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE object_id = OBJECT_ID(N'dbo.SalaryComponentRule')
         AND name = N'IX_SCR_Employee_Component_Dates'
   )
BEGIN
    CREATE INDEX IX_SCR_Employee_Component_Dates
        ON dbo.SalaryComponentRule (EmployeeId, SalaryComponentId, EffectiveFrom, EffectiveTo)
        INCLUDE (IsActive);
END
GO

