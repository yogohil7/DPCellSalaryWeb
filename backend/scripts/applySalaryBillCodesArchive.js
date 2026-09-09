/**
 * Apply SalaryBillCodes.IsArchived column.
 * Usage: node scripts/applySalaryBillCodesArchive.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const text = fs.readFileSync(
    path.join(__dirname, "../sql/schema/39_SalaryBillCodes_IsArchived.sql"),
    "utf8"
  );
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    await new sql.Request().batch(batch);
  }
  console.log("Applied 39_SalaryBillCodes_IsArchived.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
