const jwt = require("jsonwebtoken");
const { sql } = require("../db");

/*
  JWT secret — configuration only, never a literal.

  A hard-coded fallback previously meant that a deployment with no
  JWT_SECRET set would silently sign tokens with a secret committed to the
  source tree, so anyone with repository access could forge a token for any
  role. The fallback is gone: the value must come from the environment.

  requireJwtSecret() throws when it is missing or obviously weak. server.js
  calls it once at startup so the process fails fast and visibly rather than
  running insecurely; the secret itself is never logged or returned.

  Deliberately NOT auto-generated per start: a random secret would invalidate
  every session on every restart.
*/
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const MIN_SECRET_LENGTH = 16;

function requireJwtSecret() {
  const secret = String(JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured. Set JWT_SECRET in backend/.env " +
        "(see backend/.env.example) before starting the server."
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (minimum ${MIN_SECRET_LENGTH} characters).`
    );
  }
  return secret;
}

function normalizeRole(roleName) {
  const raw = String(roleName || "")
    .trim()
    .toUpperCase();
  if (!raw) return "OTHER";
  if (raw.includes("SUPER") || raw === "ADMIN" || raw.includes("ADMINISTRATOR")) {
    return "ADMIN";
  }
  if (raw.includes("ACCOUNT") && raw.includes("OFFICER")) {
    return "ACCOUNT_OFFICER";
  }
  if (raw.includes("AUDITOR")) return "AUDITOR";
  return "OTHER";
}

function isAdminRole(roleName) {
  return normalizeRole(roleName) === "ADMIN";
}

function signAccessToken(user, permissions = []) {
  return jwt.sign(
    {
      sub: Number(user.userId ?? user.UserId),
      userName: user.userName || user.UserName,
      fullName: user.fullName || user.FullName || "",
      roleId: Number(user.roleId ?? user.RoleId),
      roleName: user.roleName || user.RoleName || "",
      permissions: Array.isArray(permissions) ? permissions : [],
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
}

async function loadPermissionsForRole(roleId) {
  const result = await sql.query`
    SELECT p.PermissionCode
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
    WHERE rp.RoleId = ${Number(roleId)}
      AND UPPER(ISNULL(p.Status, N'Active')) = N'ACTIVE'
    ORDER BY p.PermissionCode ASC
  `;
  return result.recordset.map((row) => String(row.PermissionCode));
}

function hasPermission(user, permissionCode) {
  if (!user) return false;
  if (isAdminRole(user.roleName)) return true;
  const code = String(permissionCode || "").toUpperCase();
  const list = Array.isArray(user.permissions) ? user.permissions : [];
  return list.some((p) => String(p).toUpperCase() === code);
}

function hasAnyPermission(user, codes = []) {
  if (!user) return false;
  if (isAdminRole(user.roleName)) return true;
  return (codes || []).some((code) => hasPermission(user, code));
}

function hasPermissionPrefix(user, prefix) {
  if (!user) return false;
  if (isAdminRole(user.roleName)) return true;
  const needle = String(prefix || "").toUpperCase();
  const list = Array.isArray(user.permissions) ? user.permissions : [];
  return list.some((p) => String(p).toUpperCase().startsWith(needle));
}

async function authenticate(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({
        message: "Invalid or expired session. Please log in again.",
      });
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid session subject." });
    }

    const result = await sql.query`
      SELECT TOP 1
        u.UserId,
        u.UserName,
        u.FullName,
        u.RoleId,
        u.IsActive,
        r.RoleName
      FROM dbo.Users u
      INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
      WHERE u.UserId = ${userId}
    `;
    const row = result.recordset[0];
    if (!row || !row.IsActive) {
      return res.status(401).json({
        message: "User account is inactive or not found.",
      });
    }

    const permissions = await loadPermissionsForRole(row.RoleId);
    req.user = {
      userId: Number(row.UserId),
      userName: row.UserName,
      fullName: row.FullName || row.UserName,
      roleId: Number(row.RoleId),
      roleName: row.RoleName,
      roleKey: normalizeRole(row.RoleName),
      permissions,
    };
    return next();
  } catch (error) {
    console.error("authenticate error:", error);
    return res.status(500).json({ message: "Authentication failed." });
  }
}

function requirePermission(...codes) {
  const required = codes.flat().filter(Boolean);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required." });
    }
    if (isAdminRole(req.user.roleName)) return next();
    if (hasAnyPermission(req.user, required)) return next();
    return res.status(403).json({
      message: "You do not have permission to perform this action.",
      required: required,
    });
  };
}

function requirePermissionPrefix(...prefixes) {
  const list = prefixes.flat().filter(Boolean);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required." });
    }
    if (isAdminRole(req.user.roleName)) return next();
    if (list.some((prefix) => hasPermissionPrefix(req.user, prefix))) {
      return next();
    }
    return res.status(403).json({
      message: "You do not have permission to perform this action.",
      requiredPrefix: list,
    });
  };
}

function requireRoles(...roleKeys) {
  const allowed = roleKeys.flat().map((r) => String(r).toUpperCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required." });
    }
    if (isAdminRole(req.user.roleName)) return next();
    const key = normalizeRole(req.user.roleName);
    if (allowed.includes(key)) return next();
    return res.status(403).json({
      message: "You do not have permission to perform this action.",
      role: req.user.roleName,
    });
  };
}

module.exports = {
  requireJwtSecret,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  normalizeRole,
  isAdminRole,
  signAccessToken,
  loadPermissionsForRole,
  hasPermission,
  hasAnyPermission,
  hasPermissionPrefix,
  authenticate,
  requirePermission,
  requirePermissionPrefix,
  requireRoles,
};
