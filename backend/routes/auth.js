const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();

/* The same cost factor routes/users.js and utils/ensureAdminUser.js use. */
const BCRYPT_ROUNDS = 10;

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

/*
  CHANGE PASSWORD — the signed-in user's own password, and only their own.

  IDENTITY
    The user id comes from req.user.userId, which authenticate() derives from
    the JWT's `sub` claim and re-reads from dbo.Users. A userId in the request
    body is deliberately ignored: there is no code path here by which one user
    can change another user's password.

  VERIFICATION AND STORAGE
    Reuses the login path's own primitives — the same dbo.Users.PasswordHash
    column, the same bcrypt.compare() check, the same bcrypt.hash() with
    BCRYPT_ROUNDS. Nothing new is introduced and no plaintext is stored.

  WHAT IS NEVER RETURNED OR LOGGED
    No password, no hash, and no password-shaped value appears in any response
    or log line, on success or failure.

  SESSION
    The existing token stays valid. Nothing in this project's auth design ties
    a token to the password (the JWT carries `sub`, not the hash), so there is
    no reason to force a re-login, and forcing one would change login
    behaviour.
*/
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;

    if (!currentPassword) {
      return res.status(400).json({
        message: "Current password is required.",
      });
    }
    if (!newPassword) {
      return res.status(400).json({
        message: "New password is required.",
      });
    }
    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({
        message: "The new password must be different from the current password.",
      });
    }

    /* The authenticated user only. */
    const userId = Number(req.user?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const result = await sql.query`
      SELECT TOP 1 u.UserId, u.PasswordHash, u.IsActive
      FROM dbo.Users u
      WHERE u.UserId = ${userId}
    `;

    const user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }
    if (!user.IsActive) {
      return res.status(403).json({ message: "User account is inactive" });
    }

    /* Same stored-hash validity rule the login path applies. */
    const storedHash = String(user.PasswordHash || "");
    if (!storedHash || !/^\$2[aby]\$/.test(storedHash)) {
      return res.status(400).json({
        message: "Current password is incorrect.",
      });
    }

    let matches = false;
    try {
      matches = await bcrypt.compare(String(currentPassword), storedHash);
    } catch (compareErr) {
      console.error("change-password compare error:", compareErr.message);
      matches = false;
    }
    if (!matches) {
      return res.status(400).json({
        message: "Current password is incorrect.",
      });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);

    /* Scoped to the authenticated user id — never a body-supplied id. */
    await sql.query`
      UPDATE dbo.Users
      SET PasswordHash = ${passwordHash},
          ModifiedDate = SYSDATETIME()
      WHERE UserId = ${userId}
    `;

    return res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("change-password error:", error.message);
    return res.status(500).json({
      message: "Server error while changing the password.",
    });
  }
});

module.exports = router;
