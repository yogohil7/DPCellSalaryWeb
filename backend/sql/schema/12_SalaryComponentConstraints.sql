/*
  12_SalaryComponentConstraints.sql
  Foreign keys + indexes for salary component structures.
  Does NOT touch SalaryBillCodes.
*/

SET NOCOUNT ON;
GO

/* FKs for SalaryComponentRule */
IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SCR_SalaryComponent')
    BEGIN
        ALTER TABLE dbo.SalaryComponentRule
            ADD CONSTRAINT FK_SCR_SalaryComponent
                FOREIGN KEY (SalaryComponentId)
                REFERENCES dbo.SalaryComponentMaster (SalaryComponentId);
        PRINT 'Created FK_SCR_SalaryComponent';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SCR_PayRevision')
       AND OBJECT_ID(N'dbo.PayRevisionMaster', N'U') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.SalaryComponentRule
            ADD CONSTRAINT FK_SCR_PayRevision
                FOREIGN KEY (PayRevisionId)
                REFERENCES dbo.PayRevisionMaster (PayRevisionId);
        PRINT 'Created FK_SCR_PayRevision';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SCR_CityClass')
       AND OBJECT_ID(N'dbo.CityClasses', N'U') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.SalaryComponentRule
            ADD CONSTRAINT FK_SCR_CityClass
                FOREIGN KEY (CityClassId)
                REFERENCES dbo.CityClasses (CityClassId);
        PRINT 'Created FK_SCR_CityClass';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SCR_Designation')
       AND OBJECT_ID(N'dbo.Designations', N'U') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.SalaryComponentRule
            ADD CONSTRAINT FK_SCR_Designation
                FOREIGN KEY (DesignationId)
                REFERENCES dbo.Designations (DesignationId);
        PRINT 'Created FK_SCR_Designation';
    END
END
GO

/* FKs for SalaryEmployeeComponentDetails */
IF OBJECT_ID(N'dbo.SalaryEmployeeComponentDetails', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SECD_SalaryEmployeeDetail')
       AND OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NOT NULL
    BEGIN
        /* PK column on SED is Id */
        ALTER TABLE dbo.SalaryEmployeeComponentDetails
            ADD CONSTRAINT FK_SECD_SalaryEmployeeDetail
                FOREIGN KEY (SalaryEmployeeDetailId)
                REFERENCES dbo.SalaryEmployeeDetails (Id);
        PRINT 'Created FK_SECD_SalaryEmployeeDetail';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_SECD_SalaryComponent')
       AND OBJECT_ID(N'dbo.SalaryComponentMaster', N'U') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.SalaryEmployeeComponentDetails
            ADD CONSTRAINT FK_SECD_SalaryComponent
                FOREIGN KEY (SalaryComponentId)
                REFERENCES dbo.SalaryComponentMaster (SalaryComponentId);
        PRINT 'Created FK_SECD_SalaryComponent';
    END
END
GO

/* Indexes */
IF OBJECT_ID(N'dbo.SalaryComponentMaster', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SCM_Active_DisplayOrder'
          AND object_id = OBJECT_ID(N'dbo.SalaryComponentMaster')
    )
        CREATE INDEX IX_SCM_Active_DisplayOrder
            ON dbo.SalaryComponentMaster (IsActive, DisplayOrder, ComponentCode);

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SCM_ComponentType'
          AND object_id = OBJECT_ID(N'dbo.SalaryComponentMaster')
    )
        CREATE INDEX IX_SCM_ComponentType
            ON dbo.SalaryComponentMaster (ComponentType);
END
GO

IF OBJECT_ID(N'dbo.SalaryComponentRule', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SCR_Component_Active_Dates'
          AND object_id = OBJECT_ID(N'dbo.SalaryComponentRule')
    )
        CREATE INDEX IX_SCR_Component_Active_Dates
            ON dbo.SalaryComponentRule (
                SalaryComponentId, IsActive, EffectiveFrom, EffectiveTo
            )
            INCLUDE (PayRevisionId, CityClassId, DesignationId, EmployeeClass, Percentage, FixedAmount);

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SCR_PayRevision'
          AND object_id = OBJECT_ID(N'dbo.SalaryComponentRule')
    )
        CREATE INDEX IX_SCR_PayRevision
            ON dbo.SalaryComponentRule (PayRevisionId);
END
GO

IF OBJECT_ID(N'dbo.SalaryEmployeeComponentDetails', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SECD_SalaryEmployeeDetailId'
          AND object_id = OBJECT_ID(N'dbo.SalaryEmployeeComponentDetails')
    )
        CREATE INDEX IX_SECD_SalaryEmployeeDetailId
            ON dbo.SalaryEmployeeComponentDetails (SalaryEmployeeDetailId);

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_SECD_SalaryComponentId'
          AND object_id = OBJECT_ID(N'dbo.SalaryEmployeeComponentDetails')
    )
        CREATE INDEX IX_SECD_SalaryComponentId
            ON dbo.SalaryEmployeeComponentDetails (SalaryComponentId);
END
GO

PRINT '12_SalaryComponentConstraints completed.';
GO
