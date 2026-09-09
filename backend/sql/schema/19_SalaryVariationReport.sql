/*
  19_SalaryVariationReport.sql
  Read-only variation report procedure.
  Does NOT modify salary tables.
*/

CREATE OR ALTER PROCEDURE dbo.usp_Salary_VariationReport
    @PreviousBillCode NVARCHAR(50),
    @CurrentBillCode  NVARCHAR(50),
    @InstituteId      INT = NULL,
    @InstituteCode    NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @PrevId INT;
    DECLARE @CurrId INT;
    DECLARE @PrevMonth NVARCHAR(50);
    DECLARE @CurrMonth NVARCHAR(50);
    DECLARE @PrevYear NVARCHAR(20);
    DECLARE @CurrYear NVARCHAR(20);
    DECLARE @PrevStatus NVARCHAR(20);
    DECLARE @CurrStatus NVARCHAR(20);
    DECLARE @InstCode NVARCHAR(50) = NULLIF(LTRIM(RTRIM(@InstituteCode)), N'');
    DECLARE @InstId INT = @InstituteId;
    DECLARE @InstName NVARCHAR(250);
    DECLARE @PrevAsOf DATE;
    DECLARE @CurrAsOf DATE;

    IF @PreviousBillCode IS NULL OR LTRIM(RTRIM(@PreviousBillCode)) = N''
    BEGIN
        RAISERROR(N'Previous Salary Bill is required.', 16, 1);
        RETURN;
    END

    IF @CurrentBillCode IS NULL OR LTRIM(RTRIM(@CurrentBillCode)) = N''
    BEGIN
        RAISERROR(N'Current Salary Bill is required.', 16, 1);
        RETURN;
    END

    IF UPPER(LTRIM(RTRIM(@PreviousBillCode))) = UPPER(LTRIM(RTRIM(@CurrentBillCode)))
    BEGIN
        RAISERROR(N'Previous Bill and Current Bill cannot be the same.', 16, 1);
        RETURN;
    END

    SELECT TOP 1
        @PrevId = BillCodeId,
        @PrevMonth = SalaryMonth,
        @PrevYear = SalaryYear,
        @PrevStatus = Status
    FROM dbo.SalaryBillCodes
    WHERE BillCode = LTRIM(RTRIM(@PreviousBillCode));

    IF @PrevId IS NULL
    BEGIN
        RAISERROR(N'Previous Bill Code was not found.', 16, 1);
        RETURN;
    END

    SELECT TOP 1
        @CurrId = BillCodeId,
        @CurrMonth = SalaryMonth,
        @CurrYear = SalaryYear,
        @CurrStatus = Status
    FROM dbo.SalaryBillCodes
    WHERE BillCode = LTRIM(RTRIM(@CurrentBillCode));

    IF @CurrId IS NULL
    BEGIN
        RAISERROR(N'Current Bill Code was not found.', 16, 1);
        RETURN;
    END

    IF @InstId IS NULL AND @InstCode IS NULL
    BEGIN
        RAISERROR(N'Institute is required.', 16, 1);
        RETURN;
    END

    SELECT TOP 1
        @InstId = InstituteId,
        @InstCode = InstituteCode,
        @InstName = InstituteName
    FROM dbo.Institutes
    WHERE (@InstId IS NOT NULL AND InstituteId = @InstId)
       OR (@InstCode IS NOT NULL AND InstituteCode = @InstCode);

    IF @InstId IS NULL
    BEGIN
        RAISERROR(N'Institute was not found.', 16, 1);
        RETURN;
    END

    /* Approximate as-of date = last day of salary month/year when parseable */
    SET @PrevAsOf = EOMONTH(TRY_CONVERT(DATE, CONCAT(
        CASE WHEN LEN(ISNULL(@PrevYear, N'')) = 2 THEN CONCAT(N'20', @PrevYear) ELSE ISNULL(@PrevYear, N'2026') END,
        N'-',
        CASE UPPER(LEFT(ISNULL(@PrevMonth, @PreviousBillCode), 3))
            WHEN N'JAN' THEN N'01' WHEN N'FEB' THEN N'02' WHEN N'MAR' THEN N'03'
            WHEN N'APR' THEN N'04' WHEN N'MAY' THEN N'05' WHEN N'JUN' THEN N'06'
            WHEN N'JUL' THEN N'07' WHEN N'AUG' THEN N'08' WHEN N'SEP' THEN N'09'
            WHEN N'OCT' THEN N'10' WHEN N'NOV' THEN N'11' WHEN N'DEC' THEN N'12'
            ELSE N'01'
        END,
        N'-01'
    )));
    IF @PrevAsOf IS NULL SET @PrevAsOf = CAST(GETDATE() AS DATE);

    SET @CurrAsOf = EOMONTH(TRY_CONVERT(DATE, CONCAT(
        CASE WHEN LEN(ISNULL(@CurrYear, N'')) = 2 THEN CONCAT(N'20', @CurrYear) ELSE ISNULL(@CurrYear, N'2026') END,
        N'-',
        CASE UPPER(LEFT(ISNULL(@CurrMonth, @CurrentBillCode), 3))
            WHEN N'JAN' THEN N'01' WHEN N'FEB' THEN N'02' WHEN N'MAR' THEN N'03'
            WHEN N'APR' THEN N'04' WHEN N'MAY' THEN N'05' WHEN N'JUN' THEN N'06'
            WHEN N'JUL' THEN N'07' WHEN N'AUG' THEN N'08' WHEN N'SEP' THEN N'09'
            WHEN N'OCT' THEN N'10' WHEN N'NOV' THEN N'11' WHEN N'DEC' THEN N'12'
            ELSE N'01'
        END,
        N'-01'
    )));
    IF @CurrAsOf IS NULL SET @CurrAsOf = CAST(GETDATE() AS DATE);

    /* Result set 0: header meta as first SELECT */
    SELECT
        @PreviousBillCode AS PreviousBillCode,
        @PrevId AS PreviousBillCodeId,
        @PrevMonth AS PreviousSalaryMonth,
        @PrevYear AS PreviousSalaryYear,
        @PrevStatus AS PreviousStatus,
        @PrevAsOf AS PreviousAsOfDate,
        @CurrentBillCode AS CurrentBillCode,
        @CurrId AS CurrentBillCodeId,
        @CurrMonth AS CurrentSalaryMonth,
        @CurrYear AS CurrentSalaryYear,
        @CurrStatus AS CurrentStatus,
        @CurrAsOf AS CurrentAsOfDate,
        @InstId AS InstituteId,
        @InstCode AS InstituteCode,
        @InstName AS InstituteName;

    ;WITH PrevRows AS (
        SELECT sed.*
        FROM dbo.SalaryEmployeeDetails sed
        WHERE sed.SalaryBillCodeId = @PrevId
          AND (
                sed.InstituteCode = @InstCode
                OR sed.InstituteCode IS NULL
                OR sed.InstituteCode = N''
              )
          AND (
                EXISTS (
                    SELECT 1 FROM dbo.EmployeeMaster e
                    WHERE e.EmployeeId = sed.EmployeeId AND e.InstituteId = @InstId
                )
                OR sed.InstituteCode = @InstCode
              )
    ),
    CurrRows AS (
        SELECT sed.*
        FROM dbo.SalaryEmployeeDetails sed
        WHERE sed.SalaryBillCodeId = @CurrId
          AND (
                sed.InstituteCode = @InstCode
                OR sed.InstituteCode IS NULL
                OR sed.InstituteCode = N''
              )
          AND (
                EXISTS (
                    SELECT 1 FROM dbo.EmployeeMaster e
                    WHERE e.EmployeeId = sed.EmployeeId AND e.InstituteId = @InstId
                )
                OR sed.InstituteCode = @InstCode
              )
    ),
    Ids AS (
        SELECT EmployeeId FROM PrevRows
        UNION
        SELECT EmployeeId FROM CurrRows
    ),
    PrevHist AS (
        SELECT h.EmployeeId, h.BasicPay, h.Level, h.CellNo, h.PayRevisionId, h.PayMatrixId,
               ROW_NUMBER() OVER (
                   PARTITION BY h.EmployeeId
                   ORDER BY h.EffectiveFrom DESC, h.EmployeePayHistoryId DESC
               ) AS rn
        FROM dbo.EmployeePayHistory h
        INNER JOIN Ids i ON i.EmployeeId = h.EmployeeId
        WHERE h.EffectiveFrom <= @PrevAsOf
          AND (h.EffectiveTo IS NULL OR h.EffectiveTo >= @PrevAsOf)
    ),
    CurrHist AS (
        SELECT h.EmployeeId, h.BasicPay, h.Level, h.CellNo, h.PayRevisionId, h.PayMatrixId,
               ROW_NUMBER() OVER (
                   PARTITION BY h.EmployeeId
                   ORDER BY h.EffectiveFrom DESC, h.EmployeePayHistoryId DESC
               ) AS rn
        FROM dbo.EmployeePayHistory h
        INNER JOIN Ids i ON i.EmployeeId = h.EmployeeId
        WHERE h.EffectiveFrom <= @CurrAsOf
          AND (h.EffectiveTo IS NULL OR h.EffectiveTo >= @CurrAsOf)
    )
    SELECT
        i.EmployeeId,
        ISNULL(e.EmployeeCode, N'') AS EmployeeCode,
        ISNULL(COALESCE(c.EmployeeName, p.EmployeeName, e.EmployeeName), N'') AS EmployeeName,
        ISNULL(COALESCE(c.EmployeeType, p.EmployeeType, e.EmployeeType), N'') AS EmployeeType,
        ISNULL(COALESCE(c.Designation, p.Designation, d.DesignationName), N'') AS Designation,
        ISNULL(s.SectionName, N'') AS SectionName,
        e.SectionId,
        e.DesignationId,

        /* Previous amounts from SED */
        ISNULL(p.BasicPay, 0) AS PrevBasicPaySed,
        ISNULL(p.GradePay, 0) AS PrevGradePay,
        ISNULL(p.DA, 0) AS PrevDA,
        ISNULL(p.HRA, 0) AS PrevHRA,
        ISNULL(p.MA, 0) AS PrevMA,
        ISNULL(p.TA, 0) AS PrevTA,
        ISNULL(p.SpecialAllowance, 0) AS PrevSpecialAllowance,
        ISNULL(p.WashingAllowance, 0) AS PrevWashingAllowance,
        ISNULL(p.GrossSalary, 0) AS PrevGrossSalary,
        ISNULL(p.GPFSubscription, 0) AS PrevGPFSubscription,
        ISNULL(p.GPFAdvance, 0) AS PrevGPFAdvance,
        ISNULL(p.NPS, 0) AS PrevNPS,
        ISNULL(p.IncomeTax, 0) AS PrevIncomeTax,
        ISNULL(p.ProfessionalTax, 0) AS PrevProfessionalTax,
        ISNULL(p.OtherDeduction, 0) AS PrevOtherDeduction,
        ISNULL(p.TotalDeduction, 0) AS PrevTotalDeduction,
        ISNULL(p.NetSalary, 0) AS PrevNetSalary,
        CASE WHEN p.Id IS NULL THEN 0 ELSE 1 END AS HasPrevious,
        p.Id AS PreviousSalaryEmployeeDetailId,

        /* Current amounts from SED */
        ISNULL(c.BasicPay, 0) AS CurrBasicPaySed,
        ISNULL(c.GradePay, 0) AS CurrGradePay,
        ISNULL(c.DA, 0) AS CurrDA,
        ISNULL(c.HRA, 0) AS CurrHRA,
        ISNULL(c.MA, 0) AS CurrMA,
        ISNULL(c.TA, 0) AS CurrTA,
        ISNULL(c.SpecialAllowance, 0) AS CurrSpecialAllowance,
        ISNULL(c.WashingAllowance, 0) AS CurrWashingAllowance,
        ISNULL(c.GrossSalary, 0) AS CurrGrossSalary,
        ISNULL(c.GPFSubscription, 0) AS CurrGPFSubscription,
        ISNULL(c.GPFAdvance, 0) AS CurrGPFAdvance,
        ISNULL(c.NPS, 0) AS CurrNPS,
        ISNULL(c.IncomeTax, 0) AS CurrIncomeTax,
        ISNULL(c.ProfessionalTax, 0) AS CurrProfessionalTax,
        ISNULL(c.OtherDeduction, 0) AS CurrOtherDeduction,
        ISNULL(c.TotalDeduction, 0) AS CurrTotalDeduction,
        ISNULL(c.NetSalary, 0) AS CurrNetSalary,
        CASE WHEN c.Id IS NULL THEN 0 ELSE 1 END AS HasCurrent,
        c.Id AS CurrentSalaryEmployeeDetailId,

        /* Historical pay context */
        ph.BasicPay AS PrevHistoryBasicPay,
        ph.Level AS PrevHistoryLevel,
        ph.CellNo AS PrevHistoryCellNo,
        ph.PayRevisionId AS PrevHistoryPayRevisionId,
        ch.BasicPay AS CurrHistoryBasicPay,
        ch.Level AS CurrHistoryLevel,
        ch.CellNo AS CurrHistoryCellNo,
        ch.PayRevisionId AS CurrHistoryPayRevisionId,
        pmPrev.BasicPay AS PrevMatrixBasicPay,
        pmCurr.BasicPay AS CurrMatrixBasicPay
    FROM Ids i
    LEFT JOIN PrevRows p ON p.EmployeeId = i.EmployeeId
    LEFT JOIN CurrRows c ON c.EmployeeId = i.EmployeeId
    LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = i.EmployeeId
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Sections s ON s.SectionId = e.SectionId
    LEFT JOIN PrevHist ph ON ph.EmployeeId = i.EmployeeId AND ph.rn = 1
    LEFT JOIN CurrHist ch ON ch.EmployeeId = i.EmployeeId AND ch.rn = 1
    LEFT JOIN dbo.PayMatrixMaster pmPrev
        ON pmPrev.PayRevisionId = ph.PayRevisionId
       AND pmPrev.Level = ph.Level
       AND pmPrev.CellNo = ph.CellNo
    LEFT JOIN dbo.PayMatrixMaster pmCurr
        ON pmCurr.PayRevisionId = ch.PayRevisionId
       AND pmCurr.Level = ch.Level
       AND pmCurr.CellNo = ch.CellNo
    ORDER BY ISNULL(e.EmployeeName, COALESCE(c.EmployeeName, p.EmployeeName)), i.EmployeeId;

    /* Result set 2: normalized OTHER_EARNING from component details (optional) */
    SELECT
        sed.EmployeeId,
        CASE WHEN sed.SalaryBillCodeId = @PrevId THEN N'PREV' ELSE N'CURR' END AS BillSide,
        UPPER(sc.ComponentCode) AS ComponentCode,
        ISNULL(secd.Amount, 0) AS Amount
    FROM dbo.SalaryEmployeeComponentDetails secd
    INNER JOIN dbo.SalaryEmployeeDetails sed ON sed.Id = secd.SalaryEmployeeDetailId
    INNER JOIN dbo.SalaryComponentMaster sc ON sc.SalaryComponentId = secd.SalaryComponentId
    WHERE sed.SalaryBillCodeId IN (@PrevId, @CurrId)
      AND (
            sed.InstituteCode = @InstCode
            OR sed.InstituteCode IS NULL
            OR sed.InstituteCode = N''
          )
      AND UPPER(sc.ComponentCode) IN (N'OTHER_EARNING', N'OTHER_EARNINGS');
END
GO
