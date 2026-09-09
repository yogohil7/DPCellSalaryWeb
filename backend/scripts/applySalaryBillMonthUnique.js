/**
 * Normalize SalaryBillCodes.BillMonth to MON-YYYY, then apply unique index
 * that includes BillMonth so MAY-2026/JUN-2026 can coexist with JUN-2026/JUN-2026.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");
const {
  normalizeYearMonth,
  formatMonthLabel,
} = require("../utils/salaryMonthKey");

async function normalizeExistingBillMonths() {
  const rows = await sql.query`
    SELECT BillCodeId, BillCode, BillMonth, SalaryMonth, SalaryYear, SalaryMonthNumber
    FROM dbo.SalaryBillCodes
  `;

  for (const row of rows.recordset) {
    const salaryParts = normalizeYearMonth(
      row.SalaryMonth,
      row.SalaryYear,
      row.SalaryMonthNumber
    );
    const billParts =
      normalizeYearMonth(row.BillMonth, row.SalaryYear, null) || salaryParts;
    const canonicalBill = formatMonthLabel(billParts) || row.SalaryMonth;
    const canonicalSalary = formatMonthLabel(salaryParts) || row.SalaryMonth;

    if (
      String(row.BillMonth || "") !== canonicalBill ||
      String(row.SalaryMonth || "") !== canonicalSalary
    ) {
      await sql.query`
        UPDATE dbo.SalaryBillCodes
        SET
          BillMonth = ${canonicalBill},
          SalaryMonth = ${canonicalSalary}
        WHERE BillCodeId = ${Number(row.BillCodeId)}
      `;
      console.log(
        `Normalized ${row.BillCode}: BillMonth=${canonicalBill}, SalaryMonth=${canonicalSalary}`
      );
    }
  }
}

async function runSqlFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    await new sql.Request().batch(batch);
  }
}

async function main() {
  await connectDB();
  await normalizeExistingBillMonths();
  await runSqlFile(
    path.join(__dirname, "../sql/schema/43_SalaryBillCodes_BillMonth_Unique.sql")
  );
  console.log("Applied 43_SalaryBillCodes_BillMonth_Unique.sql");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
