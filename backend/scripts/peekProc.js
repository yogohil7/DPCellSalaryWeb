require("dotenv").config();
const { sql, connectDB } = require("../db");

async function main() {
  await connectDB();
  const r = new sql.Request();
  const proc = await r.query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_EmployeeMaster_GetMasters')) AS Def
  `);
  console.log(proc.recordset[0].Def || "(null)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
