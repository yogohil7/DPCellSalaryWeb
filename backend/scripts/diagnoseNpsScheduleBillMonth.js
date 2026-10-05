/**
 * READ-ONLY diagnostic for NPS Schedule Summary Bill Month instances.
 *
 * Prints WorkflowId, Bill Month, workflow status, Schedule No., and the
 * stored NPS count and sum for one institute and salary month. It does not
 * print employee names, PRAN numbers, or account numbers, and it does not
 * write to the database.
 *
 * Usage: cd backend
 *        node scripts/diagnoseNpsScheduleBillMonth.js MR-29 8 2026
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { sql, connectDB } = require("../db");

const institute = String(process.argv[2] || "MR-29").trim();
const month = Number(process.argv[3] || 8);
const year = Number(process.argv[4] || 2026);

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

(async () => {
  if (!institute || !Number.isFinite(month) || !Number.isFinite(year)) {
    throw new Error("Usage: node scripts/diagnoseNpsScheduleBillMonth.js <institute> <month> <year>");
  }
  await connectDB();

  const workflows = await sql.query`
    SELECT
      w.WorkflowId,
      w.InstituteCode,
      w.BillMonth AS WorkflowBillMonth,
      w.Status,
      b.BillCodeId,
      b.BillCode,
      b.SalaryMonth,
      b.SalaryYear,
      b.SalaryMonthNumber,
      b.BillMonth AS MasterBillMonth,
      CASE
        WHEN UPPER(LTRIM(RTRIM(w.BillMonth))) =
             UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
        THEN N'canonical'
        ELSE N'earlier'
      END AS InstanceKind
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE w.InstituteCode = ${institute}
      AND TRY_CONVERT(int, b.SalaryMonthNumber) = ${month}
      AND TRY_CONVERT(int, b.SalaryYear) = ${year}
    ORDER BY b.BillCodeId, w.BillMonth, w.WorkflowId
  `;

  console.log(`\nNPS schedule instances for ${institute}, salary month ${month}/${year} (read-only)`);
  console.log(`Workflow rows: ${workflows.recordset.length}`);

  for (const workflow of workflows.recordset) {
    const canonical = workflow.InstanceKind === "canonical";
    const details = canonical
      ? await sql.query`
          SELECT
            SUM(CASE WHEN ISNULL(NPS, 0) <> 0 THEN 1 ELSE 0 END) AS NpsEmployees,
            SUM(CASE WHEN ISNULL(NPS, 0) <> 0 THEN NPS ELSE 0 END) AS NpsAmount,
            COUNT(*) AS DetailRows
          FROM dbo.SalaryEmployeeDetails
          WHERE SalaryBillCodeId = ${workflow.BillCodeId}
            AND InstituteCode = ${workflow.InstituteCode}
        `
      : await sql.query`
          SELECT
            SUM(CASE WHEN ISNULL(NPS, 0) <> 0 THEN 1 ELSE 0 END) AS NpsEmployees,
            SUM(CASE WHEN ISNULL(NPS, 0) <> 0 THEN NPS ELSE 0 END) AS NpsAmount,
            COUNT(*) AS DetailRows
          FROM dbo.SalaryEntryBillEmployeeDetails
          WHERE SalaryBillCodeId = ${workflow.BillCodeId}
            AND InstituteCode = ${workflow.InstituteCode}
            AND BillMonth = ${workflow.WorkflowBillMonth}
        `;
    let headerSchedule = "";
    try {
      const header = await sql.query`
        SELECT NPSScheduleNo
        FROM dbo.SalaryEntryBillHeader
        WHERE SalaryBillCodeId = ${workflow.BillCodeId}
          AND InstituteCode = ${workflow.InstituteCode}
          AND BillMonth = ${workflow.WorkflowBillMonth}
      `;
      headerSchedule = header.recordset[0]?.NPSScheduleNo || "";
    } catch (err) {
      if (!/invalid object name/i.test(String(err.message))) throw err;
      headerSchedule = "(header table missing)";
    }
    const totals = details.recordset[0] || {};
    console.log({
      WorkflowId: workflow.WorkflowId,
      BillCodeId: workflow.BillCodeId,
      BillCode: workflow.BillCode,
      SalaryMonth: `${workflow.SalaryMonth} ${workflow.SalaryYear}`,
      BillMonth: workflow.WorkflowBillMonth,
      Status: workflow.Status,
      Source: canonical ? "SalaryEmployeeDetails" : "SalaryEntryBillEmployeeDetails",
      ScheduleNo: headerSchedule || "(none on header)",
      NpsEmployees: num(totals.NpsEmployees),
      NpsAmount: num(totals.NpsAmount),
      DetailRows: num(totals.DetailRows),
    });
  }

  const orphans = await sql.query`
    SELECT
      d.SalaryBillCodeId,
      d.BillMonth,
      SUM(CASE WHEN ISNULL(d.NPS, 0) <> 0 THEN 1 ELSE 0 END) AS NpsEmployees,
      SUM(CASE WHEN ISNULL(d.NPS, 0) <> 0 THEN d.NPS ELSE 0 END) AS NpsAmount
    FROM dbo.SalaryEntryBillEmployeeDetails d
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
    WHERE d.InstituteCode = ${institute}
      AND TRY_CONVERT(int, b.SalaryMonthNumber) = ${month}
      AND TRY_CONVERT(int, b.SalaryYear) = ${year}
      AND ISNULL(d.NPS, 0) <> 0
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.SalaryBillInstituteWorkflow w
        WHERE w.SalaryBillCodeId = d.SalaryBillCodeId
          AND w.InstituteCode = d.InstituteCode
          AND w.BillMonth = d.BillMonth
          AND UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      )
    GROUP BY d.SalaryBillCodeId, d.BillMonth
    ORDER BY d.BillMonth
  `;
  console.log("\nSaved NPS with no APPROVED/LOCKED workflow for that Bill Month:");
  if (!orphans.recordset.length) console.log("  none");
  for (const row of orphans.recordset) {
    console.log({
      BillCodeId: row.SalaryBillCodeId,
      BillMonth: row.BillMonth,
      NpsEmployees: num(row.NpsEmployees),
      NpsAmount: num(row.NpsAmount),
    });
  }
  process.exit(0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
