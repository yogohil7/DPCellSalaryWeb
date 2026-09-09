/*
  09_InsertTestMasterData.sql
  Insert ONLY when tables are empty / codes missing.
  Never deletes existing data.
*/

USE DPCELLSalaryWebDB;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    /* Pay Revision PR2016 */
    IF NOT EXISTS (SELECT 1 FROM dbo.PayRevisionMaster WHERE RevisionCode = N'PR2016')
    BEGIN
        INSERT INTO dbo.PayRevisionMaster
            (SrNo, RevisionCode, RevisionName, EffectiveFrom, Description, Status, IsActive, CreatedBy)
        VALUES
            (1, N'PR2016', N'7th Pay Revision', '2016-01-01', N'Test 7th CPC revision', N'Active', 1, N'SYSTEM');
        PRINT 'Inserted PayRevision PR2016';
    END

    DECLARE @RevId INT = (SELECT TOP 1 PayRevisionId FROM dbo.PayRevisionMaster WHERE RevisionCode = N'PR2016');

    IF @RevId IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM dbo.PayMatrixMaster
            WHERE PayRevisionId = @RevId AND Level = 1 AND CellNo = 1
       )
    BEGIN
        INSERT INTO dbo.PayMatrixMaster
            (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
        VALUES
            (@RevId, N'7th CPC', 1, 1, 18000, '2016-01-01', N'Active', 1, N'SYSTEM'),
            (@RevId, N'7th CPC', 1, 2, 18500, '2016-01-01', N'Active', 1, N'SYSTEM'),
            (@RevId, N'7th CPC', 1, 3, 19100, '2016-01-01', N'Active', 1, N'SYSTEM');
        PRINT 'Inserted sample Pay Matrix Level 1 cells for PR2016';
    END

    COMMIT TRANSACTION;
    PRINT '09_InsertTestMasterData completed.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH
GO
