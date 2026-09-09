/**
 * Apply migration 34 — DA Difference NPS Deduction columns.
 *
 * Additive and idempotent: every object is behind an existence guard, so
 * re-running is harmless and no CREATE INDEX can raise error 1913.
 * No table is dropped and no existing salary or approval row is changed.
 *
 * Usage:  cd backend && npm run migrate:da-difference-nps
 */

const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

const MIGRATION = "34_DADifferenceNPSDeduction.sql";

async function applyBatches(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
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
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSDeduction')            IS NULL THEN 0 ELSE 1 END AS MonthDetails_NPSDeduction,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NetDifferenceAmount')     IS NULL THEN 0 ELSE 1 END AS MonthDetails_NetDifferenceAmount,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSManual')               IS NULL THEN 0 ELSE 1 END AS MonthDetails_NPSManual,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNPSDeduction')    IS NULL THEN 0 ELSE 1 END AS EmployeeDetails_TotalNPSDeduction,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNetDifferenceAmount') IS NULL THEN 0 ELSE 1 END AS EmployeeDetails_TotalNet
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
    throw new Error("Migration finished but some columns are still missing.");
  }
  console.log("\nDA Difference NPS columns are ready.");
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
