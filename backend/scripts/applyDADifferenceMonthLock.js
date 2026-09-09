/**
 * Apply DA Difference Month Lock schema.
 * Usage: node scripts/applyDADifferenceMonthLock.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const file = path.join(
    __dirname,
    "../sql/schema/38_DADifferenceMonthLock.sql"
  );
  const text = fs.readFileSync(file, "utf8");
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    await new sql.Request().batch(batch);
  }
  console.log("Applied 38_DADifferenceMonthLock.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
