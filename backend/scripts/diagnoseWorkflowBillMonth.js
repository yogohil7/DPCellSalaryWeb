/**
 * READ-ONLY diagnostic: "Bill Month JUL-2026 shows the AUG-2026 bill's
 * LOCKED status" after migrations 50/51.
 *
 * Creates nothing, changes nothing, writes nothing: every statement is a
 * SELECT against metadata or existing rows.
 *
 * Usage:  cd D:\DPCellSalaryWeb\backend
 *         node scripts/diagnoseWorkflowBillMonth.js
 *         node scripts/diagnoseWorkflowBillMonth.js DDRS-16 AUG-2026
 */
require("dotenv").config();
const { connectDB, sql } = require("../db");

const INSTITUTE = process.argv[2] || "DDRS-16";
const BILL_CODE = process.argv[3] || "AUG-2026";

function head(title) {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}
function table(rows, columns) {
  if (!rows.length) return console.log("  (no rows)");
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );
  console.log("  " + columns.map((c, i) => c.padEnd(widths[i])).join(" | "));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of rows) {
    console.log("  " + columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join(" | "));
  }
}

async function main() {
  await connectDB();

  head("1. Database actually used by this backend");
  const conn = await sql.query`SELECT DB_NAME() AS CurrentDatabase, CAST(@@SERVERNAME AS NVARCHAR(200)) AS ServerName`;
  table(conn.recordset, ["CurrentDatabase", "ServerName"]);

  head("2. Migrations 50 / 51 applied?");
  const mig = await sql.query`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.SalaryEntryBillEmployeeDetails', N'U') IS NULL THEN 'NO' ELSE 'yes' END AS M50_Table,
      CASE WHEN EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow') AND name = N'UQ_SBIW_Bill_Institute_Month') THEN 'yes' ELSE 'NO' END AS M51_NewKey,
      CASE WHEN EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow') AND name = N'UQ_SBIW_Bill_Institute') THEN 'STILL PRESENT' ELSE 'dropped' END AS M51_OldKey
  `;
  table(mig.recordset, ["M50_Table", "M51_NewKey", "M51_OldKey"]);

  head(`3. Bill ${BILL_CODE} and its canonical Bill Month label`);
  const bill = await sql.query`
    SELECT BillCodeId, BillCode, BillMonth, SalaryMonth, SalaryYear, Status,
           UPPER(LEFT(LTRIM(RTRIM(SalaryMonth)), 3)) + N'-' + CAST(SalaryYear AS NVARCHAR(4)) AS CanonicalBillMonth
    FROM dbo.SalaryBillCodes WHERE BillCode = ${BILL_CODE}`;
  table(bill.recordset, ["BillCodeId", "BillCode", "BillMonth", "SalaryMonth", "SalaryYear", "Status", "CanonicalBillMonth"]);
  const b = bill.recordset[0];
  if (!b) return process.exit(0);

  head(`4. Workflow rows for ${BILL_CODE} / ${INSTITUTE} (one per Bill Month instance)`);
  const wf = await sql.query`
    SELECT WorkflowId, BillMonth, Status, CreatedDate, UpdatedDate, UpdatedBy
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE SalaryBillCodeId = ${b.BillCodeId} AND InstituteCode = ${INSTITUTE}
    ORDER BY WorkflowId`;
  table(wf.recordset, ["WorkflowId", "BillMonth", "Status", "CreatedDate", "UpdatedDate", "UpdatedBy"]);

  head("5. Employee data per instance");
  const sed = await sql.query`
    SELECT COUNT(*) AS Rows FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${b.BillCodeId} AND InstituteCode = ${INSTITUTE}`;
  console.log(`  canonical (${b.CanonicalBillMonth}) rows in SalaryEmployeeDetails: ${sed.recordset[0].Rows}`);
  try {
    const sebed = await sql.query`
      SELECT BillMonth, COUNT(*) AS Rows FROM dbo.SalaryEntryBillEmployeeDetails
      WHERE SalaryBillCodeId = ${b.BillCodeId} AND InstituteCode = ${INSTITUTE}
      GROUP BY BillMonth ORDER BY BillMonth`;
    console.log("  non-canonical rows in SalaryEntryBillEmployeeDetails:");
    table(sebed.recordset, ["BillMonth", "Rows"]);
  } catch (e) {
    console.log("  SalaryEntryBillEmployeeDetails unreadable: " + e.message);
  }

  head("6. Rows migration 52 WOULD relabel (preview - nothing is changed here)");
  try {
    const preview = await sql.query`
      ;WITH Labelled AS (
        SELECT w.WorkflowId,
               UPPER(LEFT(LTRIM(RTRIM(bc.SalaryMonth)), 3)) + N'-' + CAST(bc.SalaryYear AS NVARCHAR(4)) AS CanonicalBillMonth
        FROM dbo.SalaryBillInstituteWorkflow w
        INNER JOIN dbo.SalaryBillCodes bc ON bc.BillCodeId = w.SalaryBillCodeId
        WHERE bc.SalaryMonth IS NOT NULL AND bc.SalaryYear IS NOT NULL
      )
      SELECT w.WorkflowId, w.SalaryBillCodeId, w.InstituteCode,
             w.BillMonth AS CurrentBillMonth, l.CanonicalBillMonth AS WouldBecome, w.Status
      FROM dbo.SalaryBillInstituteWorkflow w
      INNER JOIN Labelled l ON l.WorkflowId = w.WorkflowId
      WHERE w.BillMonth <> l.CanonicalBillMonth
        AND w.WorkflowId = (SELECT MIN(o.WorkflowId) FROM dbo.SalaryBillInstituteWorkflow o
                            WHERE o.SalaryBillCodeId = w.SalaryBillCodeId AND o.InstituteCode = w.InstituteCode)
        AND NOT EXISTS (SELECT 1 FROM dbo.SalaryBillInstituteWorkflow c
                        WHERE c.SalaryBillCodeId = w.SalaryBillCodeId AND c.InstituteCode = w.InstituteCode
                          AND c.BillMonth = l.CanonicalBillMonth)
        AND NOT EXISTS (SELECT 1 FROM dbo.SalaryEntryBillEmployeeDetails e
                        WHERE e.SalaryBillCodeId = w.SalaryBillCodeId AND e.InstituteCode = w.InstituteCode
                          AND e.BillMonth = w.BillMonth)
      ORDER BY w.SalaryBillCodeId, w.InstituteCode`;
    table(preview.recordset, ["WorkflowId", "SalaryBillCodeId", "InstituteCode", "CurrentBillMonth", "WouldBecome", "Status"]);
  } catch (e) {
    console.log("  preview unavailable: " + e.message);
  }

  head("VERDICT");
  const rows = wf.recordset;
  const canonical = rows.find((r) => r.BillMonth === b.CanonicalBillMonth);
  const mislabelled = rows.length && !canonical && rows[0].BillMonth !== b.CanonicalBillMonth;
  if (mig.recordset[0].M51_NewKey !== "yes") {
    console.log("  Migration 51 is NOT applied - run npm run migrate:workflow-bill-month-key.");
  } else if (mislabelled) {
    console.log(
      `  DATA: original row ${rows[0].WorkflowId} (${rows[0].Status}) is labelled '${rows[0].BillMonth}' ` +
        `but is the ${b.CanonicalBillMonth} bill's row. That is why ${rows[0].BillMonth} shows ${rows[0].Status}.\n` +
        "  Fix: npm run migrate:workflow-legacy-bill-month-repair, then restart the backend."
    );
  } else {
    console.log(
      "  DATA IS CORRECT: each instance has its own correctly labelled row (or none yet = DRAFT).\n" +
        "  If Salary Entry still shows the wrong status, the running backend process is an old\n" +
        "  build that looks the workflow up by bill + institute only. Restart the backend\n" +
        "  (Scheduled Task DPCellSalaryBackend) so the current code is loaded."
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
