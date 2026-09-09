/*
  08_CreateStoredProcedures.sql
  CREATE OR ALTER — never duplicates.
*/

USE DPCELLSalaryWebDB;
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayRevision_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        PayRevisionId,
        SrNo,
        RevisionCode AS PayRevisionCode,
        RevisionName AS PayRevisionName,
        EffectiveFrom AS RevisionFromDate,
        EffectiveTo AS RevisionToDate,
        Description,
        Status,
        IsActive,
        CreatedDate,
        CreatedBy,
        ModifiedDate,
        ModifiedBy
    FROM dbo.PayRevisionMaster
    WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
       OR ISNULL(IsActive, 1) = 1
    ORDER BY EffectiveFrom DESC, PayRevisionId DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayRevision_Save
    @PayRevisionId INT = NULL,
    @SrNo INT = NULL,
    @RevisionCode NVARCHAR(50),
    @RevisionName NVARCHAR(200),
    @EffectiveFrom DATE = NULL,
    @EffectiveTo DATE = NULL,
    @Description NVARCHAR(500) = NULL,
    @Status NVARCHAR(20) = N'Active',
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @RevisionCode IS NULL OR LTRIM(RTRIM(@RevisionCode)) = N''
    BEGIN
        RAISERROR(N'RevisionCode is required.', 16, 1);
        RETURN;
    END

    IF @PayRevisionId IS NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.PayRevisionMaster WHERE RevisionCode = @RevisionCode)
        BEGIN
            RAISERROR(N'Pay Revision Code already exists.', 16, 1);
            RETURN;
        END

        INSERT INTO dbo.PayRevisionMaster
            (SrNo, RevisionCode, RevisionName, EffectiveFrom, EffectiveTo, Description, Status, IsActive, CreatedBy)
        VALUES
            (
                @SrNo,
                @RevisionCode,
                @RevisionName,
                @EffectiveFrom,
                @EffectiveTo,
                @Description,
                @Status,
                CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
                @UserName
            );

        SELECT SCOPE_IDENTITY() AS PayRevisionId;
    END
    ELSE
    BEGIN
        UPDATE dbo.PayRevisionMaster
        SET
            SrNo = @SrNo,
            RevisionCode = @RevisionCode,
            RevisionName = @RevisionName,
            EffectiveFrom = @EffectiveFrom,
            EffectiveTo = @EffectiveTo,
            Description = @Description,
            Status = @Status,
            IsActive = CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
            ModifiedDate = GETDATE(),
            ModifiedBy = @UserName
        WHERE PayRevisionId = @PayRevisionId;

        SELECT @PayRevisionId AS PayRevisionId;
    END
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayRevision_Delete
    @PayRevisionId INT,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.PayMatrixMaster WHERE PayRevisionId = @PayRevisionId)
       OR EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE PayRevisionId = @PayRevisionId)
       OR EXISTS (SELECT 1 FROM dbo.EmployeePayHistory WHERE PayRevisionId = @PayRevisionId)
    BEGIN
        UPDATE dbo.PayRevisionMaster
        SET Status = N'Inactive',
            IsActive = 0,
            ModifiedDate = GETDATE(),
            ModifiedBy = @UserName
        WHERE PayRevisionId = @PayRevisionId;

        SELECT N'SOFT_DELETED' AS Result;
        RETURN;
    END

    UPDATE dbo.PayRevisionMaster
    SET Status = N'Inactive',
        IsActive = 0,
        ModifiedDate = GETDATE(),
        ModifiedBy = @UserName
    WHERE PayRevisionId = @PayRevisionId;

    SELECT N'SOFT_DELETED' AS Result;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_GetByRevision
    @PayRevisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        PayMatrixId,
        PayRevisionId,
        PayCommission,
        Level,
        CellNo,
        BasicPay,
        EffectiveDate,
        Status,
        IsActive
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY Level, CellNo;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Save
    @PayMatrixId INT = NULL,
    @PayRevisionId INT,
    @PayCommission NVARCHAR(100) = NULL,
    @Level INT,
    @CellNo INT,
    @BasicPay DECIMAL(18,2),
    @EffectiveDate DATE = NULL,
    @Status NVARCHAR(20) = N'Active',
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @PayRevisionId IS NULL OR @Level IS NULL OR @CellNo IS NULL
    BEGIN
        RAISERROR(N'PayRevisionId, Level and CellNo are required.', 16, 1);
        RETURN;
    END

    IF EXISTS (
        SELECT 1 FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Level
          AND CellNo = @CellNo
          AND (@PayMatrixId IS NULL OR PayMatrixId <> @PayMatrixId)
    )
    BEGIN
        RAISERROR(N'Duplicate Pay Matrix row for PayRevisionId + Level + CellNo.', 16, 1);
        RETURN;
    END

    IF @PayMatrixId IS NULL
    BEGIN
        INSERT INTO dbo.PayMatrixMaster
            (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
        VALUES
            (
                @PayRevisionId,
                @PayCommission,
                @Level,
                @CellNo,
                @BasicPay,
                @EffectiveDate,
                @Status,
                CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
                @UserName
            );
        SELECT SCOPE_IDENTITY() AS PayMatrixId;
    END
    ELSE
    BEGIN
        UPDATE dbo.PayMatrixMaster
        SET
            PayRevisionId = @PayRevisionId,
            PayCommission = @PayCommission,
            Level = @Level,
            CellNo = @CellNo,
            BasicPay = @BasicPay,
            EffectiveDate = @EffectiveDate,
            Status = @Status,
            IsActive = CASE WHEN UPPER(@Status) = N'ACTIVE' THEN 1 ELSE 0 END,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE PayMatrixId = @PayMatrixId;

        SELECT @PayMatrixId AS PayMatrixId;
    END
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Delete
    @PayMatrixId INT,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.PayMatrixMaster
    SET Status = N'Inactive',
        IsActive = 0,
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = @UserName
    WHERE PayMatrixId = @PayMatrixId;

    SELECT N'SOFT_DELETED' AS Result;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_GetBasicPay
    @PayRevisionId INT,
    @Level INT,
    @CellNo INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        PayMatrixId,
        PayRevisionId,
        Level,
        CellNo,
        BasicPay
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Level
      AND CellNo = @CellNo
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE';
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayHistory_Get
    @EmployeeId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        h.*,
        r.RevisionCode,
        r.RevisionName,
        m.Level AS MatrixLevel,
        m.CellNo AS MatrixCellNo
    FROM dbo.EmployeePayHistory h
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = h.PayRevisionId
    LEFT JOIN dbo.PayMatrixMaster m ON m.PayMatrixId = h.PayMatrixId
    WHERE h.EmployeeId = @EmployeeId
    ORDER BY h.EffectiveFrom DESC, h.EmployeePayHistoryId DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_EmployeePayHistory_Save
    @EmployeeId INT,
    @PayRevisionId INT = NULL,
    @PayMatrixId INT = NULL,
    @Level INT = NULL,
    @CellNo INT = NULL,
    @BasicPay DECIMAL(18,2),
    @EffectiveFrom DATE,
    @EffectiveTo DATE = NULL,
    @Reason NVARCHAR(200) = NULL,
    @OrderNo NVARCHAR(100) = NULL,
    @Remarks NVARCHAR(500) = NULL,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    /* Close prior open history */
    UPDATE dbo.EmployeePayHistory
    SET EffectiveTo = DATEADD(DAY, -1, @EffectiveFrom)
    WHERE EmployeeId = @EmployeeId
      AND EffectiveTo IS NULL
      AND EffectiveFrom < @EffectiveFrom;

    INSERT INTO dbo.EmployeePayHistory
        (EmployeeId, PayRevisionId, PayMatrixId, Level, CellNo, BasicPay,
         EffectiveFrom, EffectiveTo, Reason, OrderNo, Remarks, CreatedBy)
    VALUES
        (@EmployeeId, @PayRevisionId, @PayMatrixId, @Level, @CellNo, @BasicPay,
         @EffectiveFrom, @EffectiveTo, @Reason, @OrderNo, @Remarks, @UserName);

    /* Sync current employee pointers */
    UPDATE dbo.EmployeeMaster
    SET
        PayRevisionId = COALESCE(@PayRevisionId, PayRevisionId),
        PayMatrixId = COALESCE(@PayMatrixId, PayMatrixId),
        BasicPay = @BasicPay,
        EffectiveDate = @EffectiveFrom,
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = @UserName
    WHERE EmployeeId = @EmployeeId;

    SELECT SCOPE_IDENTITY() AS EmployeePayHistoryId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Salary_GetEmployeeCalculation
    @EmployeeId INT,
    @AsOfDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @AsOfDate = ISNULL(@AsOfDate, CAST(GETDATE() AS DATE));

    SELECT
        e.EmployeeId,
        e.EmployeeCode,
        e.EmployeeName,
        e.InstituteId,
        i.InstituteCode,
        i.InstituteName,
        e.PayRevisionId,
        r.RevisionCode,
        r.RevisionName,
        e.PayMatrixId,
        m.Level,
        m.CellNo,
        COALESCE(e.BasicPay, m.BasicPay) AS BasicPay,
        da.DAPercentage,
        hra.HRAPercentage,
        med.Amount AS MedicalAllowance,
        ta.TAAmount AS TransportAllowance,
        CAST(COALESCE(e.BasicPay, m.BasicPay) * ISNULL(da.DAPercentage, 0) / 100.0 AS DECIMAL(18,2)) AS DAAmount,
        CAST(COALESCE(e.BasicPay, m.BasicPay) * ISNULL(hra.HRAPercentage, 0) / 100.0 AS DECIMAL(18,2)) AS HRAAmount
    FROM dbo.EmployeeMaster e
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
    LEFT JOIN dbo.PayMatrixMaster m ON m.PayMatrixId = e.PayMatrixId
    OUTER APPLY (
        SELECT TOP 1 d.DAPercentage
        FROM dbo.DAMaster d
        WHERE (d.PayRevisionId IS NULL OR d.PayRevisionId = e.PayRevisionId)
          AND d.EffectiveFrom <= @AsOfDate
          AND (d.EffectiveTo IS NULL OR d.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(d.Status, N'Active')) = N'ACTIVE'
        ORDER BY d.EffectiveFrom DESC
    ) da
    OUTER APPLY (
        SELECT TOP 1 h.HRAPercentage
        FROM dbo.HRAMaster h
        WHERE (h.PayRevisionId IS NULL OR h.PayRevisionId = e.PayRevisionId)
          AND (h.CityClassId IS NULL OR h.CityClassId = i.CityClassId OR h.CityClass = i.CityClass)
          AND ISNULL(h.EffectiveFrom, h.EffectiveDate) <= @AsOfDate
          AND (h.EffectiveTo IS NULL OR h.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(h.Status, N'Active')) = N'ACTIVE'
        ORDER BY ISNULL(h.EffectiveFrom, h.EffectiveDate) DESC
    ) hra
    OUTER APPLY (
        SELECT TOP 1 med.Amount
        FROM dbo.MedicalAllowanceMaster med
        WHERE (med.PayRevisionId IS NULL OR med.PayRevisionId = e.PayRevisionId)
          AND med.EffectiveFrom <= @AsOfDate
          AND (med.EffectiveTo IS NULL OR med.EffectiveTo >= @AsOfDate)
          AND UPPER(ISNULL(med.Status, N'Active')) = N'ACTIVE'
        ORDER BY med.EffectiveFrom DESC
    ) med
    OUTER APPLY (
        SELECT TOP 1 t.TAAmount
        FROM dbo.TransportAllowanceMaster t
        WHERE (t.PayRevisionId IS NULL OR t.PayRevisionId = e.PayRevisionId)
          AND (t.CityClassId IS NULL OR t.CityClassId = i.CityClassId OR t.CityClass = i.CityClass)
          AND t.EffectiveDate <= @AsOfDate
          AND UPPER(ISNULL(t.Status, N'Active')) = N'ACTIVE'
        ORDER BY t.EffectiveDate DESC
    ) ta
    WHERE e.EmployeeId = @EmployeeId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_EmployeeMaster_GetMasters
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DesignationId, DesignationCode, DesignationName, DesignationType, EmployeeClass
    FROM dbo.Designations
    WHERE Status = N'Active'
    ORDER BY DesignationName;

    SELECT InstituteId, InstituteCode, InstituteName, DistrictId, CityClassId, District, CityClass, SectionId
    FROM dbo.Institutes
    WHERE Status = N'Active'
    ORDER BY InstituteCode;

    SELECT DistrictId, DistrictName
    FROM dbo.Districts
    WHERE Status = N'Active'
    ORDER BY DistrictName;

    SELECT CityClassId, SrNo, CityClassName
    FROM dbo.CityClasses
    WHERE Status = N'Active'
    ORDER BY SrNo;

    SELECT SectionId, SrNo, SectionCode, SectionName, Status
    FROM dbo.Sections
    WHERE UPPER(Status) = N'ACTIVE'
    ORDER BY SrNo, SectionName;

    SELECT PayRevisionId, RevisionCode, RevisionName, EffectiveFrom, EffectiveTo, Status
    FROM dbo.PayRevisionMaster
    WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY EffectiveFrom DESC, PayRevisionId DESC;

    SELECT PayMatrixId, PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate
    FROM dbo.PayMatrixMaster
    WHERE Status = N'Active'
    ORDER BY PayRevisionId, Level, CellNo;
END
GO

PRINT '08_CreateStoredProcedures completed.';
GO
