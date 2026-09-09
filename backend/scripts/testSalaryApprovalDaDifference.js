/**
 * Regression: submitted DA Difference bills appear on Salary Bill Approval.
 * Uses the live SQL Server connection (same as the app).
 */
require("dotenv").config();
const { sql, connectDB } = require("../db");
const {
  signAccessToken,
  loadPermissionsForRole,
} = require("../middleware/auth");

function fail(message) {
  console.error(`  FAIL  ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`  PASS  ${message}`);
}

function check(label, actual, expected) {
  const ok =
    expected === undefined
      ? Boolean(actual)
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass(label);
  else
    fail(
      `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`
    );
}

async function adminToken() {
  const row = await sql.query`
    SELECT TOP 1 u.UserId, u.UserName, u.FullName, u.RoleId, r.RoleName
    FROM dbo.Users u
    INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
    WHERE LOWER(u.UserName) = N'admin'
  `;
  const u = row.recordset[0];
  if (!u) throw new Error("admin user missing");
  const permissions = await loadPermissionsForRole(u.RoleId);
  return signAccessToken(
    {
      userId: u.UserId,
      userName: u.UserName,
      fullName: u.FullName,
      roleId: u.RoleId,
      roleName: u.RoleName,
    },
    permissions
  );
}

(async () => {
  console.log("==================================================================");
  console.log("Salary Bill Approval — DA Difference pending list regression");
  console.log("==================================================================\n");

  await connectDB();
  console.log(`DB ${process.env.DB_SERVER}/${process.env.DB_DATABASE}\n`);

  const submitted = await sql.query`
    SELECT TOP 1
      w.WorkflowId,
      w.Status,
      w.InstituteCode,
      b.BillCodeId,
      b.BillCode,
      b.BillCategory,
      b.BillType
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    WHERE UPPER(w.Status) IN (N'SUBMITTED', N'RESUBMITTED', N'VERIFIED')
      AND (
        UPPER(ISNULL(b.BillCategory, N'')) = N'DIFFERENCE'
        OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
      )
    ORDER BY w.SubmittedDate DESC
  `;

  const row = submitted.recordset[0];
  check("A pending DA Difference workflow exists", Boolean(row));
  if (!row) {
    console.log("\nNo pending DA Difference workflow to assert against.");
    process.exit(process.exitCode || 0);
  }

  console.log(
    `Using ${row.BillCode} / ${row.InstituteCode} (workflow ${row.WorkflowId}, status ${row.Status})\n`
  );

  const token = await adminToken();
  const headers = { Authorization: `Bearer ${token}` };
  const base = `http://127.0.0.1:${process.env.PORT || 5000}`;
  const listRes = await fetch(
    `${base}/api/salary-bill-approval?status=PENDING`,
    { headers }
  );
  const listJson = await listRes.json();
  check("GET /api/salary-bill-approval returns 200", listRes.status, 200);

  const data = Array.isArray(listJson.data) ? listJson.data : [];
  const found = data.find(
    (b) =>
      String(b.billCode) === String(row.BillCode) &&
      String(b.instituteCode) === String(row.InstituteCode)
  );
  check("Pending DA Difference appears in PENDING list", Boolean(found));
  if (found) {
    check("List marks bill as DA Difference", found.isDaDifference, true);
    check("List Bill Type is DA Difference", found.billType, "DA Difference");
    check(
      "List has one approval item (not per period month)",
      found.employeeCount >= 1
    );
    check("Difference period is present", Boolean(found.differencePeriod));
  }

  const historical = data.filter(
    (b) =>
      !b.isDaDifference &&
      ["APPROVED", "LOCKED"].includes(String(b.status || "").toUpperCase()) &&
      String(b.billCode || "").match(/^(OCT|NOV|DEC)-2026$/i)
  );
  check(
    "Historical APPROVED OCT/NOV/DEC salary months are not pending",
    historical.length,
    0
  );

  const detailRes = await fetch(
    `${base}/api/salary-bill-approval/${encodeURIComponent(row.BillCodeId)}?instituteCode=${encodeURIComponent(row.InstituteCode)}`,
    { headers }
  );
  const detailJson = await detailRes.json();
  check("GET approval detail returns 200", detailRes.status, 200);
  const detail = detailJson.data || {};
  check("Detail is DA Difference", detail.isDaDifference, true);
  check("Detail exposes difference period", Boolean(detail.differencePeriod));
  check(
    "Detail loads DA Difference employees (not empty SED)",
    Array.isArray(detail.salaryLines) && detail.salaryLines.length > 0
  );

  const wfCount = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE SalaryBillCodeId = ${Number(row.BillCodeId)}
      AND InstituteCode = ${String(row.InstituteCode)}
  `;
  check(
    "No duplicate institute workflow rows for this DA Diff bill",
    Number(wfCount.recordset[0].Cnt),
    1
  );

  console.log("\n==================================================================");
  console.log(
    process.exitCode
      ? "Salary Approval DA Difference regression FAILED"
      : "Salary Approval DA Difference regression PASSED"
  );
  console.log("==================================================================");
  process.exit(process.exitCode || 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
