/**
 * Apply EmployeeId sequence migration.
 * Usage: node scripts/applyEmployeeIdSequence.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function runBatch(batch, label) {
  const text = batch.trim();
  if (!text) return;
  console.log(`\n--- ${label} ---`);
  const request = new sql.Request();
  request.multiple = true;
  await request.query(text);
  console.log(`OK: ${label}`);
}

async function main() {
  await connectDB();
  const file = path.join(__dirname, "..", "sql", "schema", "22_EmployeeIdSequence.sql");
  const raw = fs.readFileSync(file, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (let i = 0; i < batches.length; i += 1) {
    await runBatch(batches[i], `22_EmployeeIdSequence #${i + 1}`);
  }

  const peek = await new sql.Request().execute("usp_Employee_PeekNextId");
  console.log("\nPeek next ID:", peek.recordset[0]);

  const seq = await sql.query`
    SELECT name, CONVERT(INT, current_value) AS current_value, CONVERT(INT, start_value) AS start_value
    FROM sys.sequences WHERE name = N'EmployeeIdSequence'
  `;
  console.log("Sequence:", seq.recordset[0]);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
