/**
 * Apply NPSManual column on SalaryEmployeeDetails.
 * Usage: node scripts/applySalaryEmployeeNpsManual.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const text = fs.readFileSync(
    path.join(__dirname, "../sql/schema/42_SalaryEmployeeDetails_NPSManual.sql"),
    "utf8"
  );
  for (const batch of text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean)) {
    await new sql.Request().batch(batch);
  }
  const col = await sql.query`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo'
      AND TABLE_NAME = N'SalaryEmployeeDetails'
      AND COLUMN_NAME = N'NPSManual'
  `;
  console.log("NPSManual column:", col.recordset[0] || "MISSING");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
