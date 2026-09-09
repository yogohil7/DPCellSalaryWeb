/*
  20_PayMatrix_ImportProc.sql
  Additive: upsert helper + EffectiveDate-aware BasicPay lookup.
  Level is NVARCHAR(50) (e.g. IS-1). See also 23_PayMatrixLevel_NVARCHAR.sql.
*/

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_GetBasicPay
    @PayRevisionId INT,
    @Level NVARCHAR(50),
    @CellNo INT,
    @EffectiveDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Lvl NVARCHAR(50) = LTRIM(RTRIM(@Level));

    IF @EffectiveDate IS NOT NULL
    BEGIN
        SELECT TOP 1
            PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Lvl
          AND CellNo = @CellNo
          AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
          AND (EffectiveDate IS NULL OR EffectiveDate <= @EffectiveDate)
        ORDER BY EffectiveDate DESC, PayMatrixId DESC;

        IF @@ROWCOUNT > 0 RETURN;

        SELECT TOP 1
            PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = @PayRevisionId
          AND Level = @Lvl
          AND CellNo = @CellNo
          AND (EffectiveDate IS NULL OR EffectiveDate <= @EffectiveDate)
        ORDER BY EffectiveDate DESC, PayMatrixId DESC;
        RETURN;
    END

    SELECT TOP 1
        PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo
      AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
    ORDER BY PayMatrixId DESC;

    IF @@ROWCOUNT > 0 RETURN;

    SELECT TOP 1
        PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo
    ORDER BY PayMatrixId DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PayMatrix_Import
    @PayRevisionId INT,
    @Level NVARCHAR(50),
    @CellNo INT,
    @BasicPay DECIMAL(18,2),
    @EffectiveDate DATE = NULL,
    @UserName NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ExistingId INT;
    DECLARE @Lvl NVARCHAR(50) = LTRIM(RTRIM(@Level));

    SELECT TOP 1 @ExistingId = PayMatrixId
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = @PayRevisionId
      AND Level = @Lvl
      AND CellNo = @CellNo;

    IF @ExistingId IS NULL
    BEGIN
        INSERT INTO dbo.PayMatrixMaster
            (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
        VALUES
            (
                @PayRevisionId,
                N'7th CPC',
                @Lvl,
                @CellNo,
                @BasicPay,
                @EffectiveDate,
                N'Active',
                1,
                @UserName
            );

        SELECT
            CAST(SCOPE_IDENTITY() AS INT) AS PayMatrixId,
            N'INSERTED' AS ActionName;
    END
    ELSE
    BEGIN
        UPDATE dbo.PayMatrixMaster
        SET
            BasicPay = @BasicPay,
            EffectiveDate = @EffectiveDate,
            Status = N'Active',
            IsActive = 1,
            ModifiedDate = SYSDATETIME(),
            ModifiedBy = @UserName
        WHERE PayMatrixId = @ExistingId;

        SELECT
            @ExistingId AS PayMatrixId,
            N'UPDATED' AS ActionName;
    END
END
GO
