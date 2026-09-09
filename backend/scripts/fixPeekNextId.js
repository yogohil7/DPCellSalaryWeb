require("dotenv").config();
const { connectDB, sql } = require("../db");

(async () => {
  await connectDB();
  const seq = await sql.query`
    SELECT CONVERT(INT, current_value) AS cur,
           CONVERT(INT, start_value) AS start_value,
           CONVERT(INT, increment) AS increment
    FROM sys.sequences WHERE name = N'EmployeeIdSequence'
  `;
  console.log("Seq state:", seq.recordset[0]);

  /* Fix peek: next = current_value + increment when current was already issued;
     after RESTART WITH N before any NEXT, current may equal N-1 or N depending on version. */
  await new sql.Request().query(`
CREATE OR ALTER PROCEDURE dbo.usp_Employee_PeekNextId
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxEmp INT = (SELECT ISNULL(MAX(EmployeeId), 0) FROM dbo.EmployeeMaster);
    DECLARE @FromMax INT = CASE WHEN @MaxEmp >= 2001 THEN @MaxEmp + 1 ELSE 2001 END;
    DECLARE @FromSeq INT = 2001;

    IF OBJECT_ID(N'dbo.EmployeeIdSequence', N'SO') IS NOT NULL
    BEGIN
        DECLARE @Cur INT, @Inc INT, @Start INT;
        SELECT
            @Cur = CONVERT(INT, current_value),
            @Inc = CONVERT(INT, increment),
            @Start = CONVERT(INT, start_value)
        FROM sys.sequences
        WHERE name = N'EmployeeIdSequence';

        /* If no value issued yet relative to start, next is start_value.
           SQL Server stores current_value as last issued; before first issue after create/restart
           current_value = start_value - increment. */
        IF @Cur < @Start
            SET @FromSeq = @Start;
        ELSE
            SET @FromSeq = @Cur + @Inc;

        IF @FromSeq < 2001 SET @FromSeq = 2001;
    END

    SELECT CASE WHEN @FromSeq > @FromMax THEN @FromSeq ELSE @FromMax END AS EmployeeId;
END
  `);

  const p = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("Fixed peek:", p.recordset[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
