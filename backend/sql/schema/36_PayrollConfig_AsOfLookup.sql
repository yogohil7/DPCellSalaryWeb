/* 36_PayrollConfig_AsOfLookup.sql
   Salary Entry as-of lookup must use EffectiveFrom/EffectiveTo range,
   not only IsActive=1 (historical closed rows must still resolve).
*/
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
