/*
  44_RevokeAuditorSalaryApproval.sql

  Auditor must not access Salary Bill Approval.
  Remove SALARY_APPROVAL_* grants from the Auditor role.
  Account Officer / Admin keep approval access via role middleware.
*/

DECLARE @AuditorRoleId INT =
(
    SELECT TOP 1 RoleId
    FROM dbo.Roles
    WHERE UPPER(LTRIM(RTRIM(RoleName))) = N'AUDITOR'
    ORDER BY RoleId
);

IF @AuditorRoleId IS NOT NULL
BEGIN
    DELETE rp
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
    WHERE rp.RoleId = @AuditorRoleId
      AND (
        p.PermissionCode LIKE N'SALARY_APPROVAL_%'
        OR p.PermissionCode = N'SALARY_APPROVAL'
      );

    PRINT 'Revoked SALARY_APPROVAL permissions from Auditor role.';
END
ELSE
    PRINT 'Auditor role not found - skipped.';
GO

PRINT '44_RevokeAuditorSalaryApproval.sql completed.';
GO
