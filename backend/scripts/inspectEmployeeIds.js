require("dotenv").config();
const { connectDB, sql } = require("../db");

(async () => {
  await connectDB();

  const stats = await sql.query`
    SELECT
      MIN(EmployeeId) AS MinEmployeeId,
      MAX(EmployeeId) AS MaxEmployeeId,
      COUNT(*) AS EmployeeCount
    FROM dbo.EmployeeMaster
  `;
  console.log("Stats:", stats.recordset[0]);

  const dups = await sql.query`
    SELECT EmployeeId, COUNT(*) AS Total
    FROM dbo.EmployeeMaster
    GROUP BY EmployeeId
    HAVING COUNT(*) > 1
  `;
  console.log("Duplicates:", dups.recordset);

  const codes = await sql.query`
    SELECT TOP 20 EmployeeId, EmployeeCode, EmployeeName
    FROM dbo.EmployeeMaster
    ORDER BY EmployeeId
  `;
  console.log("Sample:", codes.recordset);

  const col = await sql.query`
    SELECT
      c.name,
      t.name AS typeName,
      c.is_identity,
      c.max_length
    FROM sys.columns c
    INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.EmployeeMaster')
      AND c.name IN (N'EmployeeId', N'EmployeeCode')
  `;
  console.log("Columns:", col.recordset);

  const uq = await sql.query`
    SELECT i.name, i.is_unique, i.is_primary_key
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.EmployeeMaster')
  `;
  console.log("Indexes:", uq.recordset);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
