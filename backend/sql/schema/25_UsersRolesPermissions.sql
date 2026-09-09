/*
  25_UsersRolesPermissions.sql
  Add Users.Email, create Permissions / RolePermissions, seed catalog.
  Uses existing dbo.Users and dbo.Roles (IsActive — no Roles.Status column).
*/
SET NOCOUNT ON;
GO

/* Users.Email */
IF COL_LENGTH(N'dbo.Users', N'Email') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD Email NVARCHAR(200) NULL;
    PRINT 'Added Users.Email';
END;
GO

/* Permissions */
IF OBJECT_ID(N'dbo.Permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Permissions (
        PermissionId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_Permissions PRIMARY KEY,
        PermissionName NVARCHAR(200) NOT NULL,
        PermissionCode NVARCHAR(100) NOT NULL
            CONSTRAINT UQ_Permissions_PermissionCode UNIQUE,
        Description NVARCHAR(500) NULL,
        ModuleName NVARCHAR(100) NOT NULL,
        Status NVARCHAR(20) NOT NULL
            CONSTRAINT DF_Permissions_Status DEFAULT (N'Active'),
        CONSTRAINT CK_Permissions_Status
            CHECK (Status IN (N'Active', N'Inactive'))
    );
    PRINT 'Created Permissions';
END;
GO

/* RolePermissions */
IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePermissions (
        RolePermissionId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_RolePermissions PRIMARY KEY,
        RoleId INT NOT NULL,
        PermissionId INT NOT NULL,
        CreatedDate DATETIME2(0) NOT NULL
            CONSTRAINT DF_RolePermissions_CreatedDate DEFAULT (SYSDATETIME()),
        CONSTRAINT UQ_RolePermissions_Role_Permission UNIQUE (RoleId, PermissionId),
        CONSTRAINT FK_RolePermissions_Roles
            FOREIGN KEY (RoleId) REFERENCES dbo.Roles (RoleId),
        CONSTRAINT FK_RolePermissions_Permissions
            FOREIGN KEY (PermissionId) REFERENCES dbo.Permissions (PermissionId)
    );
    PRINT 'Created RolePermissions';
END;
GO

/* Seed permission catalog */
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
    (N'DASHBOARD', N'Dashboard', N'Dashboard'),
    (N'MASTER_INSTITUTE', N'Institute', N'Masters'),
    (N'MASTER_SECTION', N'Section', N'Masters'),
    (N'MASTER_DESIGNATION', N'Designation', N'Masters'),
    (N'MASTER_EMPLOYEE', N'Employee', N'Masters'),
    (N'MASTER_PAY_REVISION', N'Pay Revision', N'Masters'),
    (N'MASTER_DA', N'DA', N'Masters'),
    (N'MASTER_HRA', N'HRA', N'Masters'),
    (N'MASTER_CLA', N'CLA', N'Masters'),
    (N'MASTER_MEDICAL_ALLOWANCE', N'Medical Allowance', N'Masters'),
    (N'MASTER_TRANSPORT_ALLOWANCE', N'Transport Allowance', N'Masters'),
    (N'SALARY_ENTRY', N'Salary Entry', N'Salary'),
    (N'SALARY_CALCULATION', N'Salary Calculation', N'Salary'),
    (N'SALARY_VARIATION', N'Salary Variation', N'Salary'),
    (N'SALARY_FINAL_BILL', N'Final Salary Bill', N'Salary'),
    (N'REPORT_SALARY', N'Salary Reports', N'Reports'),
    (N'REPORT_VARIATION', N'Variation Reports', N'Reports'),
    (N'REPORT_BILL', N'Bill Reports', N'Reports');

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

/* Super Admin (RoleId = 1) gets all permissions */
IF EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleId = 1)
BEGIN
    INSERT INTO dbo.RolePermissions (RoleId, PermissionId, CreatedDate)
    SELECT
        1,
        p.PermissionId,
        SYSDATETIME()
    FROM dbo.Permissions p
    WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.RolePermissions rp
        WHERE rp.RoleId = 1
          AND rp.PermissionId = p.PermissionId
    );
    PRINT 'Seeded RolePermissions for Super Admin (RoleId=1)';
END;
GO

PRINT '25_UsersRolesPermissions.sql completed.';
GO
