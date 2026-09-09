/*
  22_EmployeeIdSequence.sql
  Safe sequential EmployeeId generation starting at 2001 (or MAX+1).
  Does not drop EmployeeMaster or modify existing rows.
*/

SET NOCOUNT ON;
GO

DECLARE @MaxId INT =
  (SELECT ISNULL(MAX(EmployeeId), 0) FROM dbo.EmployeeMaster);

DECLARE @Start INT =
  CASE WHEN @MaxId >= 2001 THEN @MaxId + 1 ELSE 2001 END;

PRINT CONCAT('EmployeeMaster MAX(EmployeeId)=', @MaxId, ', sequence start=', @Start);

IF OBJECT_ID(N'dbo.EmployeeIdSequence', N'SO') IS NULL
BEGIN
    DECLARE @sql NVARCHAR(400) =
      N'CREATE SEQUENCE dbo.EmployeeIdSequence AS INT START WITH '
      + CAST(@Start AS NVARCHAR(20))
      + N' INCREMENT BY 1 MINVALUE 2001 NO CACHE;';
    EXEC (@sql);
    PRINT 'EmployeeIdSequence created.';
END
ELSE
BEGIN
    /* Ensure sequence never allocates an ID that already exists. */
    DECLARE @SeqCur INT =
      (SELECT CONVERT(INT, current_value) FROM sys.sequences WHERE name = N'EmployeeIdSequence');
    DECLARE @NeedRestart INT =
      CASE WHEN @SeqCur IS NULL OR @SeqCur < @Start - 1 THEN @Start ELSE NULL END;

    IF @NeedRestart IS NOT NULL
    BEGIN
        DECLARE @restartSql NVARCHAR(400) =
          N'ALTER SEQUENCE dbo.EmployeeIdSequence RESTART WITH '
          + CAST(@NeedRestart AS NVARCHAR(20)) + N';';
        EXEC (@restartSql);
        PRINT CONCAT('EmployeeIdSequence restarted at ', @NeedRestart);
    END
    ELSE
        PRINT 'EmployeeIdSequence already exists and is ahead of MAX.';
END
GO

/* PK already unique on EmployeeId. Ensure EmployeeCode uniqueness for mirrored IDs. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_EmployeeMaster_EmployeeCode'
      AND object_id = OBJECT_ID(N'dbo.EmployeeMaster')
)
BEGIN
    IF EXISTS (
        SELECT EmployeeCode
        FROM dbo.EmployeeMaster
        WHERE EmployeeCode IS NOT NULL
        GROUP BY EmployeeCode
        HAVING COUNT(*) > 1
    )
    BEGIN
        PRINT 'WARNING: Duplicate EmployeeCode values exist — unique index NOT created.';
    END
    ELSE
    BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX UQ_EmployeeMaster_EmployeeCode
            ON dbo.EmployeeMaster (EmployeeCode);
        PRINT 'UQ_EmployeeMaster_EmployeeCode created.';
    END
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Employee_AllocateId
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Id INT;
    DECLARE @Attempts INT = 0;

    SET @Id = NEXT VALUE FOR dbo.EmployeeIdSequence;

    WHILE @Attempts < 200
      AND EXISTS (
            SELECT 1
            FROM dbo.EmployeeMaster WITH (UPDLOCK, HOLDLOCK)
            WHERE EmployeeId = @Id
               OR EmployeeCode = CAST(@Id AS NVARCHAR(50))
          )
    BEGIN
        SET @Id = NEXT VALUE FOR dbo.EmployeeIdSequence;
        SET @Attempts += 1;
    END

    IF @Attempts >= 200
    BEGIN
        RAISERROR(N'Unable to allocate a unique Employee ID. Please retry.', 16, 1);
        RETURN;
    END

    IF @Id < 2001
    BEGIN
        RAISERROR(N'Generated Employee ID is invalid (must be >= 2001).', 16, 1);
        RETURN;
    END

    SELECT @Id AS EmployeeId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Employee_PeekNextId
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxEmp INT = (SELECT ISNULL(MAX(EmployeeId), 0) FROM dbo.EmployeeMaster);
    DECLARE @FromMax INT = CASE WHEN @MaxEmp >= 2001 THEN @MaxEmp + 1 ELSE 2001 END;
    DECLARE @Candidate INT = @FromMax;

    IF OBJECT_ID(N'dbo.EmployeeIdSequence', N'SO') IS NOT NULL
    BEGIN
        DECLARE @Cur INT, @Inc INT;
        SELECT
            @Cur = CONVERT(INT, current_value),
            @Inc = CONVERT(INT, [increment])
        FROM sys.sequences
        WHERE name = N'EmployeeIdSequence';

        DECLARE @SeqPeek INT;
        /* After RESTART WITH N, current_value = N and first NEXT VALUE returns N.
           Once EmployeeId = current_value exists, next preview is current + increment. */
        IF EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE EmployeeId = @Cur)
            SET @SeqPeek = @Cur + ISNULL(@Inc, 1);
        ELSE
            SET @SeqPeek = @Cur;

        IF @SeqPeek < 2001 SET @SeqPeek = 2001;
        IF @SeqPeek > @Candidate SET @Candidate = @SeqPeek;
    END

    SELECT @Candidate AS EmployeeId;
END
GO

PRINT '22_EmployeeIdSequence completed.';
GO
