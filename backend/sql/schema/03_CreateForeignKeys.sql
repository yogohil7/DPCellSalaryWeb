/*
  03_CreateForeignKeys.sql
  SAFE: add FKs only when missing and orphan-free.
*/

USE DPCELLSalaryWebDB;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    /* Institutes.DistrictId -> Districts */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Institutes_Districts')
       AND COL_LENGTH(N'dbo.Institutes', N'DistrictId') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Institutes i
            LEFT JOIN dbo.Districts d ON d.DistrictId = i.DistrictId
            WHERE i.DistrictId IS NOT NULL AND d.DistrictId IS NULL
        )
        BEGIN
            ALTER TABLE dbo.Institutes
            ADD CONSTRAINT FK_Institutes_Districts
                FOREIGN KEY (DistrictId) REFERENCES dbo.Districts (DistrictId);
            PRINT 'Created FK_Institutes_Districts';
        END
        ELSE PRINT 'SKIP FK_Institutes_Districts — orphan DistrictId values exist.';
    END

    /* Institutes.CityClassId -> CityClasses */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Institutes_CityClasses')
       AND COL_LENGTH(N'dbo.Institutes', N'CityClassId') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Institutes i
            LEFT JOIN dbo.CityClasses c ON c.CityClassId = i.CityClassId
            WHERE i.CityClassId IS NOT NULL AND c.CityClassId IS NULL
        )
        BEGIN
            ALTER TABLE dbo.Institutes
            ADD CONSTRAINT FK_Institutes_CityClasses
                FOREIGN KEY (CityClassId) REFERENCES dbo.CityClasses (CityClassId);
            PRINT 'Created FK_Institutes_CityClasses';
        END
        ELSE PRINT 'SKIP FK_Institutes_CityClasses — orphan CityClassId values exist.';
    END

    /* Institutes.SectionId already has FK_Institutes_Sections in current DB */

    /* PayMatrixMaster.PayRevisionId -> PayRevisionMaster */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_PayMatrixMaster_PayRevision')
       AND COL_LENGTH(N'dbo.PayMatrixMaster', N'PayRevisionId') IS NOT NULL
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.PayMatrixMaster m
            LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
            WHERE m.PayRevisionId IS NOT NULL AND r.PayRevisionId IS NULL
        )
        BEGIN
            ALTER TABLE dbo.PayMatrixMaster
            ADD CONSTRAINT FK_PayMatrixMaster_PayRevision
                FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);
            PRINT 'Created FK_PayMatrixMaster_PayRevision';
        END
        ELSE PRINT 'SKIP FK_PayMatrixMaster_PayRevision — orphans or all NULL.';
    END

    /* EmployeeMaster.PayRevisionId */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EmployeeMaster_PayRevision')
       AND COL_LENGTH(N'dbo.EmployeeMaster', N'PayRevisionId') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.EmployeeMaster
        ADD CONSTRAINT FK_EmployeeMaster_PayRevision
            FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);
        PRINT 'Created FK_EmployeeMaster_PayRevision';
    END

    /* EmployeeMaster.SectionId */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EmployeeMaster_Section')
       AND COL_LENGTH(N'dbo.EmployeeMaster', N'SectionId') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.EmployeeMaster
        ADD CONSTRAINT FK_EmployeeMaster_Section
            FOREIGN KEY (SectionId) REFERENCES dbo.Sections (SectionId);
        PRINT 'Created FK_EmployeeMaster_Section';
    END

    /* EmployeePayHistory FKs */
    IF OBJECT_ID(N'dbo.EmployeePayHistory', N'U') IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EPH_Employee')
            ALTER TABLE dbo.EmployeePayHistory
            ADD CONSTRAINT FK_EPH_Employee
                FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster (EmployeeId);

        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EPH_PayRevision')
            ALTER TABLE dbo.EmployeePayHistory
            ADD CONSTRAINT FK_EPH_PayRevision
                FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);

        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_EPH_PayMatrix')
            ALTER TABLE dbo.EmployeePayHistory
            ADD CONSTRAINT FK_EPH_PayMatrix
                FOREIGN KEY (PayMatrixId) REFERENCES dbo.PayMatrixMaster (PayMatrixId);

        PRINT 'EmployeePayHistory FKs ensured.';
    END

    /* Users.InstituteId */
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Users_Institutes')
       AND COL_LENGTH(N'dbo.Users', N'InstituteId') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.Users
        ADD CONSTRAINT FK_Users_Institutes
            FOREIGN KEY (InstituteId) REFERENCES dbo.Institutes (InstituteId);
        PRINT 'Created FK_Users_Institutes';
    END

    /* Optional allowance FKs (nullable columns) */
    IF COL_LENGTH(N'dbo.DAMaster', N'PayRevisionId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_DAMaster_PayRevision')
        ALTER TABLE dbo.DAMaster
        ADD CONSTRAINT FK_DAMaster_PayRevision
            FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);

    IF COL_LENGTH(N'dbo.HRAMaster', N'PayRevisionId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_HRAMaster_PayRevision')
        ALTER TABLE dbo.HRAMaster
        ADD CONSTRAINT FK_HRAMaster_PayRevision
            FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);

    IF COL_LENGTH(N'dbo.HRAMaster', N'CityClassId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_HRAMaster_CityClass')
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.HRAMaster h
            LEFT JOIN dbo.CityClasses c ON c.CityClassId = h.CityClassId
            WHERE h.CityClassId IS NOT NULL AND c.CityClassId IS NULL
        )
            ALTER TABLE dbo.HRAMaster
            ADD CONSTRAINT FK_HRAMaster_CityClass
                FOREIGN KEY (CityClassId) REFERENCES dbo.CityClasses (CityClassId);
    END

    IF COL_LENGTH(N'dbo.MedicalAllowanceMaster', N'PayRevisionId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Medical_PayRevision')
        ALTER TABLE dbo.MedicalAllowanceMaster
        ADD CONSTRAINT FK_Medical_PayRevision
            FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);

    IF COL_LENGTH(N'dbo.MedicalAllowanceMaster', N'DesignationId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Medical_Designation')
        ALTER TABLE dbo.MedicalAllowanceMaster
        ADD CONSTRAINT FK_Medical_Designation
            FOREIGN KEY (DesignationId) REFERENCES dbo.Designations (DesignationId);

    IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'PayRevisionId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TA_PayRevision')
        ALTER TABLE dbo.TransportAllowanceMaster
        ADD CONSTRAINT FK_TA_PayRevision
            FOREIGN KEY (PayRevisionId) REFERENCES dbo.PayRevisionMaster (PayRevisionId);

    IF COL_LENGTH(N'dbo.TransportAllowanceMaster', N'CityClassId') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TA_CityClass')
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.TransportAllowanceMaster t
            LEFT JOIN dbo.CityClasses c ON c.CityClassId = t.CityClassId
            WHERE t.CityClassId IS NOT NULL AND c.CityClassId IS NULL
        )
            ALTER TABLE dbo.TransportAllowanceMaster
            ADD CONSTRAINT FK_TA_CityClass
                FOREIGN KEY (CityClassId) REFERENCES dbo.CityClasses (CityClassId);
    END

    COMMIT TRANSACTION;
    PRINT '03_CreateForeignKeys completed.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(N'03_CreateForeignKeys failed: %s', 16, 1, @msg);
END CATCH
GO
