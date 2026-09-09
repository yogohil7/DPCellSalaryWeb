/**
 * Apply migration 35 — role-based access permission seeds.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function runBatches(sqlText) {
  const batches = sqlText
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    await new sql.Request().batch(batch);
  }
}

async function verify() {
  const checks = [
    ["MASTER_USER_VIEW", "Permission MASTER_USER_VIEW"],
    ["SALARY_APPROVAL_VIEW", "Permission SALARY_APPROVAL_VIEW"],
    ["DA_DIFFERENCE_ENTRY_VIEW", "Permission DA_DIFFERENCE_ENTRY_VIEW"],
  ];
  let ok = true;
  console.log("\nVerification:");
  for (const [code, label] of checks) {
    const r = await sql.query`
      SELECT TOP 1 PermissionId FROM dbo.Permissions WHERE PermissionCode = ${code}
    `;
    if (r.recordset[0]) console.log(`  OK      ${label}`);
    else {
      console.log(`  MISSING ${label}`);
      ok = false;
    }
  }

  const ao = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Roles r ON r.RoleId = rp.RoleId
    WHERE UPPER(LTRIM(RTRIM(r.RoleName))) IN (N'ACCOUNT OFFICER', N'ACCOUNTS OFFICER')
  `;
  const aud = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Roles r ON r.RoleId = rp.RoleId
    WHERE UPPER(LTRIM(RTRIM(r.RoleName))) = N'AUDITOR'
  `;
  const aoUser = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Roles r ON r.RoleId = rp.RoleId
    INNER JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
    WHERE UPPER(LTRIM(RTRIM(r.RoleName))) = N'AUDITOR'
      AND p.PermissionCode LIKE N'MASTER_USER_%'
  `;
  console.log(`  OK      Account Officer grants: ${ao.recordset[0].Cnt}`);
  console.log(`  OK      Auditor grants: ${aud.recordset[0].Cnt}`);
  console.log(
    Number(aoUser.recordset[0].Cnt) === 0
      ? "  OK      Auditor has zero MASTER_USER permissions"
      : "  FAIL    Auditor still has MASTER_USER permissions"
  );
  if (Number(aoUser.recordset[0].Cnt) !== 0) ok = false;
  return ok;
}

(async () => {
  await connectDB();
  const file = path.join(__dirname, "../sql/schema/35_RoleBasedAccess.sql");
  const text = fs.readFileSync(file, "utf8");
  await runBatches(text);
  console.log("Applied 35_RoleBasedAccess.sql");
  const ok = await verify();
  console.log(
    ok
      ? "\nRole-based access permissions are ready."
      : "\nRole-based access verification reported issues."
  );
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
