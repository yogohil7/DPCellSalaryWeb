const express = require("express");
const { sql } = require("../db");

const router = express.Router();

function mapIsActiveToStatus(isActive) {
  return isActive ? "Active" : "Inactive";
}

function parseStatusToIsActive(status, fallback = true) {
  if (status == null || status === "") {
    return fallback ? 1 : 0;
  }
  const raw = String(status).trim().toUpperCase();
  if (raw === "INACTIVE" || raw === "0" || raw === "FALSE") {
    return 0;
  }
  if (raw === "ACTIVE" || raw === "1" || raw === "TRUE") {
    return 1;
  }
  return fallback ? 1 : 0;
}

function mapPermission(row) {
  return {
    permissionId: Number(row.PermissionId),
    permissionName: row.PermissionName,
    permissionCode: row.PermissionCode,
    description: row.Description || "",
    moduleName: row.ModuleName,
    status: row.Status,
  };
}

function mapRole(row, permissionIds = []) {
  return {
    roleId: Number(row.RoleId),
    roleName: row.RoleName,
    description: row.Description || "",
    status: mapIsActiveToStatus(Boolean(row.IsActive)),
    permissionIds,
  };
}

async function withTransaction(work) {
  const transaction = new sql.Transaction();
  await transaction.begin();
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {
      /* ignore */
    }
    throw error;
  }
}

async function getPermissionIdsForRole(roleId, transaction) {
  const request = transaction ? new sql.Request(transaction) : undefined;
  const result = transaction
    ? await request.query`
        SELECT PermissionId
        FROM dbo.RolePermissions
        WHERE RoleId = ${roleId}
        ORDER BY PermissionId ASC
      `
    : await sql.query`
        SELECT PermissionId
        FROM dbo.RolePermissions
        WHERE RoleId = ${roleId}
        ORDER BY PermissionId ASC
      `;
  return result.recordset.map((row) => Number(row.PermissionId));
}

