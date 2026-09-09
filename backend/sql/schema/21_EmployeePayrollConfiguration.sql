/*
  21_EmployeePayrollConfiguration.sql
  Employee-specific payroll applicability flags.
  Safe upgrade — no drops of existing tables/data.
*/

SET NOCOUNT ON;
GO

/* ------------------------------------------------------------------ */
/* Optional: HRA previous-location flag on existing HRAMaster         */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.HRAMaster', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.HRAMaster', N'IsPreviousLocation') IS NULL
BEGIN
    ALTER TABLE dbo.HRAMaster
    ADD IsPreviousLocation BIT NOT NULL
        CONSTRAINT DF_HRAMaster_IsPreviousLocation DEFAULT (0);
    PRINT 'HRAMaster.IsPreviousLocation added.';
END
GO

/* ------------------------------------------------------------------ */
/* Table: EmployeePayrollConfiguration                                */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.EmployeePayrollConfiguration', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeePayrollConfiguration (
        Id INT IDENTITY(1,1) NOT NULL,
        EmployeeId INT NOT NULL,
        MedicalAllowanceApplicable BIT NOT NULL
            CONSTRAINT DF_EPC_MA DEFAULT (0),
        TransportAllowanceApplicable BIT NOT NULL
            CONSTRAINT DF_EPC_TA DEFAULT (0),
        HraPreviousLocationApplicable BIT NOT NULL
            CONSTRAINT DF_EPC_HRAPrev DEFAULT (0),
        ProfessionalTaxApplicable BIT NOT NULL
            CONSTRAINT DF_EPC_PT DEFAULT (0),
        NppaApplicable NVARCHAR(10) NOT NULL
            CONSTRAINT DF_EPC_NPPA DEFAULT (N'NA')
            CONSTRAINT CK_EPC_NPPA CHECK (NppaApplicable IN (N'NA', N'YES', N'NO')),
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_EPC_IsActive DEFAULT (1),
        CreatedDate DATETIME2(0) NOT NULL
            CONSTRAINT DF_EPC_CreatedDate DEFAULT (SYSDATETIME()),
        CreatedBy NVARCHAR(100) NULL,
        ModifiedDate DATETIME2(0) NULL,
        ModifiedBy NVARCHAR(100) NULL,
        CONSTRAINT PK_EmployeePayrollConfiguration PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_EPC_Employee
            FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster (EmployeeId),
        CONSTRAINT CK_EPC_EffectiveRange
            CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
    );
    PRINT 'EmployeePayrollConfiguration created.';
END
ELSE
BEGIN
    /* Ensure ProfessionalTaxApplicable exists for earlier drafts */
    IF COL_LENGTH(N'dbo.EmployeePayrollConfiguration', N'ProfessionalTaxApplicable') IS NULL
    BEGIN
        ALTER TABLE dbo.EmployeePayrollConfiguration
        ADD ProfessionalTaxApplicable BIT NOT NULL
            CONSTRAINT DF_EPC_PT DEFAULT (0);
        PRINT 'EmployeePayrollConfiguration.ProfessionalTaxApplicable added.';
    END
END
GO

/* Indexes */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_EPC_EmployeeId' AND object_id = OBJECT_ID(N'dbo.EmployeePayrollConfiguration')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_EPC_EmployeeId
        ON dbo.EmployeePayrollConfiguration (EmployeeId)
        INCLUDE (IsActive, EffectiveFrom, EffectiveTo);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_EPC_Active_Employee' AND object_id = OBJECT_ID(N'dbo.EmployeePayrollConfiguration')
)
BEGIN
    /* One active row per employee (current applicability) */
    CREATE UNIQUE NONCLUSTERED INDEX IX_EPC_Active_Employee
        ON dbo.EmployeePayrollConfiguration (EmployeeId)
        WHERE IsActive = 1;
END
GO

