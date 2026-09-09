/**
 * READ-ONLY diagnostic for: "Returned Salary Bills: 0", the missing
 * NPSScheduleNo column, and the wrong default Bill Month.
 *
 * Creates nothing, changes nothing, writes nothing. Every statement is a
 * SELECT against metadata or existing rows.
 *
 * Usage:  cd D:\DPCellSalaryWeb\backend
 *         node scripts/diagnoseReturnedBills.js
 *         node scripts/diagnoseReturnedBills.js OGE-05 JUN-2026-BM-MAY
 */

const { connectDB, sql } = require("../db");

const INSTITUTE = process.argv[2] || "OGE-05";
const BILL_CODE = process.argv[3] || "JUN-2026-BM-MAY";

function head(title) {
  console.log(`\n${"=".repeat(74)}`);
  console.log(title);
  console.log("=".repeat(74));
}

function table(rows, columns) {
  if (!rows.length) {
    console.log("  (no rows)");
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );
  console.log("  " + columns.map((c, i) => c.padEnd(widths[i])).join(" | "));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const r of rows) {
    console.log(
      "  " + columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join(" | ")
    );
  }
}

async function main() {
  await connectDB();

  /* ---------------- A. Which database is the backend really on? ---------------- */
  head("A1. Connection actually used by this backend");
  const conn = await sql.query`
    SELECT
      DB_NAME()                                              AS CurrentDatabase,
      CAST(@@SERVERNAME AS NVARCHAR(200))                    AS ServerName,
      CAST(SERVERPROPERTY('InstanceName') AS NVARCHAR(200))  AS InstanceName
  `;
  table(conn.recordset, ["CurrentDatabase", "ServerName", "InstanceName"]);
  console.log(
    `\n  .env DB_SERVER=${process.env.DB_SERVER || "(unset)"} ` +
      `DB_DATABASE=${process.env.DB_DATABASE || "(unset)"}`
  );
  console.log(
    "  >> Run your SSMS queries against exactly this database. Msg 208\n" +
      "     'Invalid object name' means the SSMS window was on another database."
  );

  /* ---------------- A2. Do the tables exist? ---------------- */
  head("A2. Required tables");
  const tables = await sql.query`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN (
      N'SalaryBillInstituteWorkflow', N'SalaryBillCodes',
      N'SalaryBillApprovalHistory', N'SalaryEmployeeDetails'
    )
    ORDER BY TABLE_NAME
  `;
  table(tables.recordset, ["TABLE_SCHEMA", "TABLE_NAME"]);
  const haveWorkflow = tables.recordset.some(
    (r) => r.TABLE_NAME === "SalaryBillInstituteWorkflow"
  );
  if (!haveWorkflow) {
    console.log(
      "\n  >> MISSING. It is created by sql/schema/29_SalaryBillInstituteWorkflow.sql.\n" +
        "     Do NOT create a replacement table."
    );
  }

  /* ---------------- A3. Columns of the workflow table ---------------- */
  head("A3. dbo.SalaryBillInstituteWorkflow columns");
  const cols = await sql.query`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS MaxLen
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = N'SalaryBillInstituteWorkflow'
    ORDER BY ORDINAL_POSITION
  `;
  table(cols.recordset, ["COLUMN_NAME", "DATA_TYPE", "MaxLen"]);

  /* ---------------- A4. Migration state ---------------- */
  head("A4. Migration state (what is applied to THIS database)");
  const mig = await sql.query`
    SELECT
      CASE WHEN COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'NPSScheduleNo') IS NULL THEN 0 ELSE 1 END AS m45_NPSScheduleNo,
      CASE WHEN COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillNo')        IS NULL THEN 0 ELSE 1 END AS m37_BillNo,
      CASE WHEN COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'BillDate')      IS NULL THEN 0 ELSE 1 END AS m37_BillDate,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceEmployeeDetails', N'TotalNetDifferenceAmount') IS NULL THEN 0 ELSE 1 END AS m34_TotalNet,
      CASE WHEN COL_LENGTH(N'dbo.DADifferenceMonthDetails', N'NPSDeduction')     IS NULL THEN 0 ELSE 1 END AS m34_NPSDeduction
  `;
  const m = mig.recordset[0];
  for (const [k, v] of Object.entries(m)) {
    console.log(`  ${v ? "APPLIED  " : "MISSING  "} ${k}`);
  }
  if (!m.m45_NPSScheduleNo) {
    console.log("\n  >> Run:  npm run migrate:nps-schedule-no");
  }
  if (!m.m34_TotalNet || !m.m34_NPSDeduction) {
    console.log("  >> Run:  npm run migrate:da-difference-nps");
  }

  /* ---------------- D. The actual bill rows ---------------- */
  head(`D1. SalaryBillCodes rows for salary year 2026 (checking BillMonth data)`);
  const bills = await sql.query`
    SELECT BillCodeId, BillCode, BillMonth, SalaryMonth, SalaryMonthNumber,
           SalaryYear, BillCategory, BillType, Status
    FROM dbo.SalaryBillCodes
    WHERE SalaryYear = N'2026'
    ORDER BY SalaryMonthNumber, BillCodeId
  `;
  table(bills.recordset, [
    "BillCodeId", "BillCode", "BillMonth", "SalaryMonth",
    "SalaryMonthNumber", "Status",
  ]);
  console.log(
    "\n  >> A CANONICAL bill (code without -BM-) should have BillMonth equal to\n" +
      "     its own salary month. If dbo row 'JUN-2026' shows BillMonth 'MAY-2026',\n" +
      "     that row's data is wrong and Salary Entry will display MAY-2026 for it.\n" +
      "     It is set by PUT /api/salary-bill-codes/:id (Salary Bill Code Master)."
  );

  /* ---------------- D2. Workflow rows for the institute ---------------- */
  head(`D2. Workflow rows for institute ${INSTITUTE}`);
  const hasNps = Boolean(m.m45_NPSScheduleNo);
  const workflowSql = `
    SELECT
      w.WorkflowId, b.BillCode, b.BillMonth, b.SalaryMonth,
      w.InstituteCode, w.Status,
      w.ReturnedToAuditorId, w.AssignedAuditorId,
      w.ReturnedBy, w.ReturnedDate
      ${hasNps ? ", w.NPSScheduleNo" : ""}
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE w.InstituteCode = @Institute
    ORDER BY b.SalaryYear, b.SalaryMonthNumber, b.BillCodeId
  `;
  const wfReq = new sql.Request();
  wfReq.input("Institute", sql.NVarChar(50), INSTITUTE);
  const wf = await wfReq.query(workflowSql);
  table(wf.recordset, [
    "BillCode", "BillMonth", "SalaryMonth", "Status",
    "ReturnedToAuditorId", "AssignedAuditorId",
    ...(hasNps ? ["NPSScheduleNo"] : []),
  ]);

  /* ---------------- D3. The specific bill ---------------- */
  head(`D3. The bill under investigation: ${BILL_CODE} / ${INSTITUTE}`);
  const targetReq = new sql.Request();
  targetReq.input("BillCode", sql.NVarChar(50), BILL_CODE);
  targetReq.input("Institute", sql.NVarChar(50), INSTITUTE);
  const target = await targetReq.query(`
    SELECT b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.Status AS MasterStatus,
           w.WorkflowId, w.InstituteCode, w.Status AS WorkflowStatus,
           w.ReturnedToAuditorId, w.AssignedAuditorId
    FROM dbo.SalaryBillCodes b
    LEFT JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = b.BillCodeId AND w.InstituteCode = @Institute
    WHERE b.BillCode = @BillCode
  `);
  table(target.recordset, [
    "BillCodeId", "BillCode", "BillMonth", "SalaryMonth", "MasterStatus",
    "WorkflowStatus", "ReturnedToAuditorId", "AssignedAuditorId",
  ]);

  const row = target.recordset[0];
  if (!row) {
    console.log(`\n  >> No SalaryBillCodes row named ${BILL_CODE} exists.`);
  } else if (!row.WorkflowId) {
    console.log(
      `\n  >> The bill exists but has NO workflow row for ${INSTITUTE}.\n` +
        "     It was never submitted/returned for this institute, so the\n" +
        "     auditor queue cannot show it."
    );
  } else {
    const st = String(row.WorkflowStatus || "").toUpperCase();
    const qualifies =
      st === "RETURNED" || (st === "DRAFT" && row.ReturnedToAuditorId != null);
    console.log(
      `\n  >> Workflow status = ${st}, ReturnedToAuditorId = ${
        row.ReturnedToAuditorId ?? "NULL"
      }`
    );
    console.log(
      `  >> Qualifies for the auditor queue? ${qualifies ? "YES" : "NO"}`
    );
    if (!qualifies) {
      if (st === "SUBMITTED" || st === "RESUBMITTED") {
        console.log(
          "     Reason: it is back with the Account Officer, not the auditor."
        );
      } else if (row.ReturnedToAuditorId == null) {
        console.log(
          "     Reason: ReturnedToAuditorId is NULL — the AO return never\n" +
            "     recorded a target auditor, so no auditor can claim it."
        );
      } else {
        console.log(`     Reason: status ${st} is not an auditor-queue status.`);
      }
    }
  }

  /* ---------------- C. What each auditor would actually see ---------------- */
  head("C. Auditors, and how many rows each would see in Returning Bills");
  const auditors = await sql.query`
    SELECT u.UserId, u.UserName, u.FullName, r.RoleName, u.IsActive
    FROM dbo.Users u
    INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
    WHERE UPPER(r.RoleName) LIKE N'%AUDITOR%'
    ORDER BY u.UserId
  `;
  table(auditors.recordset, ["UserId", "UserName", "FullName", "RoleName", "IsActive"]);

  for (const a of auditors.recordset) {
    const cReq = new sql.Request();
    cReq.input("AuditorId", sql.Int, a.UserId);
    const c = await cReq.query(`
      SELECT COUNT(1) AS Cnt
      FROM dbo.SalaryBillInstituteWorkflow w
      WHERE (
              UPPER(w.Status) = N'RETURNED'
              OR (UPPER(w.Status) = N'DRAFT' AND w.ReturnedToAuditorId IS NOT NULL)
            )
        AND w.ReturnedToAuditorId = @AuditorId
    `);
    console.log(
      `  UserId ${a.UserId} (${a.UserName}) would see ${c.recordset[0].Cnt} returned bill(s).`
    );
  }

  const anyReturned = await sql.query`
    SELECT COUNT(1) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE UPPER(Status) = N'RETURNED'
  `;
  const orphan = await sql.query`
    SELECT COUNT(1) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE UPPER(Status) = N'RETURNED' AND ReturnedToAuditorId IS NULL
  `;
  console.log(
    `\n  Rows with Status='RETURNED' anywhere: ${anyReturned.recordset[0].Cnt}` +
      ` (of which ${orphan.recordset[0].Cnt} have NULL ReturnedToAuditorId)`
  );
  if (orphan.recordset[0].Cnt > 0) {
    console.log(
      "  >> Those NULL rows can never appear for any auditor. The AO must\n" +
        "     return them again choosing an auditor."
    );
  }

  /* ---------------- DA Difference month sourcing ---------------- */
  head(`DA. Which Bill Month each salary bill of ${INSTITUTE} supplies`);
  const daReq = new sql.Request();
  daReq.input("Institute", sql.NVarChar(50), INSTITUTE);
  const daRows = await daReq.query(`
    SELECT
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryYear,
      b.BillCategory, b.Status AS MasterStatus,
      w.Status AS WorkflowStatus,
      COUNT(d.Id) AS EmployeeRows
    FROM dbo.SalaryBillCodes b
    LEFT JOIN dbo.SalaryEmployeeDetails d
      ON d.SalaryBillCodeId = b.BillCodeId AND d.InstituteCode = @Institute
    LEFT JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = b.BillCodeId AND w.InstituteCode = @Institute
    WHERE UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
      AND ISNULL(b.IsArchived, 0) = 0
    GROUP BY b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryYear,
             b.BillCategory, b.Status, w.Status
    HAVING COUNT(d.Id) > 0
    ORDER BY b.BillMonth, b.BillCodeId
  `);
  table(daRows.recordset, [
    "BillCode", "BillMonth", "SalaryMonth", "SalaryYear",
    "MasterStatus", "WorkflowStatus", "EmployeeRows",
  ]);
  console.log(
    "\n  >> DA Difference matches each arrears month against BillMonth above,\n" +
      "     NOT SalaryMonth. A DA month shows 'no snapshot' when no row here\n" +
      "     carries that Bill Month for this institute. If a Bill Month looks\n" +
      "     wrong (e.g. the canonical JUN-2026 row showing MAY-2026), that is\n" +
      "     the data to correct — the lookup itself is by Bill Month."
  );

  head("SUMMARY");
  console.log(
    `  Database        : ${conn.recordset[0].CurrentDatabase}\n` +
      `  Workflow table  : ${haveWorkflow ? "present" : "MISSING"}\n` +
      `  NPSScheduleNo   : ${m.m45_NPSScheduleNo ? "present" : "MISSING (run migrate:nps-schedule-no)"}\n` +
      `  DA NPS columns  : ${m.m34_TotalNet ? "present" : "MISSING (run migrate:da-difference-nps)"}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDiagnostic failed:", err.message);
    process.exit(1);
  });
