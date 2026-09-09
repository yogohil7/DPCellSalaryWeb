/**
 * Backfill SalaryEmployeeDetails.ChequeAmount =
 *   NetSalary + IncomeTax + ProfessionalTax
 */
require("dotenv").config();
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const result = await sql.query`
    UPDATE dbo.SalaryEmployeeDetails
    SET ChequeAmount =
      ISNULL(NetSalary, 0) +
      ISNULL(IncomeTax, 0) +
      ISNULL(ProfessionalTax, 0)
    WHERE ChequeAmount <>
      ISNULL(NetSalary, 0) +
      ISNULL(IncomeTax, 0) +
      ISNULL(ProfessionalTax, 0)
       OR ChequeAmount IS NULL
  `;
  console.log("Rows updated:", result.rowsAffected?.[0] ?? result.rowsAffected);
  const sample = await sql.query`
    SELECT TOP 5 EmployeeId, NetSalary, IncomeTax, ProfessionalTax, ChequeAmount
    FROM dbo.SalaryEmployeeDetails
    WHERE EmployeeId IN (2011, 2012)
    ORDER BY Id DESC
  `;
  console.log(sample.recordset);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
