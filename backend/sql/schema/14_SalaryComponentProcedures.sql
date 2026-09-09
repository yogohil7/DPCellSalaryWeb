/*
  14_SalaryComponentProcedures.sql
  Component + rule CRUD and salary calculation using:
    - PayMatrix / Employee Basic for BASIC
    - Existing DAMaster / HRAMaster / Medical / Transport (no duplication)
    - SalaryComponentRule for SPECIAL / PF / NPS / OTHER / fallbacks
  Does NOT modify SalaryBillCodes.
*/

SET NOCOUNT ON;
GO

/* =========================================================
   usp_SalaryComponent_GetAll
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponent_GetAll
    @ActiveOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        SalaryComponentId,
        ComponentCode,
        ComponentName,
        ComponentType,
        CalculationType,
        IsEarning,
        IsDeduction,
        IsActive,
        DisplayOrder,
        RuleSource,
        CreatedDate,
        CreatedBy,
        ModifiedDate,
        ModifiedBy
    FROM dbo.SalaryComponentMaster
    WHERE (@ActiveOnly = 0 OR IsActive = 1)
    ORDER BY ISNULL(DisplayOrder, 9999), ComponentCode;
END
GO

/* =========================================================
   usp_SalaryComponent_Save
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponent_Save
    @SalaryComponentId INT = NULL,
    @ComponentCode     NVARCHAR(50),
    @ComponentName     NVARCHAR(200),
    @ComponentType     NVARCHAR(30),
    @CalculationType   NVARCHAR(30),
    @IsEarning         BIT = 1,
    @IsDeduction       BIT = 0,
    @IsActive          BIT = 1,
    @DisplayOrder      INT = NULL,
    @RuleSource        NVARCHAR(50) = NULL,
    @UserName          NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @ComponentCode = UPPER(LTRIM(RTRIM(@ComponentCode)));
    SET @ComponentName = LTRIM(RTRIM(@ComponentName));
    SET @ComponentType = UPPER(LTRIM(RTRIM(@ComponentType)));
    SET @CalculationType = UPPER(LTRIM(RTRIM(@CalculationType)));
    SET @UserName = ISNULL(@UserName, N'SYSTEM');

    IF @ComponentCode IS NULL OR @ComponentCode = N''
    BEGIN
        RAISERROR(N'ComponentCode is required.', 16, 1);
        RETURN;
    END

    IF @ComponentName IS NULL OR @ComponentName = N''
    BEGIN
        RAISERROR(N'ComponentName is required.', 16, 1);
        RETURN;
    END

    IF @IsEarning = @IsDeduction
    BEGIN
        RAISERROR(N'Component must be either earning or deduction (not both/neither).', 16, 1);
        RETURN;
    END

    IF @SalaryComponentId IS NULL
    BEGIN
        IF EXISTS (
            SELECT 1 FROM dbo.SalaryComponentMaster WHERE ComponentCode = @ComponentCode
        )
        BEGIN
            RAISERROR(N'ComponentCode already exists.', 16, 1);
            RETURN;
        END

        INSERT INTO dbo.SalaryComponentMaster (
            ComponentCode, ComponentName, ComponentType, CalculationType,
            IsEarning, IsDeduction, IsActive, DisplayOrder, RuleSource, CreatedBy
        )
        VALUES (
            @ComponentCode, @ComponentName, @ComponentType, @CalculationType,
            @IsEarning, @IsDeduction, @IsActive, @DisplayOrder, @RuleSource, @UserName
        );

        SELECT SCOPE_IDENTITY() AS SalaryComponentId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.SalaryComponentMaster WHERE SalaryComponentId = @SalaryComponentId
        )
        BEGIN
            RAISERROR(N'SalaryComponent not found.', 16, 1);
            RETURN;
        END

        IF EXISTS (
            SELECT 1
            FROM dbo.SalaryComponentMaster
            WHERE ComponentCode = @ComponentCode
              AND SalaryComponentId <> @SalaryComponentId
        )
        BEGIN
            RAISERROR(N'ComponentCode already exists.', 16, 1);
            RETURN;
        END

        UPDATE dbo.SalaryComponentMaster
        SET
            ComponentCode = @ComponentCode,
            ComponentName = @ComponentName,
            ComponentType = @ComponentType,
            CalculationType = @CalculationType,
            IsEarning = @IsEarning,
            IsDeduction = @IsDeduction,
            IsActive = @IsActive,
            DisplayOrder = @DisplayOrder,
            RuleSource = @RuleSource,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE SalaryComponentId = @SalaryComponentId;

        SELECT @SalaryComponentId AS SalaryComponentId;
    END
END
GO

/* =========================================================
   usp_SalaryComponent_Delete  (soft-delete when in use)
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponent_Delete
    @SalaryComponentId INT,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @UserName = ISNULL(@UserName, N'SYSTEM');

    IF NOT EXISTS (
        SELECT 1 FROM dbo.SalaryComponentMaster WHERE SalaryComponentId = @SalaryComponentId
    )
    BEGIN
        RAISERROR(N'SalaryComponent not found.', 16, 1);
        RETURN;
    END

    IF EXISTS (
        SELECT 1 FROM dbo.SalaryComponentRule WHERE SalaryComponentId = @SalaryComponentId
    )
    OR EXISTS (
        SELECT 1 FROM dbo.SalaryEmployeeComponentDetails WHERE SalaryComponentId = @SalaryComponentId
    )
    BEGIN
        UPDATE dbo.SalaryComponentMaster
        SET IsActive = 0,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE SalaryComponentId = @SalaryComponentId;

        SELECT N'DEACTIVATED' AS Result;
        RETURN;
    END

    DELETE FROM dbo.SalaryComponentMaster
    WHERE SalaryComponentId = @SalaryComponentId;

    SELECT N'DELETED' AS Result;
END
GO

/* =========================================================
   usp_SalaryComponentRule_Get
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponentRule_Get
    @SalaryComponentId INT = NULL,
    @PayRevisionId INT = NULL,
    @AsOfDate DATE = NULL,
    @ActiveOnly BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @AsOfDate = ISNULL(@AsOfDate, CAST(GETDATE() AS DATE));

    SELECT
        r.SalaryComponentRuleId,
        r.SalaryComponentId,
        c.ComponentCode,
        c.ComponentName,
        r.PayRevisionId,
        pr.RevisionCode,
        pr.RevisionName,
        r.CityClassId,
        cc.CityClassName,
        r.DesignationId,
        d.DesignationName,
        r.EmployeeClass,
        r.EffectiveFrom,
        r.EffectiveTo,
        r.Percentage,
        r.FixedAmount,
        r.Formula,
        r.IsActive,
        r.CreatedDate,
        r.CreatedBy,
        r.ModifiedDate,
        r.ModifiedBy
    FROM dbo.SalaryComponentRule r
    INNER JOIN dbo.SalaryComponentMaster c ON c.SalaryComponentId = r.SalaryComponentId
    LEFT JOIN dbo.PayRevisionMaster pr ON pr.PayRevisionId = r.PayRevisionId
    LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = r.CityClassId
    LEFT JOIN dbo.Designations d ON d.DesignationId = r.DesignationId
    WHERE (@SalaryComponentId IS NULL OR r.SalaryComponentId = @SalaryComponentId)
      AND (@PayRevisionId IS NULL OR r.PayRevisionId IS NULL OR r.PayRevisionId = @PayRevisionId)
      AND (@ActiveOnly = 0 OR r.IsActive = 1)
      AND r.EffectiveFrom <= @AsOfDate
      AND (r.EffectiveTo IS NULL OR r.EffectiveTo >= @AsOfDate)
    ORDER BY c.DisplayOrder, r.EffectiveFrom DESC, r.SalaryComponentRuleId DESC;
END
GO

/* =========================================================
   usp_SalaryComponentRule_Save
   Blocks overlapping active rules for same applicability keys.
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponentRule_Save
    @SalaryComponentRuleId INT = NULL,
    @SalaryComponentId     INT,
    @PayRevisionId         INT = NULL,
    @CityClassId           INT = NULL,
    @DesignationId         INT = NULL,
    @EmployeeClass         NVARCHAR(50) = NULL,
    @EffectiveFrom         DATE,
    @EffectiveTo           DATE = NULL,
    @Percentage            DECIMAL(10,4) = NULL,
    @FixedAmount           DECIMAL(18,2) = NULL,
    @Formula               NVARCHAR(MAX) = NULL,
    @IsActive              BIT = 1,
    @UserName              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @UserName = ISNULL(@UserName, N'SYSTEM');
    SET @EmployeeClass = NULLIF(LTRIM(RTRIM(@EmployeeClass)), N'');

    IF @SalaryComponentId IS NULL
       OR NOT EXISTS (SELECT 1 FROM dbo.SalaryComponentMaster WHERE SalaryComponentId = @SalaryComponentId)
    BEGIN
        RAISERROR(N'Valid SalaryComponentId is required.', 16, 1);
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

    IF @IsActive = 1
       AND EXISTS (
            SELECT 1
            FROM dbo.SalaryComponentRule x
            WHERE x.SalaryComponentId = @SalaryComponentId
              AND x.IsActive = 1
              AND (@SalaryComponentRuleId IS NULL OR x.SalaryComponentRuleId <> @SalaryComponentRuleId)
              AND ISNULL(x.PayRevisionId, -1) = ISNULL(@PayRevisionId, -1)
              AND ISNULL(x.CityClassId, -1) = ISNULL(@CityClassId, -1)
              AND ISNULL(x.DesignationId, -1) = ISNULL(@DesignationId, -1)
              AND ISNULL(x.EmployeeClass, N'') = ISNULL(@EmployeeClass, N'')
              AND x.EffectiveFrom <= ISNULL(@EffectiveTo, CONVERT(DATE, '9999-12-31'))
              AND ISNULL(x.EffectiveTo, CONVERT(DATE, '9999-12-31')) >= @EffectiveFrom
       )
    BEGIN
        RAISERROR(N'Duplicate active SalaryComponentRule exists for the same applicability period.', 16, 1);
        RETURN;
    END

    IF @SalaryComponentRuleId IS NULL
    BEGIN
        INSERT INTO dbo.SalaryComponentRule (
            SalaryComponentId, PayRevisionId, CityClassId, DesignationId, EmployeeClass,
            EffectiveFrom, EffectiveTo, Percentage, FixedAmount, Formula, IsActive, CreatedBy
        )
        VALUES (
            @SalaryComponentId, @PayRevisionId, @CityClassId, @DesignationId, @EmployeeClass,
            @EffectiveFrom, @EffectiveTo, @Percentage, @FixedAmount, @Formula, @IsActive, @UserName
        );

        SELECT SCOPE_IDENTITY() AS SalaryComponentRuleId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.SalaryComponentRule WHERE SalaryComponentRuleId = @SalaryComponentRuleId
        )
        BEGIN
            RAISERROR(N'SalaryComponentRule not found.', 16, 1);
            RETURN;
        END

        UPDATE dbo.SalaryComponentRule
        SET
            SalaryComponentId = @SalaryComponentId,
            PayRevisionId = @PayRevisionId,
            CityClassId = @CityClassId,
            DesignationId = @DesignationId,
            EmployeeClass = @EmployeeClass,
            EffectiveFrom = @EffectiveFrom,
            EffectiveTo = @EffectiveTo,
            Percentage = @Percentage,
            FixedAmount = @FixedAmount,
            Formula = @Formula,
            IsActive = @IsActive,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE SalaryComponentRuleId = @SalaryComponentRuleId;

        SELECT @SalaryComponentRuleId AS SalaryComponentRuleId;
    END
END
GO

/* =========================================================
   usp_SalaryComponentRule_Delete
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_SalaryComponentRule_Delete
    @SalaryComponentRuleId INT,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @UserName = ISNULL(@UserName, N'SYSTEM');

    IF NOT EXISTS (
        SELECT 1 FROM dbo.SalaryComponentRule WHERE SalaryComponentRuleId = @SalaryComponentRuleId
    )
    BEGIN
        RAISERROR(N'SalaryComponentRule not found.', 16, 1);
        RETURN;
    END

    /* Soft-delete preferred to keep history */
    UPDATE dbo.SalaryComponentRule
    SET IsActive = 0,
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = @UserName
    WHERE SalaryComponentRuleId = @SalaryComponentRuleId;

    SELECT N'DEACTIVATED' AS Result;
