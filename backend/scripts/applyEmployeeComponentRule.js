/* Apply only the employee-specific salary component rule schema upgrade. */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function main() {
  await connectDB();
  const source = fs.readFileSync(
    path.join(__dirname, "../sql/schema/32_SalaryComponentEmployeeRule.sql"),
    "utf8"
  );
  for (const batch of source.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await sql.query(batch);
  }
  console.log("Employee-specific salary component rule schema applied.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Employee component rule schema migration failed:", error.message);
  process.exit(1);
});
