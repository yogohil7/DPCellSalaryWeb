/**
 * Apply BillNo / BillDate columns on SalaryBillInstituteWorkflow.
 * Usage: node scripts/applyBillNoDate.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function main() {
  await connectDB();
  const file = path.join(
    __dirname,
    "..",
    "sql",
    "schema",
    "37_SalaryBillInstituteWorkflow_BillNoDate.sql"
  );
  const raw = fs.readFileSync(file, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    const request = new sql.Request();
    request.multiple = true;
    await request.query(batch);
  }
  console.log("Applied 37_SalaryBillInstituteWorkflow_BillNoDate.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
