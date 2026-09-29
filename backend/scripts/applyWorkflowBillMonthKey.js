/**
 * Widen dbo.SalaryBillInstituteWorkflow's unique key to
 * (SalaryBillCodeId, InstituteCode, BillMonth) so approval/lock status
 * becomes Bill-Month-specific. Backfills existing rows to their bill's
 * own canonical Bill Month first (see the migration file for detail).
 * Usage: node scripts/applyWorkflowBillMonthKey.js
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
    "51_SalaryBillInstituteWorkflow_BillMonthKey.sql"
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
  console.log("Applied 51_SalaryBillInstituteWorkflow_BillMonthKey.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
