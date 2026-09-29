/**
 * Apply migration 52: relabel a pre-migration-51 workflow row that carries
 * the wrong Bill Month (see the .sql header). Prints every relabelled row.
 * Run `npm run diagnose:workflow-bill-month` first to preview.
 * Usage: node scripts/applyWorkflowLegacyBillMonthRepair.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function main() {
  await connectDB();
  const file = path.join(
    __dirname, "..", "sql", "schema",
    "52_SalaryBillInstituteWorkflow_RepairLegacyBillMonth.sql"
  );
  const batches = fs
    .readFileSync(file, "utf8")
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    const request = new sql.Request();
    request.multiple = true;
    const result = await request.query(batch);
    for (const rs of result.recordsets || []) {
      if (rs.length) console.table(rs);
    }
  }
  console.log("Applied 52_SalaryBillInstituteWorkflow_RepairLegacyBillMonth.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
