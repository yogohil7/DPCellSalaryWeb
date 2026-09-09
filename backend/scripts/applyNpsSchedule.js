/**
 * Apply migration 47 — NpsScheduleHeader / NpsScheduleDetails.
 *
 * Additive and idempotent: tables and indexes are created only when missing.
 * No existing table is altered, nothing is dropped, no row is rewritten.
 *
 * Usage:  cd backend && npm run migrate:nps-schedule
 */

const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

const MIGRATION = "47_NpsSchedule.sql";

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
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.NpsScheduleHeader',  N'U') IS NULL THEN 0 ELSE 1 END AS Header,
      CASE WHEN OBJECT_ID(N'dbo.NpsScheduleDetails', N'U') IS NULL THEN 0 ELSE 1 END AS Details
  `;
  const row = check.recordset[0] || {};
  const header = Number(row.Header || 0) === 1;
  const details = Number(row.Details || 0) === 1;
  console.log(
    `\nVerification:\n  ${header ? "OK     " : "MISSING"} dbo.NpsScheduleHeader` +
      `\n  ${details ? "OK     " : "MISSING"} dbo.NpsScheduleDetails`
  );
  if (!header || !details) {
    throw new Error("NPS Schedule tables are still missing.");
  }
  console.log("\nNPS Schedule storage is ready.");
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