END
GO

/* =========================================================
   usp_Salary_GetEmployeeCalculation
   One row per active component. Existing DA/HRA/Medical/TA
   masters remain the rate source (not copied into Rule table).
   ========================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_Salary_GetEmployeeCalculation
    @EmployeeId INT,
    @AsOfDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @AsOfDate = ISNULL(@AsOfDate, CAST(GETDATE() AS DATE));

    IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId)
    BEGIN
        RAISERROR(N'Employee not found.', 16, 1);
        RETURN;
    END;

    ;WITH Emp AS (
        SELECT
            e.EmployeeId,
            e.EmployeeCode,
            e.EmployeeName,
            e.InstituteId,
            e.DesignationId,
            e.PayRevisionId,
            e.PayMatrixId,
            COALESCE(e.BasicPay, m.BasicPay, 0) AS BasicPay,
            m.Level,
            m.CellNo,
            r.RevisionCode,
            r.RevisionName,
            COALESCE(e.CityClassId, i.CityClassId) AS CityClassId,
            des.EmployeeClass,
            i.InstituteCode,
            i.InstituteName
        FROM dbo.EmployeeMaster e
        LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
        LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
        LEFT JOIN dbo.PayMatrixMaster m ON m.PayMatrixId = e.PayMatrixId
        LEFT JOIN dbo.Designations des ON des.DesignationId = e.DesignationId
        WHERE e.EmployeeId = @EmployeeId
    ),
    DARule AS (
        SELECT TOP 1 d.DAPercentage
        FROM Emp e
        INNER JOIN dbo.DAMaster d ON 1 = 1
        WHERE (d.PayRevisionId IS NULL OR d.PayRevisionId = e.PayRevisionId)
          AND d.EffectiveFrom <= @AsOfDate
          AND (d.EffectiveTo IS NULL OR d.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(d.Status, N'Active')) = N'ACTIVE'
        ORDER BY
            CASE WHEN d.PayRevisionId = e.PayRevisionId THEN 0 ELSE 1 END,
            d.EffectiveFrom DESC
    ),
    HRARule AS (
        SELECT TOP 1 h.HRAPercentage
        FROM Emp e
        INNER JOIN dbo.HRAMaster h ON 1 = 1
        WHERE (h.PayRevisionId IS NULL OR h.PayRevisionId = e.PayRevisionId)
          AND (
                h.CityClassId IS NULL
                OR h.CityClassId = e.CityClassId
                OR EXISTS (
                    SELECT 1 FROM dbo.CityClasses cc
                    WHERE cc.CityClassId = e.CityClassId
                      AND cc.CityClassName = h.CityClass
                )
              )
          AND ISNULL(h.EffectiveFrom, h.EffectiveDate) <= @AsOfDate
          AND (h.EffectiveTo IS NULL OR h.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(h.Status, N'Active')) = N'ACTIVE'
        ORDER BY
            CASE WHEN h.CityClassId = e.CityClassId THEN 0 ELSE 1 END,
            CASE WHEN h.PayRevisionId = e.PayRevisionId THEN 0 ELSE 1 END,
            ISNULL(h.EffectiveFrom, h.EffectiveDate) DESC
    ),
    MedRule AS (
        SELECT TOP 1 med.Amount
        FROM Emp e
        INNER JOIN dbo.MedicalAllowanceMaster med ON 1 = 1
        WHERE (med.PayRevisionId IS NULL OR med.PayRevisionId = e.PayRevisionId)
          AND (med.DesignationId IS NULL OR med.DesignationId = e.DesignationId)
          AND med.EffectiveFrom <= @AsOfDate
          AND (med.EffectiveTo IS NULL OR med.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(med.Status, N'Active')) = N'ACTIVE'
        ORDER BY
            CASE WHEN med.DesignationId = e.DesignationId THEN 0 ELSE 1 END,
            CASE WHEN med.PayRevisionId = e.PayRevisionId THEN 0 ELSE 1 END,
            med.EffectiveFrom DESC
    ),
    TARule AS (
        SELECT TOP 1 t.TAAmount
        FROM Emp e
        INNER JOIN dbo.TransportAllowanceMaster t ON 1 = 1
        WHERE (t.PayRevisionId IS NULL OR t.PayRevisionId = e.PayRevisionId)
          AND (
                t.CityClassId IS NULL
                OR t.CityClassId = e.CityClassId
                OR EXISTS (
                    SELECT 1 FROM dbo.CityClasses cc
                    WHERE cc.CityClassId = e.CityClassId
                      AND cc.CityClassName = t.CityClass
                )
              )
          AND (t.EmployeeClass IS NULL OR t.EmployeeClass = e.EmployeeClass)
          AND t.EffectiveDate <= @AsOfDate
          AND UPPER(ISNULL(t.Status, N'Active')) = N'ACTIVE'
        ORDER BY
            CASE WHEN t.CityClassId = e.CityClassId THEN 0 ELSE 1 END,
            CASE WHEN t.EmployeeClass = e.EmployeeClass THEN 0 ELSE 1 END,
            CASE WHEN t.PayRevisionId = e.PayRevisionId THEN 0 ELSE 1 END,
            t.EffectiveDate DESC
    ),
    CompRule AS (
        SELECT
            r.SalaryComponentId,
            r.Percentage,
            r.FixedAmount,
            r.Formula,
            ROW_NUMBER() OVER (
                PARTITION BY r.SalaryComponentId
                ORDER BY
                    CASE WHEN r.DesignationId IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN r.CityClassId IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN r.EmployeeClass IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN r.PayRevisionId IS NOT NULL THEN 0 ELSE 1 END,
                    r.EffectiveFrom DESC,
                    r.SalaryComponentRuleId DESC
            ) AS rn
        FROM Emp e
        INNER JOIN dbo.SalaryComponentRule r ON r.IsActive = 1
        WHERE r.EffectiveFrom <= @AsOfDate
          AND (r.EffectiveTo IS NULL OR r.EffectiveTo >= @AsOfDate)
          AND (r.PayRevisionId IS NULL OR r.PayRevisionId = e.PayRevisionId)
          AND (r.CityClassId IS NULL OR r.CityClassId = e.CityClassId)
          AND (r.DesignationId IS NULL OR r.DesignationId = e.DesignationId)
          AND (r.EmployeeClass IS NULL OR r.EmployeeClass = e.EmployeeClass)
    ),
    Calc AS (
        SELECT
            e.EmployeeId,
            e.EmployeeCode,
            e.EmployeeName,
            e.PayRevisionId,
            e.RevisionName AS PayRevisionName,
            e.PayMatrixId,
            e.Level,
            e.CellNo,
            e.BasicPay,
            c.SalaryComponentId,
            c.ComponentCode,
            c.ComponentName,
            c.ComponentType,
            c.CalculationType,
            c.IsEarning,
            c.IsDeduction,
            c.DisplayOrder,
            c.RuleSource,
            CAST(
                CASE
                    WHEN c.ComponentCode = N'BASIC' THEN e.BasicPay
                    WHEN c.ComponentCode = N'DA' THEN
                        CAST(e.BasicPay * ISNULL((SELECT DAPercentage FROM DARule), 0) / 100.0 AS DECIMAL(18,2))
                    WHEN c.ComponentCode = N'HRA' THEN
                        CAST(e.BasicPay * ISNULL((SELECT HRAPercentage FROM HRARule), 0) / 100.0 AS DECIMAL(18,2))
                    WHEN c.ComponentCode = N'MEDICAL' THEN
                        ISNULL((SELECT Amount FROM MedRule), ISNULL(cr.FixedAmount, 0))
                    WHEN c.ComponentCode = N'TRANSPORT' THEN
                        ISNULL((SELECT TAAmount FROM TARule), ISNULL(cr.FixedAmount, 0))
                    WHEN c.CalculationType = N'FIXED' THEN ISNULL(cr.FixedAmount, 0)
                    WHEN c.CalculationType = N'PERCENTAGE_OF_BASIC' THEN
                        CAST(e.BasicPay * ISNULL(cr.Percentage, 0) / 100.0 AS DECIMAL(18,2))
                    WHEN c.CalculationType = N'PERCENTAGE_OF_BASIC_DA' THEN
                        CAST(
                            (e.BasicPay + CAST(e.BasicPay * ISNULL((SELECT DAPercentage FROM DARule), 0) / 100.0 AS DECIMAL(18,2)))
                            * ISNULL(cr.Percentage, 0) / 100.0
                        AS DECIMAL(18,2))
                    WHEN c.CalculationType IN (N'MANUAL', N'FORMULA') THEN ISNULL(cr.FixedAmount, 0)
                    ELSE ISNULL(cr.FixedAmount, 0)
                END
            AS DECIMAL(18,2)) AS CalculatedAmount,
            CAST(
                CASE
                    WHEN c.ComponentCode = N'DA' THEN (SELECT DAPercentage FROM DARule)
                    WHEN c.ComponentCode = N'HRA' THEN (SELECT HRAPercentage FROM HRARule)
                    ELSE cr.Percentage
                END
            AS DECIMAL(10,4)) AS Rate,
            CAST(
                CASE
                    WHEN c.ComponentCode IN (N'DA', N'HRA', N'BASIC') THEN e.BasicPay
                    WHEN c.CalculationType = N'PERCENTAGE_OF_BASIC' THEN e.BasicPay
                    WHEN c.CalculationType = N'PERCENTAGE_OF_BASIC_DA' THEN
                        e.BasicPay + CAST(e.BasicPay * ISNULL((SELECT DAPercentage FROM DARule), 0) / 100.0 AS DECIMAL(18,2))
                    ELSE NULL
                END
            AS DECIMAL(18,2)) AS CalculationBase
        FROM Emp e
        CROSS JOIN dbo.SalaryComponentMaster c
        LEFT JOIN CompRule cr
            ON cr.SalaryComponentId = c.SalaryComponentId
           AND cr.rn = 1
        WHERE c.IsActive = 1
    ),
    Totals AS (
        SELECT
            SUM(CASE WHEN IsEarning = 1 THEN CalculatedAmount ELSE 0 END) AS GrossEarnings,
            SUM(CASE WHEN IsDeduction = 1 THEN CalculatedAmount ELSE 0 END) AS TotalDeductions
        FROM Calc
    )
    SELECT
        c.EmployeeId,
        c.EmployeeCode,
        c.EmployeeName,
        c.PayRevisionId,
        c.PayRevisionName,
        c.PayMatrixId,
        c.Level,
        c.CellNo,
        c.BasicPay,
        c.ComponentCode,
        c.ComponentName,
        c.CalculationType,
        c.Rate,
        c.CalculationBase,
        c.CalculatedAmount,
        t.GrossEarnings,
        t.TotalDeductions,
        CAST(t.GrossEarnings - t.TotalDeductions AS DECIMAL(18,2)) AS NetSalary
    FROM Calc c
    CROSS JOIN Totals t
    ORDER BY ISNULL(c.DisplayOrder, 9999), c.ComponentCode;
END
GO

PRINT '14_SalaryComponentProcedures completed.';
GO
