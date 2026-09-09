/**
 * Apply safe schema upgrade scripts in order (no drops).
 * Usage: node scripts/applySafeSchemaUpgrade.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function runBatch(batch, label) {
  const text = batch.trim();
  if (!text || text.startsWith(":r ")) return;
  console.log(`\n--- ${label} ---`);
  const request = new sql.Request();
  request.multiple = true;
  await request.query(text);
  console.log(`OK: ${label}`);
}

async function runSqlFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith(":r "));

  for (let i = 0; i < batches.length; i += 1) {
    await runBatch(batches[i], `${path.basename(filePath)} #${i + 1}`);
  }
}

async function main() {
  console.log(`DB_SERVER=${process.env.DB_SERVER}`);
  console.log(`DB_DATABASE=${process.env.DB_DATABASE}`);
  await connectDB();

  const dir = path.join(__dirname, "..", "sql", "schema");
  const files = [
    "01_CreateDatabase.sql",
    "02_CreateMasterTables.sql",
    "05_CreatePayRevision.sql",
    "07_CreateEmployeePayHistory.sql",
    "06_CreatePayMatrix.sql",
    "03_CreateForeignKeys.sql",
    "04_CreateIndexes.sql",
    "08_CreateStoredProcedures.sql",
    "09_InsertTestMasterData.sql",
    "10_Validation.sql",
    "11_CreateSalaryComponentTables.sql",
    "12_SalaryComponentConstraints.sql",
    "13_SeedSalaryComponentMaster.sql",
    "14_SalaryComponentProcedures.sql",
    "15_ValidateSalaryComponents.sql",
    "16_EmployeePayLevelColumns.sql",
    "17_EmployeeMaster_PayMatrixId_Nullable.sql",
    "18_UpdateSalaryCalcEmployeeType.sql",
    "19_SalaryVariationReport.sql",
    "20_PayMatrix_ImportProc.sql",
    "21_EmployeePayrollConfiguration.sql",
    "22_EmployeeIdSequence.sql",
    "23_PayMatrixLevel_NVARCHAR.sql",
    "32_SalaryComponentEmployeeRule.sql",
  ];

  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      console.warn("Missing", full);
      continue;
    }
    // Skip USE / CREATE DATABASE batches that may fail under contained connection
    const raw = fs.readFileSync(full, "utf8");
    const batches = raw
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => !/^USE\s+/i.test(b))
      .filter((b) => !/^IF\s+DB_ID/i.test(b))
      .filter((b) => !b.startsWith(":r "));

    for (let i = 0; i < batches.length; i += 1) {
      await runBatch(batches[i], `${file} #${i + 1}`);
    }
  }

  const join = await sql.query`
    SELECT
      i.InstituteId, i.InstituteCode, i.InstituteName,
      i.DistrictId, d.DistrictName, i.CityClassId, cc.CityClassName
    FROM dbo.Institutes i
    LEFT JOIN dbo.Districts d ON i.DistrictId = d.DistrictId
    LEFT JOIN dbo.CityClasses cc ON i.CityClassId = cc.CityClassId
  `;
  console.log("\nInstitute validation:", join.recordset);

  const fk = await sql.query`
    SELECT COUNT(1) AS FkCount FROM sys.foreign_keys
  `;
  console.log("Foreign key count:", fk.recordset[0].FkCount);

  const matrix = await sql.query`
    SELECT TOP 5 PayMatrixId, PayRevisionId, Level, CellNo, BasicPay
    FROM dbo.PayMatrixMaster ORDER BY PayMatrixId
  `;
  console.log("Sample PayMatrix:", matrix.recordset);

  process.exit(0);
}

main().catch((err) => {
  console.error("Schema upgrade failed:", err.message);
  console.error(err);
  process.exit(1);
});
