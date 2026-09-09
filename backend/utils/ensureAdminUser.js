/**
 * Ensure the bootstrap admin user exists with a valid bcrypt password hash.
 *
 * Phase 9 (Part B) security change:
 *
 *   - The bootstrap password is NO LONGER a literal in this file. It is read
 *     from the BOOTSTRAP_ADMIN_PASSWORD environment variable and is never
 *     logged, returned, or included in any error message.
 *
 *   - When BOOTSTRAP_ADMIN_PASSWORD is not configured, no admin account is
 *     created and no password is written. Bootstrap is skipped safely.
 *
 *   - An admin whose stored hash is already a valid bcrypt hash is NEVER
 *     overwritten. Previously this routine re-hashed the built-in password on
 *     every startup and replaced the stored hash whenever it did not match,
 *     which made a server restart an undocumented password reset. A stored
 *     password is now only written when it is missing or not a bcrypt hash.
 *
 * The password is only ever held in memory long enough to bcrypt-hash it.
 */
const bcrypt = require("bcryptjs");
const { sql } = require("../db");

const ADMIN_USERNAME = "admin";
const ADMIN_FULL_NAME = "System Administrator";
const SUPER_ADMIN_ROLE_ID = 1;
const BCRYPT_ROUNDS = 10;

/**
 * The configured bootstrap password, or "" when bootstrap is disabled.
 * The value itself is never logged or returned.
 */
function bootstrapPassword() {
  return String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
}

/** A stored hash that bcrypt can actually verify against. */
function isValidBcryptHash(hash) {
  const h = String(hash || "");
  return /^\$2[aby]\$/.test(h) && h.length >= 50;
}

async function ensureSuperAdminRole() {
  const role = await sql.query`
    SELECT TOP 1 RoleId, RoleName, IsActive
    FROM dbo.Roles
    WHERE RoleId = ${SUPER_ADMIN_ROLE_ID}
       OR RoleName = N'Super Admin'
    ORDER BY CASE WHEN RoleId = ${SUPER_ADMIN_ROLE_ID} THEN 0 ELSE 1 END
  `;

  if (!role.recordset[0]) {
    await sql.query`
      SET IDENTITY_INSERT dbo.Roles ON;
      INSERT INTO dbo.Roles (RoleId, RoleName, IsActive)
      VALUES (${SUPER_ADMIN_ROLE_ID}, N'Super Admin', 1);
      SET IDENTITY_INSERT dbo.Roles OFF;
    `;
    console.log("[ensureAdmin] Created Super Admin role (RoleId=1).");
    return SUPER_ADMIN_ROLE_ID;
  }

  const roleId = Number(role.recordset[0].RoleId);
  if (!role.recordset[0].IsActive) {
    await sql.query`
      UPDATE dbo.Roles SET IsActive = 1 WHERE RoleId = ${roleId}
    `;
  }
  return roleId;
}

async function ensureSuperAdminPermissions(roleId) {
  const inserted = await sql.query`
    INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
    SELECT
      ${roleId},
      p.PermissionId,
      SYSDATETIME()
    FROM dbo.Permissions p
    WHERE UPPER(ISNULL(p.Status, N'Active')) = N'ACTIVE'
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.RolePermissions rp
        WHERE rp.RoleId = ${roleId}
          AND rp.PermissionId = p.PermissionId
      )
  `;
  const count = inserted.rowsAffected?.[0] || 0;
  if (count > 0) {
    console.log(
      `[ensureAdmin] Seeded ${count} RolePermissions for Super Admin.`
    );
  }
}

/**
 * @returns {Promise<{ action: string, userId: number|null }>}
 */
async function ensureAdminUser() {
  const roleId = await ensureSuperAdminRole();
  await ensureSuperAdminPermissions(roleId);

  const password = bootstrapPassword();

  const existing = await sql.query`
    SELECT TOP 1
      UserId,
      UserName,
      PasswordHash,
      RoleId,
      IsActive
    FROM dbo.Users
    WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(${ADMIN_USERNAME})
    ORDER BY UserId
  `;

  const user = existing.recordset[0] || null;

  /*
    No bootstrap password configured: never create an account and never write
    a password. Roles and permissions above are unaffected — they carry no
    credential — but nothing that could grant or reset access is touched.
  */
  if (!password) {
    if (!user) {
      console.log(
        "[ensureAdmin] BOOTSTRAP_ADMIN_PASSWORD is not configured and no admin " +
          "user exists. Bootstrap skipped; no account was created."
      );
      return { action: "skipped", userId: null };
    }
    console.log(
      "[ensureAdmin] BOOTSTRAP_ADMIN_PASSWORD is not configured. Existing admin " +
        "left untouched; no password was written."
    );
    return { action: "skipped", userId: Number(user.UserId) };
  }

  if (!user) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const insert = await sql.query`
      INSERT INTO dbo.Users (
        UserName,
        PasswordHash,
        FullName,
        RoleId,
        IsActive,
        CreatedBy
      )
      OUTPUT INSERTED.UserId
      VALUES (
        ${ADMIN_USERNAME},
        ${passwordHash},
        ${ADMIN_FULL_NAME},
        ${roleId},
        1,
        N'SYSTEM'
      )
    `;
    const userId = Number(insert.recordset[0].UserId);
    console.log(
      `[ensureAdmin] Created admin user (UserId=${userId}) with a bcrypt hash.`
    );
    return { action: "created", userId };
  }

  const userId = Number(user.UserId);
  const hashLooksValid = isValidBcryptHash(user.PasswordHash);

  /*
    An existing, usable password is authoritative. Bootstrap repairs a missing
    or corrupt hash; it is not a password-reset mechanism, so a valid hash is
    never replaced even if it does not match the configured password.
  */
  const needsPasswordRepair = !hashLooksValid;
  const needsActivate = !user.IsActive;
  const needsRole = Number(user.RoleId) !== Number(roleId);

  if (!needsPasswordRepair && !needsActivate && !needsRole) {
    console.log(
      `[ensureAdmin] Admin user OK (UserId=${userId}, RoleId=${roleId}, active). ` +
        "Stored password left unchanged."
    );
    return { action: "unchanged", userId };
  }

  if (needsPasswordRepair) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await sql.query`
      UPDATE dbo.Users
      SET
        PasswordHash = ${passwordHash},
        IsActive = 1,
        RoleId = ${roleId},
        FullName = CASE
          WHEN FullName IS NULL OR LTRIM(RTRIM(FullName)) = N''
          THEN ${ADMIN_FULL_NAME}
          ELSE FullName
        END,
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = N'SYSTEM'
      WHERE UserId = ${userId}
    `;
    console.log(
      `[ensureAdmin] Repaired a missing/invalid admin PasswordHash (UserId=${userId}).`
    );
    return { action: "repaired", userId };
  }

  await sql.query`
    UPDATE dbo.Users
    SET
      IsActive = 1,
      RoleId = ${roleId},
      ModifiedDate = SYSDATETIME(),
      ModifiedBy = N'SYSTEM'
    WHERE UserId = ${userId}
  `;
  console.log(
    `[ensureAdmin] Ensured admin IsActive=1 and Super Admin role (UserId=${userId}). ` +
      "Stored password left unchanged."
  );
  return { action: "updated", userId };
}

module.exports = {
  ensureAdminUser,
  ADMIN_USERNAME,
  bootstrapPassword,
  isValidBcryptHash,
};