/* Seed PROFESSIONAL_TAX + NPPA components if missing */
IF OBJECT_ID(N'dbo.SalaryComponentMaster', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.SalaryComponentMaster WHERE ComponentCode = N'PROFESSIONAL_TAX')
    BEGIN
        INSERT INTO dbo.SalaryComponentMaster (
            ComponentCode, ComponentName, ComponentType, CalculationType,
            IsEarning, IsDeduction, IsActive, DisplayOrder, RuleSource, CreatedBy
        )
        VALUES (
            N'PROFESSIONAL_TAX', N'Professional Tax', N'PROFESSIONAL_TAX', N'FIXED',
            0, 1, 1, 105, N'SalaryComponentRule', N'EPC_SEED'
        );
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.SalaryComponentMaster WHERE ComponentCode = N'NPPA')
    BEGIN
        INSERT INTO dbo.SalaryComponentMaster (
            ComponentCode, ComponentName, ComponentType, CalculationType,
            IsEarning, IsDeduction, IsActive, DisplayOrder, RuleSource, CreatedBy
        )
        VALUES (
            N'NPPA', N'NPPA', N'NPPA', N'FIXED',
            1, 0, 1, 65, N'SalaryComponentRule', N'EPC_SEED'
        );
    END
END
GO

/* ------------------------------------------------------------------ */
/* usp_EmployeePayrollConfiguration_Get                               */
/* ------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayrollConfiguration_Get
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.Id,
        c.EmployeeId,
        e.EmployeeCode,
        e.EmployeeName,
        e.EmployeeType,
        e.Status AS EmployeeStatus,
        ISNULL(e.IsActive, 1) AS EmployeeIsActive,
        d.DesignationName,
        i.InstituteCode,
        i.InstituteName,
        dist.DistrictName,
        ISNULL(cc.CityClassName, i.CityClass) AS CityClass,
        r.RevisionCode AS PayRevision,
        e.PayLevel,
        e.PayMatrixCellNo,
        e.BasicPay,
        c.MedicalAllowanceApplicable,
        c.TransportAllowanceApplicable,
        c.HraPreviousLocationApplicable,
        c.ProfessionalTaxApplicable,
        c.NppaApplicable,
        c.EffectiveFrom,
        c.EffectiveTo,
        c.IsActive,
        c.CreatedDate,
        c.CreatedBy,
        c.ModifiedDate,
        c.ModifiedBy
    FROM dbo.EmployeePayrollConfiguration c
    INNER JOIN dbo.EmployeeMaster e ON e.EmployeeId = c.EmployeeId
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.Districts dist ON dist.DistrictId = ISNULL(e.DistrictId, i.DistrictId)
    LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = ISNULL(e.CityClassId, i.CityClassId)
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
    WHERE c.Id = @Id;
END
GO

/* ------------------------------------------------------------------ */
/* usp_EmployeePayrollConfiguration_GetByEmployee                     */
/* ------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayrollConfiguration_GetByEmployee
    @EmployeeId INT,
    @AsOfDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @OnDate DATE = ISNULL(@AsOfDate, CAST(GETDATE() AS DATE));

    SELECT TOP 1
        c.Id,
        c.EmployeeId,
        e.EmployeeCode,
        e.EmployeeName,
        e.EmployeeType,
        e.Status AS EmployeeStatus,
        ISNULL(e.IsActive, 1) AS EmployeeIsActive,
        d.DesignationName,
        i.InstituteCode,
        i.InstituteName,
        dist.DistrictName,
        ISNULL(cc.CityClassName, i.CityClass) AS CityClass,
        r.RevisionCode AS PayRevision,
        e.PayLevel,
        e.PayMatrixCellNo,
        e.BasicPay,
        c.MedicalAllowanceApplicable,
        c.TransportAllowanceApplicable,
        c.HraPreviousLocationApplicable,
        c.ProfessionalTaxApplicable,
        c.NppaApplicable,
        c.EffectiveFrom,
        c.EffectiveTo,
        c.IsActive,
        c.CreatedDate,
        c.CreatedBy,
        c.ModifiedDate,
        c.ModifiedBy
    FROM dbo.EmployeePayrollConfiguration c
    INNER JOIN dbo.EmployeeMaster e ON e.EmployeeId = c.EmployeeId
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.Districts dist ON dist.DistrictId = ISNULL(e.DistrictId, i.DistrictId)
    LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = ISNULL(e.CityClassId, i.CityClassId)
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
    WHERE c.EmployeeId = @EmployeeId
      AND c.EffectiveFrom <= @OnDate
      AND (c.EffectiveTo IS NULL OR c.EffectiveTo >= @OnDate)
    ORDER BY c.EffectiveFrom DESC, c.Id DESC;
END
GO

/* ------------------------------------------------------------------ */
/* usp_EmployeePayrollConfiguration_List                              */
/* ------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayrollConfiguration_List
    @EmployeeId INT = NULL,
    @EmployeeName NVARCHAR(200) = NULL,
    @InstituteCode NVARCHAR(50) = NULL,
    @EmployeeType NVARCHAR(20) = NULL,
    @Status NVARCHAR(20) = NULL /* Active / Inactive / ALL */
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.Id,
        c.EmployeeId,
        e.EmployeeCode,
        e.EmployeeName,
        e.EmployeeType,
        d.DesignationName,
        i.InstituteCode,
        i.InstituteName,
        c.MedicalAllowanceApplicable,
        c.TransportAllowanceApplicable,
        c.HraPreviousLocationApplicable,
        c.ProfessionalTaxApplicable,
        c.NppaApplicable,
        c.EffectiveFrom,
        c.EffectiveTo,
        c.IsActive,
        c.CreatedDate,
        c.CreatedBy,
        c.ModifiedDate,
        c.ModifiedBy
    FROM dbo.EmployeePayrollConfiguration c
    INNER JOIN dbo.EmployeeMaster e ON e.EmployeeId = c.EmployeeId
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    WHERE (@EmployeeId IS NULL OR c.EmployeeId = @EmployeeId)
      AND (
            @EmployeeName IS NULL
            OR LTRIM(RTRIM(@EmployeeName)) = N''
            OR e.EmployeeName LIKE N'%' + LTRIM(RTRIM(@EmployeeName)) + N'%'
            OR e.EmployeeCode LIKE N'%' + LTRIM(RTRIM(@EmployeeName)) + N'%'
          )
      AND (
            @InstituteCode IS NULL
            OR LTRIM(RTRIM(@InstituteCode)) = N''
            OR i.InstituteCode LIKE N'%' + LTRIM(RTRIM(@InstituteCode)) + N'%'
          )
      AND (
            @EmployeeType IS NULL
            OR LTRIM(RTRIM(@EmployeeType)) = N''
            OR UPPER(e.EmployeeType) = UPPER(LTRIM(RTRIM(@EmployeeType)))
          )
      AND (
            @Status IS NULL
            OR UPPER(LTRIM(RTRIM(@Status))) IN (N'', N'ALL')
            OR (UPPER(LTRIM(RTRIM(@Status))) = N'ACTIVE' AND c.IsActive = 1)
            OR (UPPER(LTRIM(RTRIM(@Status))) = N'INACTIVE' AND c.IsActive = 0)
          )
    ORDER BY c.IsActive DESC, e.EmployeeName, c.EffectiveFrom DESC;
