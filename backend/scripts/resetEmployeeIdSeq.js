require("dotenv").config();
const { connectDB, sql } = require("../db");

(async () => {
  await connectDB();
  await new sql.Request().query(
    "ALTER SEQUENCE dbo.EmployeeIdSequence RESTART WITH 2001"
  );
  const p = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("Reset peek:", p.recordset[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
