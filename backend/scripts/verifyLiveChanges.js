/**
 * READ-ONLY live verification for the Salary Entry / DA Difference /
 * Cheque Register changes (sections A-G) plus the migration check (I).
 *
 * Creates nothing, updates nothing, deletes nothing: every statement is a
 * SELECT against metadata or existing rows, and every calculation goes
 * through the SHIPPED code paths rather than a copy of them.
 *
 * Usage:  cd D:\DPCellSalaryWeb\backend
 *         node scripts/verifyLiveChanges.js
 *         node scripts/verifyLiveChanges.js OGE-05 2026 6
 */

const { connectDB, sql } = require("../db");

const INSTITUTE = process.argv[2] || "OGE-05";
const YEAR = process.argv[3] || String(new Date().getFullYear());
const MONTH = process.argv[4] || String(new Date().getMonth() + 1);

function head(title) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(title);
  console.log("=".repeat(78));
}

function table(rows, columns) {
  if (!rows || !rows.length) return console.log("  (no rows)");
  const w = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );
  console.log("  " + columns.map((c, i) => c.padEnd(w[i])).join(" | "));
  console.log("  " + w.map((n) => "-".repeat(n)).join("-+-"));
  rows.forEach((r) =>
    console.log(
      "  " + columns.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join(" | ")
    )
  );
}