END
GO

/* ------------------------------------------------------------------ */
/* usp_EmployeePayrollConfiguration_Save                              */
/* ------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayrollConfiguration_Save
    @Id INT = NULL OUTPUT,
    @EmployeeId INT,
    @MedicalAllowanceApplicable BIT,
    @TransportAllowanceApplicable BIT,
    @HraPreviousLocationApplicable BIT,
    @ProfessionalTaxApplicable BIT,
    @NppaApplicable NVARCHAR(10),
    @EffectiveFrom DATE,
    @EffectiveTo DATE = NULL,
    @IsActive BIT = 1,
    @Actor NVARCHAR(100) = N'SYSTEM'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Nppa NVARCHAR(10) = UPPER(LTRIM(RTRIM(ISNULL(@NppaApplicable, N'NA'))));
    IF @Nppa NOT IN (N'NA', N'YES', N'NO')
    BEGIN
        RAISERROR(N'NPPA must be NA, YES or NO.', 16, 1);
        RETURN;
    END

    IF @EmployeeId IS NULL OR @EmployeeId <= 0
    BEGIN
        RAISERROR(N'EmployeeId is required.', 16, 1);
        RETURN;
    END

    IF @EffectiveFrom IS NULL
    BEGIN
        RAISERROR(N'EffectiveFrom is required.', 16, 1);
        RETURN;
    END

    IF @EffectiveTo IS NOT NULL AND @EffectiveTo < @EffectiveFrom
    BEGIN
        RAISERROR(N'EffectiveTo cannot be earlier than EffectiveFrom.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId)
    BEGIN
        RAISERROR(N'Employee does not exist.', 16, 1);
        RETURN;
    END

    IF EXISTS (
        SELECT 1
        FROM dbo.EmployeeMaster
        WHERE EmployeeId = @EmployeeId
          AND (
                UPPER(ISNULL(Status, N'Active')) = N'INACTIVE'
                OR ISNULL(IsActive, 1) = 0
              )
    )
    BEGIN
        RAISERROR(N'Cannot configure payroll for an inactive employee.', 16, 1);
        RETURN;
    END

    /* Overlap among OTHER active rows — only relevant when not auto-closing them */
    IF @IsActive = 1
       AND @Id IS NOT NULL
       AND @Id > 0
       AND EXISTS (
            SELECT 1
            FROM dbo.EmployeePayrollConfiguration x
            WHERE x.EmployeeId = @EmployeeId
              AND x.IsActive = 1
              AND x.Id <> @Id
              AND x.EffectiveFrom <= ISNULL(@EffectiveTo, '9999-12-31')
              AND ISNULL(x.EffectiveTo, '9999-12-31') >= @EffectiveFrom
       )
    BEGIN
        RAISERROR(N'An active payroll configuration already overlaps this effective period for the employee.', 16, 1);
        RETURN;
    END

    BEGIN TRANSACTION;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        /* Creating a new active row closes prior active configuration(s). */
        IF @IsActive = 1
        BEGIN
            UPDATE dbo.EmployeePayrollConfiguration
            SET IsActive = 0,
                EffectiveTo = CASE
                    WHEN EffectiveFrom >= @EffectiveFrom THEN EffectiveFrom
                    WHEN EffectiveTo IS NULL OR EffectiveTo >= @EffectiveFrom
                        THEN DATEADD(DAY, -1, @EffectiveFrom)
                    ELSE EffectiveTo
                END,
                ModifiedDate = SYSDATETIME(),
                ModifiedBy = @Actor
            WHERE EmployeeId = @EmployeeId
              AND IsActive = 1;
        END

        INSERT INTO dbo.EmployeePayrollConfiguration (
            EmployeeId,
            MedicalAllowanceApplicable,
            TransportAllowanceApplicable,
            HraPreviousLocationApplicable,
            ProfessionalTaxApplicable,
            NppaApplicable,
            EffectiveFrom,
            EffectiveTo,
            IsActive,
            CreatedBy
        )
        VALUES (
            @EmployeeId,
            @MedicalAllowanceApplicable,
            @TransportAllowanceApplicable,
            @HraPreviousLocationApplicable,
            @ProfessionalTaxApplicable,
            @Nppa,
            @EffectiveFrom,
            @EffectiveTo,
            @IsActive,
            @Actor
        );

        SET @Id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeePayrollConfiguration WHERE Id = @Id)
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR(N'Payroll configuration not found.', 16, 1);
            RETURN;
        END

        IF @IsActive = 1
        BEGIN
            UPDATE dbo.EmployeePayrollConfiguration
            SET IsActive = 0,
                ModifiedDate = SYSDATETIME(),
                ModifiedBy = @Actor
            WHERE EmployeeId = @EmployeeId
              AND IsActive = 1
              AND Id <> @Id;
        END

        UPDATE dbo.EmployeePayrollConfiguration
        SET
            MedicalAllowanceApplicable = @MedicalAllowanceApplicable,
            TransportAllowanceApplicable = @TransportAllowanceApplicable,
            HraPreviousLocationApplicable = @HraPreviousLocationApplicable,
            ProfessionalTaxApplicable = @ProfessionalTaxApplicable,
            NppaApplicable = @Nppa,
            EffectiveFrom = @EffectiveFrom,
            EffectiveTo = @EffectiveTo,
            IsActive = @IsActive,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @Actor
        WHERE Id = @Id;
    END

    COMMIT TRANSACTION;

    EXEC dbo.usp_EmployeePayrollConfiguration_Get @Id = @Id;
END
GO

/* ------------------------------------------------------------------ */
/* usp_EmployeePayrollConfiguration_Delete (soft deactivate)          */
/* ------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayrollConfiguration_Delete
    @Id INT,
    @Actor NVARCHAR(100) = N'SYSTEM'
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.EmployeePayrollConfiguration WHERE Id = @Id)
    BEGIN
        RAISERROR(N'Payroll configuration not found.', 16, 1);
        RETURN;
    END

    UPDATE dbo.EmployeePayrollConfiguration
    SET IsActive = 0,
        EffectiveTo = ISNULL(EffectiveTo, CAST(GETDATE() AS DATE)),
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = @Actor
    WHERE Id = @Id;

    EXEC dbo.usp_EmployeePayrollConfiguration_Get @Id = @Id;
END
GO

PRINT '21_EmployeePayrollConfiguration completed.';
GO
