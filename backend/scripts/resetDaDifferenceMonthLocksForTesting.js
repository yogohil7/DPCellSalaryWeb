/**
 * TESTING ONLY — reset DA Difference month locks and ensure JUN-2026 is OPEN.
 *
 * Does NOT delete salary bills, entries, employees, masters, or users.
 * Does NOT unlock unrelated Salary Bill Code Master months (AUG/SEP/etc.).
 *
 * Usage: node scripts/resetDaDifferenceMonthLocksForTesting.js
 */
require("dotenv").config();
const { connectDB, sql } = require("../db");

async function ensureJun2026DaDiffOpen() {
  /* Salary Bill Code for DA Difference payment month JUN-2026 */
  let bill = await sql.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillCodes
    WHERE UPPER(LTRIM(RTRIM(BillCode))) = N'JUN-2026-DA-DIFF'
  `;
  if (!bill.recordset[0]) {
    await sql.query`
      INSERT INTO dbo.SalaryBillCodes
        (
          BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear,
          BillCategory, BillType, Description, Status, CreatedBy
        )
      VALUES
        (
          N'JUN-2026-DA-DIFF', N'JUN-2026', N'JUN-2026', N'06', N'2026',
          N'Difference', N'DA Difference', N'Testing OPEN month JUN-2026',
          N'OPEN', N'TESTING_RESET'
        )
    `;
    bill = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes
      WHERE UPPER(LTRIM(RTRIM(BillCode))) = N'JUN-2026-DA-DIFF'
    `;
    console.log("  Created SalaryBillCodes JUN-2026-DA-DIFF (OPEN)");
  } else {
    const status = String(bill.recordset[0].Status || "").toUpperCase();
    if (status !== "OPEN") {
      await sql.query`
        UPDATE dbo.SalaryBillCodes
        SET
          Status = N'OPEN',
          LockedDate = NULL,
          LockedBy = NULL,
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = N'TESTING_RESET'
        WHERE BillCodeId = ${Number(bill.recordset[0].BillCodeId)}
      `;
      console.log(`  Reset JUN-2026-DA-DIFF Status ${status} → OPEN`);
    } else {
      console.log("  JUN-2026-DA-DIFF already OPEN");
    }
    bill = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes
      WHERE UPPER(LTRIM(RTRIM(BillCode))) = N'JUN-2026-DA-DIFF'
    `;
  }

  const billRow = bill.recordset[0];
  const billCodeId = Number(billRow.BillCodeId);

  const da = await sql.query`
    SELECT TOP 1 *
    FROM dbo.DADifferenceBill
    WHERE SalaryBillCodeId = ${billCodeId}
       OR (
         RIGHT(N'0' + LTRIM(RTRIM(PaymentSalaryMonthNumber)), 2) = N'06'
         AND LTRIM(RTRIM(PaymentSalaryYear)) IN (N'2026', N'26')
       )
  `;

  if (!da.recordset[0]) {
    await sql.query`
      INSERT INTO dbo.DADifferenceBill
        (
          SalaryBillCodeId, BillCode,
          PaymentSalaryMonth, PaymentSalaryMonthNumber, PaymentSalaryYear,
          FromSalaryMonth, FromSalaryMonthNumber, FromSalaryYear,
          ToSalaryMonth, ToSalaryMonthNumber, ToSalaryYear,
          Description, Status, CreatedBy
        )
      VALUES
        (
          ${billCodeId}, N'JUN-2026-DA-DIFF',
          N'June', N'06', N'2026',
          N'January', N'01', N'2026',
          N'June', N'06', N'2026',
          N'Testing OPEN month JUN-2026', N'OPEN', N'TESTING_RESET'
        )
    `;
    console.log("  Created DADifferenceBill for payment month JUN-2026 (OPEN)");
  } else {
    const status = String(da.recordset[0].Status || "").toUpperCase();
    if (status !== "OPEN") {
      await sql.query`
        UPDATE dbo.DADifferenceBill
        SET
          Status = N'OPEN',
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = N'TESTING_RESET'
        WHERE DADifferenceBillId = ${Number(da.recordset[0].DADifferenceBillId)}
      `;
      console.log(`  Reset DADifferenceBill Status ${status} → OPEN`);
    } else {
      console.log("  DADifferenceBill for JUN-2026 already OPEN");
    }
  }
}

async function main() {
  await connectDB();
  console.log("=== Reset DA Difference month locks (TESTING) ===");

  /* Apply schema if missing */
  try {
    const fs = require("fs");
    const path = require("path");
    const text = fs.readFileSync(
      path.join(__dirname, "../sql/schema/38_DADifferenceMonthLock.sql"),
      "utf8"
    );
    const batches = text
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const batch of batches) {
      await new sql.Request().batch(batch);
    }
  } catch (err) {
    console.warn("Schema apply warning:", err.message);
  }

  const before = await sql.query`
    SELECT LockYear, LockMonthNumber, MonthLabel, IsLocked, LockedBy, LockedDate
    FROM dbo.DADifferenceMonthLock
    ORDER BY LockYear, LockMonthNumber
  `;
  console.log("  Existing DADifferenceMonthLock rows:", before.recordset.length);
  for (const row of before.recordset) {
    console.log(
      `    - ${row.MonthLabel} IsLocked=${row.IsLocked} by ${row.LockedBy || "-"}`
    );
  }

  /* Remove/unlock all DA Diff month lock rows (clean testing state). */
  const del = await sql.query`
    DELETE FROM dbo.DADifferenceMonthLock;
    SELECT @@ROWCOUNT AS DeletedCount;
  `;
  const deleted = Number(del.recordset?.[0]?.DeletedCount || 0);
  console.log(`  Deleted ${deleted} DADifferenceMonthLock row(s)`);

  /* Explicitly ensure JUN-2026 has no lock (idempotent). */
  await sql.query`
    DELETE FROM dbo.DADifferenceMonthLock
    WHERE LockYear = 2026 AND LockMonthNumber = 6
  `;
  console.log("  Ensured JUN-2026 has no DA Difference month lock");

  await ensureJun2026DaDiffOpen();

  const lockCheck = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.DADifferenceMonthLock
    WHERE LockYear = 2026 AND LockMonthNumber = 6 AND IsLocked = 1
  `;
  const stillLocked = Number(lockCheck.recordset[0].Cnt) > 0;

  const bill = await sql.query`
    SELECT BillCode, Status FROM dbo.SalaryBillCodes
    WHERE BillCode = N'JUN-2026-DA-DIFF'
  `;
  const da = await sql.query`
    SELECT BillCode, Status, PaymentSalaryMonthNumber, PaymentSalaryYear
    FROM dbo.DADifferenceBill
    WHERE BillCode = N'JUN-2026-DA-DIFF'
       OR (
         RIGHT(N'0' + LTRIM(RTRIM(PaymentSalaryMonthNumber)), 2) = N'06'
         AND LTRIM(RTRIM(PaymentSalaryYear)) IN (N'2026', N'26')
       )
  `;

  console.log("\n=== Final testing state ===");
  console.log("  DA Difference Month: JUN-2026");
  console.log(`  Month lock table locked?: ${stillLocked ? "YES (ERROR)" : "NO"}`);
  console.log("  Status: OPEN");
  console.log("  SalaryBillCodes:", bill.recordset);
  console.log("  DADifferenceBill:", da.recordset);

  if (stillLocked) {
    console.error("FAILED: JUN-2026 is still locked");
    process.exit(1);
  }
  console.log("\nJUN-2026 = OPEN (ready for manual lock testing)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
