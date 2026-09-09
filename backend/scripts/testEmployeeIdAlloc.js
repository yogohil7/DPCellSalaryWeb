require("dotenv").config();
const { connectDB, sql } = require("../db");
const { withTransaction } = require("../routes/salaryEmployeeDetails");

(async () => {
  await connectDB();

  const exists2001 = await sql.query`
    SELECT EmployeeId FROM dbo.EmployeeMaster WHERE EmployeeId = 2001
  `;
  console.log("Has 2001:", exists2001.recordset);

  const peek1 = await new sql.Request().execute("usp_Employee_PeekNextId");
  const peek2 = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("Peek x2 (no consume):", peek1.recordset[0], peek2.recordset[0]);

  /* Concurrent allocate */
  const [a, b] = await Promise.all([
    withTransaction(async (tx) => {
      const r = await new sql.Request(tx).execute("usp_Employee_AllocateId");
      return Number(r.recordset[0].EmployeeId);
    }),
    withTransaction(async (tx) => {
      const r = await new sql.Request(tx).execute("usp_Employee_AllocateId");
      return Number(r.recordset[0].EmployeeId);
    }),
  ]);
  console.log("Concurrent allocate:", a, b, "unique=", a !== b);

  const peek3 = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("Peek after allocate:", peek3.recordset[0]);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
