/**
 * Apply Salary Bill Codes SQL migrations using the same DB connection as the API.
 * Usage: node scripts/applySalaryBillCodeMigrations.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function runBatch(batch, label) {
  const text = batch.trim();
  if (!text) return;
  console.log(`\n--- Running: ${label} ---`);
  await sql.query(text);
  console.log(`OK: ${label}`);
}

async function runSqlFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (let i = 0; i < batches.length; i += 1) {
    await runBatch(batches[i], `${path.basename(filePath)} batch ${i + 1}`);
  }
}

async function main() {
  console.log(`DB_SERVER=${process.env.DB_SERVER}`);
  console.log(`DB_DATABASE=${process.env.DB_DATABASE}`);

  await connectDB();

  const sqlDir = path.join(__dirname, "..", "sql");
  const files = [
    "001_salary_bill_codes.sql",
    "002_bill_month_optional.sql",
    "003_salary_employee_details.sql",
    "004_section_master.sql",
    "005_salary_bill_code_period_unique.sql",
  ];

  for (const file of files) {
    const full = path.join(sqlDir, file);
    if (!fs.existsSync(full)) {
      console.warn(`Missing migration file: ${full}`);
      continue;
    }
    await runSqlFile(full);
  }

  const check = await sql.query`
    SELECT
      OBJECT_ID(N'dbo.SalaryBillCodes', N'U') AS SalaryBillCodesId,
      OBJECT_ID(N'dbo.AuditLogs', N'U') AS AuditLogsId,
      OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') AS SalaryEmployeeDetailsId,
      OBJECT_ID(N'dbo.Sections', N'U') AS SectionsId,
      OBJECT_ID(N'dbo.Institutes', N'U') AS InstitutesId,
      (SELECT COUNT(1) FROM dbo.SalaryBillCodes) AS BillCodeCount
  `;

  console.log("\nVerification:", check.recordset[0]);
  console.log("\nMigrations applied successfully.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  console.error(error);
  process.exit(1);
});
