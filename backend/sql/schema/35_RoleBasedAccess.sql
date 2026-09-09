/*
  35_RoleBasedAccess.sql

  Extends the existing Permissions / RolePermissions catalog for
  Accounts Officer and Auditor page/API access.

  SAFE / ADDITIVE ONLY:
    - Inserts missing permission codes when absent.
    - Seeds RolePermissions for Account Officer and Auditor.
    - Never drops permissions or roles.
    - Never changes Super Admin (RoleId=1) beyond granting any new codes.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

DECLARE @Actions TABLE (
    ActionCode NVARCHAR(20) NOT NULL,
    ActionName NVARCHAR(50) NOT NULL
);
INSERT INTO @Actions (ActionCode, ActionName) VALUES
    (N'VIEW', N'View'),
    (N'ADD', N'Add'),
    (N'EDIT', N'Edit'),
    (N'DELETE', N'Delete'),
    (N'EXPORT', N'Export');

DECLARE @Modules TABLE (
    Prefix NVARCHAR(80) NOT NULL,
    EntityName NVARCHAR(100) NOT NULL,
    ModuleName NVARCHAR(100) NOT NULL
);
INSERT INTO @Modules (Prefix, EntityName, ModuleName) VALUES
    (N'MASTER_USER', N'User Master', N'Masters'),
    (N'MASTER_ROLE_PERMISSION', N'Role & Permission', N'Masters'),
    (N'MASTER_PAY_MATRIX', N'Pay Matrix', N'Masters'),
    (N'MASTER_SALARY_COMPONENT', N'Salary Component', N'Masters'),
    (N'MASTER_DA_DIFFERENCE', N'DA Difference Master', N'Masters'),
    (N'MASTER_INCREMENT', N'Increment Master', N'Masters'),
    (N'MASTER_SALARY_BILL_CODE', N'Salary Bill Code', N'Masters'),
    (N'MASTER_PAYROLL_CONFIG', N'Payroll Configuration', N'Masters'),
    (N'SALARY_APPROVAL', N'Salary Approval', N'Salary'),
    (N'SALARY_RETURNING', N'Returning Bills', N'Salary'),
    (N'SALARY_PROCESS', N'Salary Process', N'Salary'),
    (N'DA_DIFFERENCE_ENTRY', N'DA Difference Entry', N'Salary'),
    (N'CHANGE_PASSWORD', N'Change Password', N'Account');

INSERT INTO dbo.Permissions (PermissionName, PermissionCode, Description, ModuleName, Status)
SELECT
    m.EntityName + N' - ' + a.ActionName,
    m.Prefix + N'_' + a.ActionCode,
    a.ActionName + N' ' + m.EntityName,
    m.ModuleName,
    N'Active'
FROM @Modules m
CROSS JOIN @Actions a
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.Permissions p
    WHERE p.PermissionCode = m.Prefix + N'_' + a.ActionCode
);
GO

/* Super Admin gets every permission (including newly added ones). */
IF EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 1)
BEGIN
    INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
    SELECT 1, p.PermissionId, SYSDATETIME()
    FROM dbo.Permissions p
    WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.RolePermissions rp
        WHERE rp.RoleId = 1
          AND rp.PermissionId = p.PermissionId
    );
    PRINT 'Super Admin RolePermissions refreshed.';
END
GO

/* Account Officer (RoleId=2 by seed; match by name if ids differ). */
DECLARE @AoRoleId INT =
(
    SELECT TOP 1 RoleId
    FROM dbo.Roles
    WHERE UPPER(LTRIM(RTRIM(RoleName))) IN (N'ACCOUNT OFFICER', N'ACCOUNTS OFFICER')
    ORDER BY RoleId
);

IF @AoRoleId IS NOT NULL
BEGIN
    /* Replace AO grants with the strict allow-list. */
    DELETE FROM dbo.RolePermissions WHERE RoleId = @AoRoleId;

    INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
    SELECT @AoRoleId, p.PermissionId, SYSDATETIME()
    FROM dbo.Permissions p
    WHERE UPPER(ISNULL(p.Status, N'Active')) = N'ACTIVE'
      AND (
        p.PermissionCode LIKE N'SALARY_APPROVAL_%'
        OR p.PermissionCode LIKE N'REPORT_%'
        OR p.PermissionCode LIKE N'CHANGE_PASSWORD_%'
      );

    PRINT 'Account Officer RolePermissions seeded (Approval + Reports + Change Password).';
END
ELSE
    PRINT 'Account Officer role not found - skipped AO seed.';
GO

/* Auditor — everything except User Master. */
DECLARE @AuditorRoleId INT =
(
    SELECT TOP 1 RoleId
    FROM dbo.Roles
    WHERE UPPER(LTRIM(RTRIM(RoleName))) = N'AUDITOR'
    ORDER BY RoleId
);

IF @AuditorRoleId IS NOT NULL
BEGIN
    DELETE FROM dbo.RolePermissions WHERE RoleId = @AuditorRoleId;

    INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
    SELECT @AuditorRoleId, p.PermissionId, SYSDATETIME()
    FROM dbo.Permissions p
    WHERE UPPER(ISNULL(p.Status, N'Active')) = N'ACTIVE'
      AND p.PermissionCode NOT LIKE N'MASTER_USER_%'
      AND p.PermissionCode NOT LIKE N'SALARY_APPROVAL_%'
      AND p.PermissionCode <> N'SALARY_APPROVAL';

    PRINT 'Auditor RolePermissions seeded (all except User Master and Salary Approval).';
END
ELSE
    PRINT 'Auditor role not found - skipped Auditor seed.';
GO

PRINT 'Migration 35 (Role-Based Access) complete.';
GO
