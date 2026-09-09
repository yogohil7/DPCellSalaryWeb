/**
 * Revoke Salary Approval permissions from Auditor role.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function runBatches(sqlText) {
  const batches = sqlText
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const batch of batches) {
    await new sql.Request().batch(batch);
  }
}

(async () => {
  await connectDB();
  const file = path.join(
    __dirname,
    "../sql/schema/44_RevokeAuditorSalaryApproval.sql"
  );
  await runBatches(fs.readFileSync(file, "utf8"));

  const left = await sql.query`
    SELECT COUNT(*) AS Cnt
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Roles r ON r.RoleId = rp.RoleId
    INNER JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
    WHERE UPPER(LTRIM(RTRIM(r.RoleName))) = N'AUDITOR'
      AND (
        p.PermissionCode LIKE N'SALARY_APPROVAL_%'
        OR p.PermissionCode = N'SALARY_APPROVAL'
      )
  `;
  console.log(
    "Auditor SALARY_APPROVAL grants remaining:",
    left.recordset[0].Cnt
  );
  process.exit(Number(left.recordset[0].Cnt) === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
