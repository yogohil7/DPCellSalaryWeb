/**
 * Apply the DA Difference + Employee Increment migration.
 *
 * Additive only: the SQL creates tables and columns when they are missing
 * and skips them when they already exist. It never drops or recreates
 * anything, and never touches existing salary or approval data.
 *
 * Usage:  cd backend && node scripts/applyDADifferenceAndIncrement.js
 *     or: npm run migrate:da-difference
 */

const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

const MIGRATION = "33_DADifferenceAndEmployeeIncrement.sql";

async function applyBatches(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    /* The connection already targets DB_DATABASE; skip USE so the script
       works regardless of how the database is named in .env. */
    if (/^USE\s+/i.test(batch)) continue;

    if (/^PRINT\s+/i.test(batch) && batch.split("\n").length === 1) {
      console.log(
        batch.replace(/^PRINT\s+N?'?/i, "").replace(/';?\s*;?\s*$/, "")
      );
      continue;
    }
    await new sql.Request().batch(batch);
  }
}

async function verify() {
  const result = await sql.query`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.DADifferenceBill', N'U')            IS NULL THEN 0 ELSE 1 END AS DADifferenceBill,
      CASE WHEN OBJECT_ID(N'dbo.DADifferenceEmployeeDetails', N'U') IS NULL THEN 0 ELSE 1 END AS DADifferenceEmployeeDetails,
      CASE WHEN OBJECT_ID(N'dbo.DADifferenceMonthDetails', N'U')    IS NULL THEN 0 ELSE 1 END AS DADifferenceMonthDetails,
      CASE WHEN OBJECT_ID(N'dbo.EmployeeIncrement', N'U')           IS NULL THEN 0 ELSE 1 END AS EmployeeIncrement,
      CASE WHEN COL_LENGTH(N'dbo.EmployeeMaster', N'IncrementDate') IS NULL THEN 0 ELSE 1 END AS EmployeeMaster_IncrementDate,
      CASE WHEN COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'CLA')    IS NULL THEN 0 ELSE 1 END AS SalaryEmployeeDetails_CLA
  `;

  const row = result.recordset[0];
  console.log("\nVerification:");
  let ok = true;
  for (const [name, present] of Object.entries(row)) {
    console.log(`  ${present ? "OK     " : "MISSING"} ${name}`);
    if (!present) ok = false;
  }
  return ok;
}

async function apply() {
  await connectDB();
  await applyBatches(path.join(__dirname, "..", "sql", "schema", MIGRATION));
  console.log(`\nApplied ${MIGRATION}`);

  const ok = await verify();
  if (!ok) {
    throw new Error("Migration finished but some objects are still missing.");
  }
  console.log("\nDA Difference + Employee Increment schema is ready.");
}

if (require.main === module) {
  apply()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { apply };