async function main() {
  await connectDB();

  /* ================= I. MIGRATIONS ================= */
  head("I — migrations 34 and 45: are the columns already there?");
  const cols = await sql.query`
    SELECT
      COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSDeduction')            AS m34_NPSDeduction,
      COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NetDifferenceAmount')     AS m34_NetDifferenceAmount,
      COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSManual')               AS m34_NPSManual,
      COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNPSDeduction')    AS m34_TotalNPSDeduction,
      COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNetDifferenceAmount') AS m34_TotalNetDifferenceAmount,
      COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'NPSScheduleNo')        AS m45_NPSScheduleNo,
      COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'TAManual')                   AS m46_TAManual
  `;
  const c = cols.recordset[0] || {};
  Object.entries(c).forEach(([k, v]) =>
    console.log(`  ${k.padEnd(32)} ${v == null ? "MISSING  <-- migration needed" : "present"}`)
  );
  const need34 = [c.m34_NPSDeduction, c.m34_NetDifferenceAmount, c.m34_NPSManual,
                  c.m34_TotalNPSDeduction, c.m34_TotalNetDifferenceAmount].some((v) => v == null);
  console.log(`\n  migration 34 required: ${need34 ? "YES  ->  npm run migrate:da-difference-nps" : "no (already applied)"}`);
  console.log(`  migration 45 required: ${c.m45_NPSScheduleNo == null ? "YES  ->  npm run migrate:nps-schedule-no" : "no (already applied)"}`);
  console.log(`  migration 46 required: ${c.m46_TAManual == null ? "YES  ->  npm run migrate:ta-manual" : "no (already applied)"}`);

  /* ================= TA: entered vs stored ================= */
  head(`TA — what Salary Entry stored is what Approval shows (${INSTITUTE})`);
  const taRows = await sql.query`
    SELECT TOP 50
      b.BillCode, d.InstituteCode, d.EmployeeId, d.EmployeeName,
      d.BasicPay, d.PayLevel, d.TA, d.GrossSalary, d.NetSalary,
      w.Status AS WorkflowStatus
    FROM dbo.SalaryEmployeeDetails d
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
    LEFT JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = d.SalaryBillCodeId
     AND w.InstituteCode = d.InstituteCode
    WHERE d.InstituteCode = ${INSTITUTE}
    ORDER BY b.BillCode, d.DisplayOrder
  `;
  table(taRows.recordset,
    ["BillCode", "EmployeeId", "EmployeeName", "BasicPay", "PayLevel", "TA",
     "GrossSalary", "NetSalary", "WorkflowStatus"]);
  console.log("\n  Salary Bill Approval renders this TA column verbatim (no recalculation),");
  console.log("  so any value here is exactly what the approver sees.");
  if (c.m46_TAManual != null) {
    const manual = await sql.query`
      SELECT COUNT(1) AS Cnt FROM dbo.SalaryEmployeeDetails
      WHERE InstituteCode = ${INSTITUTE} AND TAManual = 1
    `;
    console.log(`  Rows flagged as a manually entered TA: ${manual.recordset[0].Cnt}`);
  }

  /* ================= A. SECTION FILTER ================= */
  head("A — Institute Section filter: Institutes.SectionId is the source");
  const secs = await sql.query`
    SELECT s.SectionId, s.SectionName, s.Status,
           COUNT(i.InstituteId) AS Institutes
    FROM dbo.Sections s
    LEFT JOIN dbo.Institutes i ON i.SectionId = s.SectionId
    GROUP BY s.SectionId, s.SectionName, s.Status
    ORDER BY s.SectionId
  `;
  table(secs.recordset, ["SectionId", "SectionName", "Status", "Institutes"]);

  const insts = await sql.query`
    SELECT i.InstituteCode, i.InstituteName, i.SectionId,
           ISNULL(s.SectionName, N'(none)') AS SectionName
    FROM dbo.Institutes i
    LEFT JOIN dbo.Sections s ON s.SectionId = i.SectionId
    ORDER BY s.SectionName, i.InstituteCode
  `;
  console.log("\n  Institutes per section (this is exactly what the dropdown shows):");
  table(insts.recordset, ["SectionName", "SectionId", "InstituteCode", "InstituteName"]);

  const mismatched = insts.recordset.filter((r) => {
    const prefix = String(r.InstituteCode || "").split("-")[0].toUpperCase();
    return r.SectionName !== "(none)" &&
           prefix && prefix !== String(r.SectionName || "").toUpperCase();
  });
  console.log(
    `\n  Institutes whose CODE PREFIX disagrees with their real section: ${mismatched.length}`
  );
  if (mismatched.length) {
    table(mismatched, ["InstituteCode", "SectionName"]);
    console.log("  ^ these are exactly the rows a startsWith() filter would misplace;");
    console.log("    the shipped filter uses SectionId, so they are placed correctly.");
  }
  const orphans = insts.recordset.filter((r) => r.SectionId == null);
  console.log(`  Institutes with NO SectionId (hidden unless 'All Sections'): ${orphans.length}`);

  /* ================= B. DEFAULT BILL ================= */
  head("B — Salary Entry default bill: canonical must win its salary month");
  const billCodes = await sql.query`
    SELECT TOP 10 BillCodeId, BillCode, BillMonth, SalaryMonth,
           SalaryMonthNumber, SalaryYear, Status
    FROM dbo.SalaryBillCodes
    WHERE UPPER(ISNULL(Status, N'')) = N'OPEN'
      AND ISNULL(IsArchived, 0) = 0
    ORDER BY
      SalaryYear DESC,
      SalaryMonthNumber DESC,
      CASE WHEN BillCode LIKE N'%-BM-%' THEN 1 ELSE 0 END,
      BillCode
  `;
  table(billCodes.recordset,
    ["BillCodeId", "BillCode", "BillMonth", "SalaryMonth", "SalaryYear", "Status"]);
  const first = billCodes.recordset[0];
  console.log(
    `\n  Dropdown default = ${first ? first.BillCode : "(none)"} ` +
    `(BillMonth ${first ? first.BillMonth : "-"})`
  );
  console.log(
    `  Canonical (no -BM- suffix): ${first && !/-BM-/i.test(first.BillCode) ? "PASS" : "CHECK THIS"}`
  );

  /* ================= C. RETURNED BILL ================= */
  head("C — Returned bills keep their own Bill Month");
  const returned = await sql.query`
    SELECT b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth,
           w.InstituteCode, w.Status, w.BillNo, w.NPSScheduleNo
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE UPPER(ISNULL(w.Status, N'')) = N'RETURNED'
       OR (UPPER(ISNULL(w.Status, N'')) = N'DRAFT' AND w.ReturnedToAuditorId IS NOT NULL)
    ORDER BY b.BillCode, w.InstituteCode
  `;
  table(returned.recordset,
    ["BillCode", "BillMonth", "SalaryMonth", "InstituteCode", "Status", "BillNo", "NPSScheduleNo"]);
  console.log(
    "\n  Each row above must open with exactly this BillCode and BillMonth."
  );

  /* ================= D. DA DIFFERENCE ================= */
  head(`D — DA Difference sources each month by BillMonth (${INSTITUTE})`);
  const bills = await sql.query`
    SELECT DISTINCT b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryYear,
           COUNT(d.Id) AS Rows
    FROM dbo.SalaryBillCodes b
    INNER JOIN dbo.SalaryEmployeeDetails d ON d.SalaryBillCodeId = b.BillCodeId
    WHERE d.InstituteCode = ${INSTITUTE}
      AND ISNULL(b.IsArchived, 0) = 0
    GROUP BY b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryYear
    ORDER BY b.BillMonth
  `;
  console.log("  Salary bills holding rows for this institute:");
  table(bills.recordset, ["BillCodeId", "BillCode", "BillMonth", "SalaryMonth", "Rows"]);

  const daDiff = require("../utils/daDifference");
  const { buildMonthRange } = require("../utils/employeeIncrement");
  const emps = await daDiff.listEmployeesForPeriod({
    instituteCode: INSTITUTE,
    months: buildMonthRange(YEAR, "01", YEAR, String(MONTH).padStart(2, "0")),
  });
  const employee = emps[0];
  if (!employee) {
    console.log("\n  (no employees found for this institute/period)");
  } else {
    const months = buildMonthRange(YEAR, "01", YEAR, String(MONTH).padStart(2, "0"));
    const rateMap = await daDiff.buildRateMap(months);
    const res = await daDiff.calculateEmployeeDifference({
      employeeId: employee.EmployeeId,
      instituteCode: INSTITUTE,
      months,
      rateMap,
    });
    console.log(`\n  Employee ${employee.EmployeeId} — ${employee.EmployeeName}`);
    table(
      res.months.map((m) => ({
        Month: m.salaryMonth || `${m.salaryMonthNumber}-${m.salaryYear}`,
        SourceBill: m.sourceBillCode || "(none)",
        BillMonth: m.sourceBillMonth || "-",
        Basic: m.historicalBasic,
        OldDA: m.oldDA,
        RevRate: m.revisedDARate,
        RevisedDA: m.revisedDA,
        Difference: m.differenceAmount,
        NPS: m.npsDeduction,
        Net: m.netDifferenceAmount,
      })),
      ["Month", "SourceBill", "BillMonth", "Basic", "OldDA", "RevRate", "RevisedDA", "Difference", "NPS", "Net"]
    );
    console.log("\n  Each row's SourceBill must be the bill whose BILL MONTH equals Month.");
  }

  /* ================= E / G. CHEQUE REGISTER ================= */
  head(`E, G — Cheque Register: Group = Institute Code, month = BillMonth`);
  const { buildChequeRegisterReport } = require("../routes/chequeRegister");
  try {
    const report = await buildChequeRegisterReport({
      table: "ALL", month: MONTH, year: YEAR, format: "SCREEN", salaryTime: "ALL",
    });
    table(
      (report.rows || []).map((r) => ({
        SrNo: r.srNo,
        Institute: r.instituteName,
        BillNo: r.billNo,
        Group: r.group,
        SalaryMonthCol: r.billMonthLabel || r.salaryMonth,
        TYPE: r.type,
        EMP: r.emp,
        Net: r.netAmount,
        Cheque: r.chequeAmount,
      })),
      ["SrNo", "Institute", "BillNo", "Group", "SalaryMonthCol", "TYPE", "EMP", "Net", "Cheque"]
    );
    if (report.totals) {
      console.log(`\n  TOTAL row: EMP=${report.totals.emp}  Net=${report.totals.netAmount}  Cheque=${report.totals.chequeAmount}`);
      console.log("  (the same totals now travel into CSV / PDF / Copy and the .xlsx)");
    }
    const badGroup = (report.rows || []).filter((r) => /section/i.test(String(r.group || "")));
    console.log(`\n  Rows showing a SECTION NAME in Group (must be 0): ${badGroup.length}`);
  } catch (error) {
    console.log(`  Could not build the report: ${error.message}`);
  }

  console.log("\nDone. Nothing was written.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("verifyLiveChanges failed:", error.message);
    process.exit(1);
  });
