/**
 * Return-To-Auditor dropdown must list only active Auditor-role users.
 * Usage: node scripts/testReturnToAuditorFilter.js
 */
/* Phase 9: no credential literal in tests. Supply the password via the
   environment; the suite reports BLOCKED when it is not configured. */
const TEST_ADMIN_PASSWORD = String(
  process.env.TEST_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || ""
).trim();

require("dotenv").config();
const assert = require("assert");
const { sql, connectDB } = require("../db");

function check(name, actual, expected) {
  assert.strictEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  console.log(`  PASS  ${name}`);
}

async function login(userName, password) {
  const res = await fetch("http://127.0.0.1:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Login failed (${userName})`);
  return data.token || data.data?.token;
}

async function api(token, path, options = {}) {
  const res = await fetch(`http://127.0.0.1:5000${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("Return-To-Auditor role filter tests\n");
  await connectDB();

  const role = await sql.query`
    SELECT TOP 1 RoleId FROM dbo.Roles
    WHERE UPPER(LTRIM(RTRIM(RoleName))) = N'AUDITOR'
  `;
  const auditorRoleId = Number(role.recordset[0]?.RoleId);
  assert.ok(auditorRoleId > 0, "Auditor role must exist");

  const stamp = Date.now().toString().slice(-8);
  const activeName = `aud_active_${stamp}`;
  const inactiveName = `aud_inactive_${stamp}`;

  const created = await sql.query`
    INSERT INTO dbo.Users (UserName, FullName, PasswordHash, RoleId, IsActive, CreatedBy)
    OUTPUT INSERTED.UserId, INSERTED.UserName, INSERTED.IsActive
    VALUES
      (${activeName}, N'Test Auditor Active', N'test-hash', ${auditorRoleId}, 1, N'TEST'),
      (${inactiveName}, N'Test Auditor Inactive', N'test-hash', ${auditorRoleId}, 0, N'TEST')
  `;
  const activeId = Number(created.recordset[0].UserId);
  const inactiveId = Number(created.recordset[1].UserId);
  console.log(`  Created temp auditors active=${activeId} inactive=${inactiveId}`);

  let token;
  try {
    token = await login("admin", TEST_ADMIN_PASSWORD);
  } catch {
    token = await login("Admin", TEST_ADMIN_PASSWORD);
  }

  try {
    const list = await api(token, "/api/salary-bill-approval/auditors");
    check("GET /auditors → 200", list.status, 200);
    const rows = Array.isArray(list.data?.data) ? list.data.data : [];
    assert.ok(rows.length >= 1, "at least one auditor expected");

    for (const row of rows) {
      assert.strictEqual(
        String(row.roleName || "").trim().toUpperCase(),
        "AUDITOR",
        `non-auditor in list: ${row.userName} (${row.roleName})`
      );
    }
    console.log(`  PASS  All ${rows.length} dropdown users are Auditor role`);

    const names = rows.map((r) => String(r.userName || "").toLowerCase());
    assert.ok(!names.includes("admin"), "Super Admin must not appear");
    assert.ok(!names.includes("ao"), "Account Officer must not appear");
    console.log("  PASS  admin and ao usernames not in auditor list");

    assert.ok(
      rows.some((r) => Number(r.userId) === activeId),
      "active auditor must appear"
    );
    assert.ok(
      !rows.some((r) => Number(r.userId) === inactiveId),
      "inactive auditor must not appear"
    );
    console.log("  PASS  Active auditor included; inactive excluded");

    /* Find a returnable workflow and reject AO/admin as return target. */
    let target = (
      await sql.query`
        SELECT TOP 1 w.SalaryBillCodeId, w.InstituteCode, b.BillCode, w.Status
        FROM dbo.SalaryBillInstituteWorkflow w
        INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
        WHERE UPPER(w.Status) IN (N'SUBMITTED', N'RESUBMITTED', N'VERIFIED')
        ORDER BY w.SubmittedDate DESC
      `
    ).recordset[0];

    let restoredStatus = null;
    if (!target) {
      target = (
        await sql.query`
          SELECT TOP 1 w.SalaryBillCodeId, w.InstituteCode, b.BillCode, w.Status
          FROM dbo.SalaryBillInstituteWorkflow w
          INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
          ORDER BY w.WorkflowId DESC
        `
      ).recordset[0];
      if (target) {
        restoredStatus = target.Status;
        await sql.query`
          UPDATE dbo.SalaryBillInstituteWorkflow
          SET Status = N'SUBMITTED'
          WHERE SalaryBillCodeId = ${Number(target.SalaryBillCodeId)}
            AND InstituteCode = ${String(target.InstituteCode)}
        `;
        target.Status = "SUBMITTED";
        console.log(
          `  TEMP set ${target.BillCode}/${target.InstituteCode} to SUBMITTED for validation`
        );
      }
    }

    try {
      if (!target) {
        console.log("  SKIP  No workflow row available for return validation");
      } else {
        const aoUser = await sql.query`
          SELECT TOP 1 u.UserId
          FROM dbo.Users u
          INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
          WHERE UPPER(LTRIM(RTRIM(r.RoleName))) LIKE N'%ACCOUNT%OFFICER%'
            AND ISNULL(u.IsActive, 0) = 1
        `;
        const aoId = Number(aoUser.recordset[0]?.UserId);
        if (aoId) {
          const bad = await api(
            token,
            `/api/salary-bill-approval/${target.SalaryBillCodeId}/return`,
            {
              method: "POST",
              body: JSON.stringify({
                instituteCode: target.InstituteCode,
                returnedToAuditorId: aoId,
                returnedRemarks: "role filter regression",
                userName: "admin",
                fullName: "System Administrator",
              }),
            }
          );
          check("Return to Account Officer rejected", bad.status, 400);
          assert.ok(
            String(bad.data?.message || "").toLowerCase().includes("auditor"),
            "error mentions auditor role"
          );
          console.log("  PASS  AO cannot be return target");
        }

        const adminUser = await sql.query`
          SELECT TOP 1 u.UserId
          FROM dbo.Users u
          INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
          WHERE UPPER(LTRIM(RTRIM(r.RoleName))) LIKE N'%SUPER%ADMIN%'
            AND ISNULL(u.IsActive, 0) = 1
        `;
        const adminId = Number(adminUser.recordset[0]?.UserId);
        if (adminId) {
          const badAdmin = await api(
            token,
            `/api/salary-bill-approval/${target.SalaryBillCodeId}/return`,
            {
              method: "POST",
              body: JSON.stringify({
                instituteCode: target.InstituteCode,
                returnedToAuditorId: adminId,
                returnedRemarks: "role filter regression",
                userName: "admin",
                fullName: "System Administrator",
              }),
            }
          );
          check("Return to Super Admin rejected", badAdmin.status, 400);
          console.log("  PASS  Super Admin cannot be return target");
        }
      }
    } finally {
      if (target && restoredStatus != null) {
        await sql.query`
          UPDATE dbo.SalaryBillInstituteWorkflow
          SET Status = ${restoredStatus}
          WHERE SalaryBillCodeId = ${Number(target.SalaryBillCodeId)}
            AND InstituteCode = ${String(target.InstituteCode)}
        `;
        console.log("  Restored temporary workflow status");
      }
    }

    console.log("\nAll Return-To-Auditor filter tests passed.");
  } finally {
    await sql.query`
      DELETE FROM dbo.Users
      WHERE UserId IN (${activeId}, ${inactiveId})
    `;
    console.log("  Cleaned temp auditor users");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
