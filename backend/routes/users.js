const express = require("express");
const bcrypt = require("bcryptjs");
const { sql } = require("../db");

const router = express.Router();

const SUPER_ADMIN_ROLE_ID = 1;
const BCRYPT_ROUNDS = 10;

/**
 * Is this username already taken by a DIFFERENT user?
 *
 * The comparison is done in SQL Server with LOWER(LTRIM(RTRIM(...))) on both
 * sides, so it does not depend on the database collation and is not fooled by
 * stored leading/trailing spaces.
 *
 * excludeUserId is the row being edited. It is bound as a typed, nullable
 * parameter: when it is null the exclusion is a no-op, so an absent or
 * non-numeric id can never be mistaken for a matching row (which would make
 * every new username look like a duplicate).
 *
 * @param {string} userName
 * @param {number|null|undefined} excludeUserId
 * @returns {Promise<{taken: boolean, userId: number|null}>}
 */
async function isUserNameTaken(userName, excludeUserId) {
  const candidate = String(userName == null ? "" : userName).trim();
  if (!candidate) return { taken: false, userId: null };

  /* Only a real, positive id excludes a row. Undefined / "" / NaN / 0 -> null. */
  const numericId = Number(excludeUserId);
  const exclude =
    Number.isInteger(numericId) && numericId > 0 ? numericId : null;

  const request = new sql.Request();
  request.input("UserName", sql.NVarChar(100), candidate);
  request.input("UserId", sql.Int, exclude);

  const result = await request.query(`
    SELECT TOP 1 UserId
    FROM dbo.Users
    WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@UserName)))
      AND (@UserId IS NULL OR UserId <> @UserId)
  `);

  const row = result.recordset[0];
  return {
    taken: Boolean(row),
    userId: row ? Number(row.UserId) : null,
  };
}

/*
  Who is performing the action, for CreatedBy / ModifiedBy.

  In THIS router body.userName and body.fullName describe the ACCOUNT being
  created or edited — not the person doing it — so the explicit actor fields
  take precedence. Falling back to body.userName here would stamp a new
  user's own name into CreatedBy.
*/
function actorFromBody(body = {}) {
  return {
    userName: body.actorUserName || "SYSTEM",
    fullName: body.actorFullName || body.actorUserName || "SYSTEM",
  };
}

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

function mapUser(row) {
  return {
    userId: Number(row.UserId),
    userName: row.UserName,
    fullName: row.FullName || "",
    email: row.Email || null,
    roleId: Number(row.RoleId),
    roleName: row.RoleName || "",
    status: mapIsActiveToStatus(Boolean(row.IsActive)),
    instituteId:
      row.InstituteId != null ? Number(row.InstituteId) : null,
    createdAt: row.CreatedAt,
    createdBy: row.CreatedBy || null,
    modifiedDate: row.ModifiedDate || null,
    modifiedBy: row.ModifiedBy || null,
  };
}

async function findUserById(userId) {
  const result = await sql.query`
    SELECT
      u.UserId,
      u.UserName,
      u.FullName,
      u.Email,
      u.RoleId,
      u.IsActive,
      u.InstituteId,
      u.CreatedAt,
      u.CreatedBy,
      u.ModifiedDate,
      u.ModifiedBy,
      r.RoleName
    FROM dbo.Users u
    INNER JOIN dbo.Roles r ON u.RoleId = r.RoleId
    WHERE u.UserId = ${userId}
  `;
  return result.recordset[0] || null;
}

router.get("/", async (req, res) => {
  try {
    const result = await sql.query`
      SELECT
        u.UserId,
        u.UserName,
        u.FullName,
        u.Email,
        u.RoleId,
        u.IsActive,
        u.InstituteId,
        u.CreatedAt,
        u.CreatedBy,
        u.ModifiedDate,
        u.ModifiedBy,
        r.RoleName
      FROM dbo.Users u
      INNER JOIN dbo.Roles r ON u.RoleId = r.RoleId
      ORDER BY u.UserName ASC, u.UserId ASC
    `;

    res.json({
      success: true,
      data: result.recordset.map(mapUser),
    });
  } catch (error) {
    console.error("GET /api/users error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load users.",
    });
  }
});

