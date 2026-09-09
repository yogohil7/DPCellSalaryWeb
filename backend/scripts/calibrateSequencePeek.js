require("dotenv").config();
const { connectDB, sql } = require("../db");

(async () => {
  await connectDB();
  await new sql.Request().query(
    "ALTER SEQUENCE dbo.EmployeeIdSequence RESTART WITH 2001"
  );
  let s = await sql.query`
    SELECT CONVERT(INT, current_value) AS cur FROM sys.sequences WHERE name = N'EmployeeIdSequence'
  `;
  console.log("After restart cur:", s.recordset[0].cur);

  const n1 = await sql.query`SELECT NEXT VALUE FOR dbo.EmployeeIdSequence AS Id`;
  console.log("First NEXT:", n1.recordset[0].Id);

  s = await sql.query`
    SELECT CONVERT(INT, current_value) AS cur FROM sys.sequences WHERE name = N'EmployeeIdSequence'
  `;
  console.log("After first NEXT cur:", s.recordset[0].cur);

  const n2 = await sql.query`SELECT NEXT VALUE FOR dbo.EmployeeIdSequence AS Id`;
  console.log("Second NEXT:", n2.recordset[0].Id);

  await new sql.Request().query(
    "ALTER SEQUENCE dbo.EmployeeIdSequence RESTART WITH 2001"
  );
  console.log("Restarted again to 2001 for app use");

  /* Correct peek: after restart with N, first NEXT returns N.
     When cur == start and we haven't tracked issuance, peek should be start if
     no employee has that id yet; else cur+1.
     Practical peek = MAX(@FromMax, CASE WHEN EXISTS employee with cur THEN cur+1 ELSE
       -- if cur equals start and no emp with that id, could be start
     )
  */

  await new sql.Request().query(`
CREATE OR ALTER PROCEDURE dbo.usp_Employee_PeekNextId
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxEmp INT = (SELECT ISNULL(MAX(EmployeeId), 0) FROM dbo.EmployeeMaster);
    DECLARE @FromMax INT = CASE WHEN @MaxEmp >= 2001 THEN @MaxEmp + 1 ELSE 2001 END;
    DECLARE @Candidate INT = @FromMax;

    IF OBJECT_ID(N'dbo.EmployeeIdSequence', N'SO') IS NOT NULL
    BEGIN
        DECLARE @Cur INT, @Inc INT, @Start INT;
        SELECT
            @Cur = CONVERT(INT, current_value),
            @Inc = CONVERT(INT, [increment]),
            @Start = CONVERT(INT, start_value)
        FROM sys.sequences
        WHERE name = N'EmployeeIdSequence';

        DECLARE @SeqPeek INT;
        /* After RESTART WITH N, current_value = N and first NEXT VALUE returns N.
           After NEXT issued, current_value = last issued, so next = cur + inc. */
        IF EXISTS (SELECT 1 FROM dbo.EmployeeMaster WHERE EmployeeId = @Cur)
            SET @SeqPeek = @Cur + @Inc;
        ELSE
            SET @SeqPeek = @Cur; /* next NEXT VALUE will return current after restart/create */

        IF @SeqPeek < 2001 SET @SeqPeek = 2001;
        IF @SeqPeek > @Candidate SET @Candidate = @SeqPeek;
    END

    SELECT @Candidate AS EmployeeId;
END
  `);

  const p = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("Peek after fix:", p.recordset[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
