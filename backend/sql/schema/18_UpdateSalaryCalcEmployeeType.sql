/*
  18_UpdateSalaryCalcEmployeeType.sql
  Align usp_Salary_GetEmployeeCalculation with REGULAR/FIX BasicPay rule.
*/
SET NOCOUNT ON;
GO

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

    DECLARE @EmpType NVARCHAR(50) = (
        SELECT UPPER(LTRIM(RTRIM(EmployeeType)))
        FROM dbo.EmployeeMaster
        WHERE EmployeeId = @EmployeeId
    );

    IF @EmpType IN (N'REG', N'REGULAR') SET @EmpType = N'REGULAR';
    IF @EmpType IN (N'FIXED', N'FIX') SET @EmpType = N'FIX';

    IF @EmpType NOT IN (N'REGULAR', N'FIX')
    BEGIN
        RAISERROR(N'Invalid Employee Type.', 16, 1);
        RETURN;
    END;

    IF @EmpType = N'REGULAR'
       AND NOT EXISTS (
            SELECT 1
            FROM dbo.EmployeeMaster e
            INNER JOIN dbo.PayMatrixMaster m
                ON m.PayRevisionId = e.PayRevisionId
               AND m.Level = e.PayLevel
               AND m.CellNo = e.PayMatrixCellNo
            WHERE e.EmployeeId = @EmployeeId
              AND (UPPER(ISNULL(m.Status, N'Active')) = N'ACTIVE' OR ISNULL(m.IsActive, 1) = 1)
       )
    BEGIN
        RAISERROR(N'Pay Matrix not found for Employee %d. Please verify Pay Revision, Pay Level and Pay Matrix Cell.', 16, 1, @EmployeeId);
        RETURN;
    END;

    SELECT
        e.EmployeeId,
        e.EmployeeCode,
        e.EmployeeName,
        @EmpType AS EmployeeType,
        e.InstituteId,
        i.InstituteCode,
        i.InstituteName,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE e.PayRevisionId END AS PayRevisionId,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE r.RevisionCode END AS RevisionCode,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE r.RevisionName END AS RevisionName,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE m.PayMatrixId END AS PayMatrixId,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE m.Level END AS Level,
        CASE WHEN @EmpType = N'FIX' THEN NULL ELSE m.CellNo END AS CellNo,
        CASE WHEN @EmpType = N'FIX' THEN CAST(0 AS DECIMAL(18,2)) ELSE ISNULL(m.BasicPay, 0) END AS BasicPay,
        da.DAPercentage,
        hra.HRAPercentage,
        med.Amount AS MedicalAllowance,
        ta.TAAmount AS TransportAllowance,
        CAST(
            (CASE WHEN @EmpType = N'FIX' THEN 0 ELSE ISNULL(m.BasicPay, 0) END)
            * ISNULL(da.DAPercentage, 0) / 100.0 AS DECIMAL(18,2)
        ) AS DAAmount,
        CAST(
            (CASE WHEN @EmpType = N'FIX' THEN 0 ELSE ISNULL(m.BasicPay, 0) END)
            * ISNULL(hra.HRAPercentage, 0) / 100.0 AS DECIMAL(18,2)
        ) AS HRAAmount
    FROM dbo.EmployeeMaster e
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
    LEFT JOIN dbo.PayMatrixMaster m
        ON @EmpType = N'REGULAR'
       AND m.PayRevisionId = e.PayRevisionId
       AND m.Level = e.PayLevel
       AND m.CellNo = e.PayMatrixCellNo
       AND (UPPER(ISNULL(m.Status, N'Active')) = N'ACTIVE' OR ISNULL(m.IsActive, 1) = 1)
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
          AND (med.DesignationId IS NULL OR med.DesignationId = e.DesignationId)
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

PRINT '18_UpdateSalaryCalcEmployeeType completed.';
GO
