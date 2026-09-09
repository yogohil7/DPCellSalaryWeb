/**
 * TESTING ONLY — Salary Bill Code Master cleanup.
 *
 * Keeps exactly one active SALARY master: JUN-2026 (OPEN).
 * Does NOT delete DA Difference bill codes or salary transaction history.
 *
 * Strategy:
 *  - Hard-delete Salary category codes with zero SED + zero workflow deps.
 *  - Soft-archive (IsArchived=1) Salary category codes blocked by FK/history.
 *  - Ensure JUN-2026 Regular Salary exists once and is OPEN / not archived.
 *
 * Usage: node scripts/cleanupSalaryBillCodesKeepJun2026.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function ensureArchiveColumn() {
  const text = fs.readFileSync(
    path.join(__dirname, "../sql/schema/39_SalaryBillCodes_IsArchived.sql"),
    "utf8"
  );
  for (const batch of text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean)) {
    await new sql.Request().batch(batch);
  }
}

async function depCounts(billCodeId) {
  const sed = await sql.query`
    SELECT COUNT(*) AS Cnt FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${billCodeId}
  `;
  const wf = await sql.query`
    SELECT COUNT(*) AS Cnt FROM dbo.SalaryBillInstituteWorkflow
    WHERE SalaryBillCodeId = ${billCodeId}
  `;
  const da = await sql.query`
    SELECT COUNT(*) AS Cnt FROM dbo.DADifferenceBill
    WHERE SalaryBillCodeId = ${billCodeId}
  `;
  return {
    sed: Number(sed.recordset[0].Cnt),
    workflow: Number(wf.recordset[0].Cnt),
    daDiff: Number(da.recordset[0].Cnt),
  };
}

async function ensureJun2026() {
  const existing = await sql.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillCodes
    WHERE UPPER(LTRIM(RTRIM(BillCode))) = N'JUN-2026'
  `;

  if (!existing.recordset[0]) {
    await sql.query`
      INSERT INTO dbo.SalaryBillCodes
        (
          BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear,
          BillCategory, BillType, Description, Status, CreatedBy, IsArchived
        )
      VALUES
        (
          N'JUN-2026', N'JUN-2026', N'JUN-2026', N'06', N'2026',
          N'Salary', N'Regular Salary', N'Testing OPEN month',
          N'OPEN', N'TESTING_CLEANUP', 0
        )
    `;
    console.log("  Created JUN-2026 (Salary / Regular Salary / OPEN)");
    return;
  }

  const row = existing.recordset[0];
  const id = Number(row.BillCodeId);
  await sql.query`
    UPDATE dbo.SalaryBillCodes
    SET
      BillMonth = N'JUN-2026',
      SalaryMonth = N'JUN-2026',
      SalaryMonthNumber = N'06',
      SalaryYear = N'2026',
      BillCategory = N'Salary',
      BillType = N'Regular Salary',
      Description = CASE
        WHEN Description IS NULL OR LTRIM(RTRIM(Description)) = N'' THEN N'Testing OPEN month'
        ELSE Description
      END,
      Status = N'OPEN',
      LockedDate = NULL,
      LockedBy = NULL,
      CompletedDate = NULL,
      CompletedBy = NULL,
      IsArchived = 0,
      UpdatedDate = SYSUTCDATETIME(),
      UpdatedBy = N'TESTING_CLEANUP'
    WHERE BillCodeId = ${id}
  `;
  console.log(
    `  Updated existing JUN-2026 (Id=${id}) → OPEN, not archived`
  );
}

async function main() {
  await connectDB();
  console.log("=== Salary Bill Code Master cleanup (keep JUN-2026 OPEN) ===");
  await ensureArchiveColumn();

  const salaryRows = await sql.query`
    SELECT BillCodeId, BillCode, BillCategory, BillType, Status
    FROM dbo.SalaryBillCodes
    WHERE UPPER(LTRIM(RTRIM(BillCategory))) = N'SALARY'
      AND UPPER(LTRIM(RTRIM(BillCode))) <> N'JUN-2026'
    ORDER BY BillCode
  `;

  const deleted = [];
  const archived = [];
  const blocked = [];

  for (const row of salaryRows.recordset) {
    const id = Number(row.BillCodeId);
    const code = row.BillCode;
    const deps = await depCounts(id);
    const hasDeps = deps.sed > 0 || deps.workflow > 0 || deps.daDiff > 0;

    if (!hasDeps) {
      try {
        await sql.query`
          DELETE FROM dbo.SalaryBillCodes WHERE BillCodeId = ${id}
        `;
        deleted.push({ code, reason: "no dependent rows" });
        console.log(`  DELETED ${code} (no deps)`);
      } catch (err) {
        blocked.push({ code, deps, error: err.message });
        console.log(`  BLOCKED delete ${code}: ${err.message}`);
      }
      continue;
    }

    await sql.query`
      UPDATE dbo.SalaryBillCodes
      SET
        IsArchived = 1,
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = N'TESTING_CLEANUP'
      WHERE BillCodeId = ${id}
    `;
    archived.push({ code, deps });
    console.log(
      `  ARCHIVED ${code} (SED=${deps.sed}, Workflow=${deps.workflow}, DADiff=${deps.daDiff}) — history preserved`
    );
  }

  await ensureJun2026();

  /* Ensure DA Difference codes are never archived by this script. */
  await sql.query`
    UPDATE dbo.SalaryBillCodes
    SET IsArchived = 0
    WHERE UPPER(LTRIM(RTRIM(BillCategory))) = N'DIFFERENCE'
      AND UPPER(LTRIM(RTRIM(BillType))) = N'DA DIFFERENCE'
  `;

  const activeSalary = await sql.query`
    SELECT BillCode, SalaryMonth, SalaryMonthNumber, SalaryYear,
           BillCategory, BillType, Status, IsArchived, Description
    FROM dbo.SalaryBillCodes
    WHERE ISNULL(IsArchived, 0) = 0
      AND UPPER(LTRIM(RTRIM(BillCategory))) = N'SALARY'
    ORDER BY BillCode
  `;

  const daDiff = await sql.query`
    SELECT BillCode, Status, IsArchived
    FROM dbo.SalaryBillCodes
    WHERE UPPER(LTRIM(RTRIM(BillType))) = N'DA DIFFERENCE'
    ORDER BY BillCode
  `;

  console.log("\n=== Summary ===");
  console.log("Hard-deleted:", deleted);
  console.log("Soft-archived (FK/history protected):", archived);
  console.log("Hard-delete blocked:", blocked);
  console.log("\nActive SALARY masters:", activeSalary.recordset);
  console.log("DA Difference masters (unchanged):", daDiff.recordset);

  if (activeSalary.recordset.length !== 1) {
    console.error("FAILED: expected exactly 1 active Salary master (JUN-2026)");
    process.exit(1);
  }
  const only = activeSalary.recordset[0];
  if (
    String(only.BillCode).toUpperCase() !== "JUN-2026" ||
    String(only.Status).toUpperCase() !== "OPEN"
  ) {
    console.error("FAILED: JUN-2026 must be the only OPEN Salary master");
    process.exit(1);
  }

  console.log("\nOK — Salary Bill Code Master testing state: JUN-2026 OPEN");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
