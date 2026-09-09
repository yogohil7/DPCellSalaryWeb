/**
 * Apply migration 46 — SalaryEmployeeDetails.TAManual.
 *
 * Additive and idempotent: the column is created only when missing.
 * Nothing is dropped and no existing row is rewritten.
 *
 * Usage:  cd backend && npm run migrate:ta-manual
 */

const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

const MIGRATION = "46_SalaryEmployeeDetails_TAManual.sql";

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

async function apply() {
  await connectDB();
  await applyBatches(path.join(__dirname, "..", "sql", "schema", MIGRATION));
  console.log(`\nApplied ${MIGRATION}`);

  const check = await sql.query`
    SELECT CASE
      WHEN COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'TAManual') IS NULL
      THEN 0 ELSE 1 END AS Present
  `;
  const present = Number(check.recordset[0]?.Present || 0) === 1;
  console.log(
    `\nVerification:\n  ${present ? "OK     " : "MISSING"} SalaryEmployeeDetails.TAManual`
  );
  if (!present) throw new Error("TAManual column is still missing.");
  console.log("\nManual TA flag storage is ready.");
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
