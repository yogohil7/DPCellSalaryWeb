/**
 * Apply only Employee Payroll Configuration schema (21_*.sql)
 * Usage: node scripts/applyEmployeePayrollConfig.js
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
  const file = path.join(
    __dirname,
    "..",
    "sql",
    "schema",
    "21_EmployeePayrollConfiguration.sql"
  );
  const raw = fs.readFileSync(file, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (let i = 0; i < batches.length; i += 1) {
    await runBatch(batches[i], `21_EmployeePayrollConfiguration #${i + 1}`);
  }

  const table = await sql.query`
    SELECT c.name AS ColumnName, t.name AS TypeName
    FROM sys.columns c
    INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.EmployeePayrollConfiguration')
    ORDER BY c.column_id
  `;
  console.log("\nColumns:", table.recordset);

  const procs = await sql.query`
    SELECT name FROM sys.procedures
    WHERE name LIKE N'usp_EmployeePayrollConfiguration%'
    ORDER BY name
  `;
  console.log("Procedures:", procs.recordset.map((r) => r.name));

  const fk = await sql.query`
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.EmployeePayrollConfiguration')
  `;
  console.log("FKs:", fk.recordset.map((r) => r.name));

  const idx = await sql.query`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.EmployeePayrollConfiguration')
      AND name IS NOT NULL
  `;
  console.log("Indexes:", idx.recordset.map((r) => r.name));

  /* Smoke: pick one active employee and save default config if none */
  const emp = await sql.query`
    SELECT TOP 1 EmployeeId, EmployeeName, EmployeeType, Status
    FROM dbo.EmployeeMaster
    WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
      AND ISNULL(IsActive, 1) = 1
    ORDER BY EmployeeId
  `;
  if (emp.recordset[0]) {
    const employeeId = emp.recordset[0].EmployeeId;
    console.log("\nTest employee:", emp.recordset[0]);

    const req = new sql.Request();
    req.input("Id", sql.Int, null);
    req.input("EmployeeId", sql.Int, employeeId);
    req.input("MedicalAllowanceApplicable", sql.Bit, 0);
    req.input("TransportAllowanceApplicable", sql.Bit, 0);
    req.input("HraPreviousLocationApplicable", sql.Bit, 0);
    req.input("ProfessionalTaxApplicable", sql.Bit, 0);
    req.input("NppaApplicable", sql.NVarChar(10), "NA");
    req.input("EffectiveFrom", sql.Date, new Date().toISOString().slice(0, 10));
    req.input("EffectiveTo", sql.Date, null);
    req.input("IsActive", sql.Bit, 1);
    req.input("Actor", sql.NVarChar(100), "TEST_SCRIPT");
    const saved = await req.execute("usp_EmployeePayrollConfiguration_Save");
    console.log("Save result:", saved.recordset?.[0]);

    const getReq = new sql.Request();
    getReq.input("EmployeeId", sql.Int, employeeId);
    getReq.input("AsOfDate", sql.Date, new Date().toISOString().slice(0, 10));
    const got = await getReq.execute(
      "usp_EmployeePayrollConfiguration_GetByEmployee"
    );
    console.log("GetByEmployee:", got.recordset?.[0]);
  } else {
    console.warn("No active employee found for smoke test.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
