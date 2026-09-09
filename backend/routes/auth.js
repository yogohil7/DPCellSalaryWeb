const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();

const { sql } = require("../db");
const {
  signAccessToken,
  loadPermissionsForRole,
  authenticate,
} = require("../middleware/auth");

function isDevLoggingEnabled() {
  return process.env.NODE_ENV !== "production";
}

// Login
router.post("/login", async (req, res) => {
  try {
    const rawUserName = req.body?.userName;
    const password = req.body?.password;

    if (!rawUserName || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    const userName = String(rawUserName).trim();

    if (isDevLoggingEnabled()) {
      console.log(`[auth/login] Attempt for username="${userName}"`);
    }

    const result = await sql.query`
      SELECT TOP 1
        u.UserId,
        u.UserName,
        u.PasswordHash,
        u.FullName,
        u.RoleId,
        u.IsActive,
        r.RoleName
      FROM dbo.Users u
      INNER JOIN dbo.Roles r
        ON u.RoleId = r.RoleId
      WHERE LOWER(LTRIM(RTRIM(u.UserName))) = LOWER(${userName})
      ORDER BY u.UserId
    `;

    if (result.recordset.length === 0) {
      if (isDevLoggingEnabled()) {
        console.log(`[auth/login] Username not found: "${userName}"`);
      }
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    const user = result.recordset[0];

    if (isDevLoggingEnabled()) {
      console.log(
        `[auth/login] Username found: UserId=${user.UserId}, IsActive=${Boolean(
          user.IsActive
        )}, RoleId=${user.RoleId}, RoleName=${user.RoleName}`
      );
    }

    if (!user.IsActive) {
      if (isDevLoggingEnabled()) {
        console.log(`[auth/login] Account inactive: UserId=${user.UserId}`);
      }
      return res.status(403).json({
        message: "User account is inactive",
      });
    }

    const storedHash = String(user.PasswordHash || "");
    if (!storedHash || !/^\$2[aby]\$/.test(storedHash)) {
      if (isDevLoggingEnabled()) {
        console.log(
          `[auth/login] PasswordHash missing or not bcrypt for UserId=${user.UserId}`
        );
      }
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    let passwordMatch = false;
    try {
      passwordMatch = await bcrypt.compare(password, storedHash);
    } catch (compareErr) {
      if (isDevLoggingEnabled()) {
        console.log(
          `[auth/login] bcrypt.compare failed for UserId=${user.UserId}: ${compareErr.message}`
        );
      }
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    if (isDevLoggingEnabled()) {
      console.log(
        `[auth/login] bcrypt.compare succeeded=${passwordMatch} for UserId=${user.UserId}`
      );
    }

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    const permissions = await loadPermissionsForRole(user.RoleId);

    if (isDevLoggingEnabled()) {
      console.log(
        `[auth/login] Login OK UserId=${user.UserId}, permissions=${permissions.length}`
      );
    }

    const userPayload = {
      userId: user.UserId,
      userName: user.UserName,
      fullName: user.FullName,
      roleId: user.RoleId,
      roleName: user.RoleName,
      permissions,
    };
    const token = signAccessToken(userPayload, permissions);

    res.json({
      message: "Login successful",
      token,
      user: userPayload,
      permissions,
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Server error during login",
    });
  }
});

/* Current session / permission refresh */
router.get("/me", authenticate, async (req, res) => {
  res.json({
    message: "OK",
    user: req.user,
    permissions: req.user.permissions || [],
  });
});

module.exports = router;