async function replaceRolePermissions(roleId, permissionIds, transaction) {
  const request = new sql.Request(transaction);
  await request.query`
    DELETE FROM dbo.RolePermissions WHERE RoleId = ${roleId}
  `;

  const uniqueIds = [
    ...new Set(
      (permissionIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];

  for (const permissionId of uniqueIds) {
    const reqInsert = new sql.Request(transaction);
    await reqInsert.query`
      INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
      VALUES (${roleId}, ${permissionId}, SYSDATETIME())
    `;
  }
}

router.get("/permissions/catalog", async (req, res) => {
  try {
    const result = await sql.query`
      SELECT
        PermissionId,
        PermissionName,
        PermissionCode,
        Description,
        ModuleName,
        Status
      FROM dbo.Permissions
      ORDER BY ModuleName ASC, PermissionName ASC
    `;

    res.json({
      success: true,
      data: result.recordset.map(mapPermission),
    });
  } catch (error) {
    console.error("GET /api/roles/permissions/catalog error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load permission catalog.",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await sql.query`
      SELECT RoleId, RoleName, Description, IsActive
      FROM dbo.Roles
      ORDER BY RoleName ASC, RoleId ASC
    `;

    res.json({
      success: true,
      data: result.recordset.map((row) => mapRole(row)),
    });
  } catch (error) {
    console.error("GET /api/roles error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load roles.",
    });
  }
});

router.get("/:id/permissions", async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role id.",
      });
    }

    const roleCheck = await sql.query`
      SELECT TOP 1 RoleId FROM dbo.Roles WHERE RoleId = ${roleId}
    `;
    if (!roleCheck.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "Role not found.",
      });
    }

    const result = await sql.query`
      SELECT
        p.PermissionId,
        p.PermissionName,
        p.PermissionCode,
        p.Description,
        p.ModuleName,
        p.Status
      FROM dbo.RolePermissions rp
      INNER JOIN dbo.Permissions p ON rp.PermissionId = p.PermissionId
      WHERE rp.RoleId = ${roleId}
      ORDER BY p.ModuleName ASC, p.PermissionName ASC
    `;

    res.json({
      success: true,
      data: result.recordset.map(mapPermission),
    });
  } catch (error) {
    console.error("GET /api/roles/:id/permissions error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load role permissions.",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role id.",
      });
    }

    const result = await sql.query`
      SELECT TOP 1 RoleId, RoleName, Description, IsActive
      FROM dbo.Roles
      WHERE RoleId = ${roleId}
    `;
    const row = result.recordset[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Role not found.",
      });
    }

    const permissionIds = await getPermissionIdsForRole(roleId);

    res.json({
      success: true,
      data: mapRole(row, permissionIds),
    });
  } catch (error) {
    console.error("GET /api/roles/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load role.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const roleName = String(req.body?.roleName || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    const isActive = parseStatusToIsActive(req.body?.status, true);
    const permissionIds = Array.isArray(req.body?.permissionIds)
      ? req.body.permissionIds
      : [];

    if (!roleName) {
      return res.status(400).json({
        success: false,
        message: "Role name is required.",
      });
    }

    const dup = await sql.query`
      SELECT TOP 1 RoleId FROM dbo.Roles WHERE RoleName = ${roleName}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message: "Role name already exists.",
      });
    }

    const roleId = await withTransaction(async (transaction) => {
      const reqInsert = new sql.Request(transaction);
      const insert = await reqInsert.query`
        INSERT INTO dbo.Roles (RoleName, Description, IsActive)
        OUTPUT INSERTED.RoleId
        VALUES (${roleName}, ${description}, ${isActive})
      `;
      const newRoleId = Number(insert.recordset[0].RoleId);
      await replaceRolePermissions(newRoleId, permissionIds, transaction);
      return newRoleId;
    });

    const result = await sql.query`
      SELECT TOP 1 RoleId, RoleName, Description, IsActive
      FROM dbo.Roles
      WHERE RoleId = ${roleId}
    `;
    const savedPermissionIds = await getPermissionIdsForRole(roleId);

    res.status(201).json({
      success: true,
      data: mapRole(result.recordset[0], savedPermissionIds),
      message: "Role created.",
    });
  } catch (error) {
    console.error("POST /api/roles error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to create role.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role id.",
      });
    }

    const existing = await sql.query`
      SELECT TOP 1 RoleId, RoleName, Description, IsActive
      FROM dbo.Roles
      WHERE RoleId = ${roleId}
    `;
    const row = existing.recordset[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Role not found.",
      });
    }

    const roleName = String(req.body?.roleName || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    const isActive =
      req.body?.status != null
        ? parseStatusToIsActive(req.body.status, Boolean(row.IsActive))
        : row.IsActive
          ? 1
          : 0;
    const permissionIds = Array.isArray(req.body?.permissionIds)
      ? req.body.permissionIds
      : [];

    if (!roleName) {
      return res.status(400).json({
        success: false,
        message: "Role name is required.",
      });
    }

    const dup = await sql.query`
      SELECT TOP 1 RoleId
      FROM dbo.Roles
      WHERE RoleName = ${roleName}
        AND RoleId <> ${roleId}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message: "Role name already exists.",
      });
    }

    await withTransaction(async (transaction) => {
      const reqUpdate = new sql.Request(transaction);
      await reqUpdate.query`
        UPDATE dbo.Roles
        SET
          RoleName = ${roleName},
          Description = ${description},
          IsActive = ${isActive}
        WHERE RoleId = ${roleId}
      `;
      await replaceRolePermissions(roleId, permissionIds, transaction);
    });

    const updated = await sql.query`
      SELECT TOP 1 RoleId, RoleName, Description, IsActive
      FROM dbo.Roles
      WHERE RoleId = ${roleId}
    `;
    const savedPermissionIds = await getPermissionIdsForRole(roleId);

    res.json({
      success: true,
      data: mapRole(updated.recordset[0], savedPermissionIds),
      message: "Role updated.",
    });
  } catch (error) {
    console.error("PUT /api/roles/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to update role.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const roleId = Number(req.params.id);
    if (!Number.isFinite(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role id.",
      });
    }

    const existing = await sql.query`
      SELECT TOP 1 RoleId FROM dbo.Roles WHERE RoleId = ${roleId}
    `;
    if (!existing.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "Role not found.",
      });
    }

    const userCount = await sql.query`
      SELECT COUNT(1) AS Cnt
      FROM dbo.Users
      WHERE RoleId = ${roleId}
    `;
    if (Number(userCount.recordset[0]?.Cnt || 0) > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete role assigned to users.",
      });
    }

    await withTransaction(async (transaction) => {
      const reqDeletePerms = new sql.Request(transaction);
      await reqDeletePerms.query`
        DELETE FROM dbo.RolePermissions WHERE RoleId = ${roleId}
      `;
      const reqDeleteRole = new sql.Request(transaction);
      await reqDeleteRole.query`
        DELETE FROM dbo.Roles WHERE RoleId = ${roleId}
      `;
    });

    res.json({
      success: true,
      message: "Role deleted.",
    });
  } catch (error) {
    console.error("DELETE /api/roles/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to delete role.",
    });
  }
});

module.exports = router;