/*
 * GET /api/users/_diagnostics
 *
 * Answers one question: which SQL Server and which database is THIS running
 * backend actually reading dbo.Users from? Compare it with the connection
 * SSMS is using — if they differ, that is the whole bug.
 *
 * Declared BEFORE /:id so the router does not treat "_diagnostics" as an id.
 *
 * Returns names and counts only. It never returns passwords, password
 * hashes, connection strings, tokens or any other secret.
 *
 * Optional: ?userName=ao  ->  reports whether that username exists here,
 * using the exact same comparison the duplicate check uses.
 */
router.get("/_diagnostics", async (req, res) => {
  try {
    const info = await sql.query`
      SELECT
        CAST(@@SERVERNAME AS NVARCHAR(200))                        AS ServerName,
        CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(200))       AS MachineName,
        CAST(SERVERPROPERTY('InstanceName') AS NVARCHAR(200))      AS InstanceName,
        CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50))     AS ProductVersion,
        DB_NAME()                                                  AS DatabaseName,
        (SELECT COUNT(1) FROM dbo.Users)                           AS UserCount
    `;

    const row = info.recordset[0] || {};

    const probeName = String(req.query?.userName || "").trim();
    let probe = null;
    if (probeName) {
      const found = await isUserNameTaken(probeName, null);
      probe = {
        userName: probeName,
        exists: found.taken,
        userId: found.userId,
      };
    }

    res.json({
      success: true,
      message:
        "Connection actually in use by this backend. Compare with SSMS.",
      liveConnection: {
        serverName: row.ServerName || null,
        machineName: row.MachineName || null,
        /* null for the DEFAULT instance (MSSQLSERVER);
           "SQLEXPRESS" when this backend is talking to SQL Express. */
        instanceName: row.InstanceName || null,
        productVersion: row.ProductVersion || null,
        databaseName: row.DatabaseName || null,
        userCount: Number(row.UserCount || 0),
      },
      configured: {
        server: process.env.DB_SERVER || null,
        database: process.env.DB_DATABASE || null,
        port: process.env.DB_PORT || null,
        authentication:
          process.env.DB_USER && process.env.DB_PASSWORD
            ? "SQL login"
            : "Windows (Trusted_Connection)",
      },
      probe,
    });
  } catch (error) {
    console.error("GET /api/users/_diagnostics error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to read connection diagnostics.",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id.",
      });
    }

    const row = await findUserById(userId);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    res.json({
      success: true,
      data: mapUser(row),
    });
  } catch (error) {
    console.error("GET /api/users/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load user.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const userName = String(req.body?.userName || "").trim();
    const fullName = String(req.body?.fullName || "").trim();
    const password = String(req.body?.password || "");
    const roleId = Number(req.body?.roleId);
    const emailRaw = req.body?.email;
    const email =
      emailRaw == null || String(emailRaw).trim() === ""
        ? null
        : String(emailRaw).trim();
    const instituteId =
      req.body?.instituteId != null && req.body?.instituteId !== ""
        ? Number(req.body.instituteId)
        : null;
    const isActive = parseStatusToIsActive(req.body?.status, true);

    if (!userName) {
      return res.status(400).json({
        success: false,
        message: "Username is required.",
      });
    }
    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required.",
      });
    }
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Role is required.",
      });
    }

    const roleCheck = await sql.query`
      SELECT TOP 1 RoleId FROM dbo.Roles WHERE RoleId = ${roleId}
    `;
    if (!roleCheck.recordset[0]) {
      return res.status(400).json({
        success: false,
        message: "Invalid role.",
      });
    }

    /* New user: nothing to exclude, so pass null explicitly. */
    const dup = await isUserNameTaken(userName, null);
    if (dup.taken) {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const insert = await sql.query`
      INSERT INTO dbo.Users (
        UserName,
        PasswordHash,
        FullName,
        Email,
        RoleId,
        IsActive,
        InstituteId,
        CreatedBy
      )
      OUTPUT INSERTED.UserId
      VALUES (
        ${userName},
        ${passwordHash},
        ${fullName},
        ${email},
        ${roleId},
        ${isActive},
        ${instituteId},
        ${actor.fullName}
      )
    `;

    const userId = Number(insert.recordset[0].UserId);
    const row = await findUserById(userId);

    res.status(201).json({
      success: true,
      data: mapUser(row),
      message: "User created.",
    });
  } catch (error) {
    console.error("POST /api/users error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to create user.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id.",
      });
    }

    const existing = await findUserById(userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const userName = String(req.body?.userName || "").trim();
    const fullName = String(req.body?.fullName || "").trim();
    const roleId = Number(req.body?.roleId);
    const password = req.body?.password != null ? String(req.body.password) : "";
    const emailRaw = req.body?.email;
    const email =
      emailRaw == null || String(emailRaw).trim() === ""
        ? null
        : String(emailRaw).trim();
    const instituteId =
      req.body?.instituteId != null && req.body?.instituteId !== ""
        ? Number(req.body.instituteId)
        : null;
    const isActive =
      req.body?.status != null
        ? parseStatusToIsActive(req.body.status, Boolean(existing.IsActive))
        : existing.IsActive
          ? 1
          : 0;

    if (!userName) {
      return res.status(400).json({
        success: false,
        message: "Username is required.",
      });
    }
    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Role is required.",
      });
    }

    const roleCheck = await sql.query`
      SELECT TOP 1 RoleId FROM dbo.Roles WHERE RoleId = ${roleId}
    `;
    if (!roleCheck.recordset[0]) {
      return res.status(400).json({
        success: false,
        message: "Invalid role.",
      });
    }

    /* Editing: the row being edited is excluded, so a user keeping their
       own username is never reported as a duplicate of themselves. */
    const dup = await isUserNameTaken(userName, userId);
    if (dup.taken) {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    if (password.trim()) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await sql.query`
        UPDATE dbo.Users
        SET
          UserName = ${userName},
          FullName = ${fullName},
          Email = ${email},
          RoleId = ${roleId},
          IsActive = ${isActive},
          InstituteId = ${instituteId},
          PasswordHash = ${passwordHash},
          ModifiedDate = SYSDATETIME(),
          ModifiedBy = ${actor.fullName}
        WHERE UserId = ${userId}
      `;
    } else {
      await sql.query`
        UPDATE dbo.Users
        SET
          UserName = ${userName},
          FullName = ${fullName},
          Email = ${email},
          RoleId = ${roleId},
          IsActive = ${isActive},
          InstituteId = ${instituteId},
          ModifiedDate = SYSDATETIME(),
          ModifiedBy = ${actor.fullName}
        WHERE UserId = ${userId}
      `;
    }

    const row = await findUserById(userId);
    res.json({
      success: true,
      data: mapUser(row),
      message: "User updated.",
    });
  } catch (error) {
    console.error("PUT /api/users/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to update user.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id.",
      });
    }

    const existing = await findUserById(userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (Number(existing.RoleId) === SUPER_ADMIN_ROLE_ID) {
      const adminCount = await sql.query`
        SELECT COUNT(1) AS Cnt
        FROM dbo.Users
        WHERE RoleId = ${SUPER_ADMIN_ROLE_ID}
          AND UserId <> ${userId}
      `;
      if (Number(adminCount.recordset[0]?.Cnt || 0) === 0) {
        return res.status(409).json({
          success: false,
          message: "Cannot delete the last Super Admin user.",
        });
      }
    }

    await sql.query`
      DELETE FROM dbo.Users WHERE UserId = ${userId}
    `;

    res.json({
      success: true,
      message: "User deleted.",
    });
  } catch (error) {
    console.error("DELETE /api/users/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to delete user.",
    });
  }
});

module.exports = router;
module.exports.isUserNameTaken = isUserNameTaken;
