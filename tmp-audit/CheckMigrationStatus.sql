/*
===============================================================================
  MIGRATION STATUS PROBE - DPCELLSalaryWebDB                        READ-ONLY
===============================================================================
  Determines, for migrations 01-47, whether the schema objects each one is
  meant to create are actually present in the live database.

  This project has NO migration-tracking table. Nothing here creates one.
  Status is inferred purely from schema metadata.

  SAFETY
    Reads only INFORMATION_SCHEMA and the sys.* catalog views.
    No INSERT, UPDATE, DELETE, MERGE, ALTER, DROP or CREATE of any user object.
    Touches no salary data and no JUN-2026 row.
    (One #temp table is used to hold results; it is session-scoped.)

  HOW TO READ THE RESULT
    PRESENT   every probed object exists
    MISSING   none of the probed objects exist
    PARTIAL   some exist - the migration did not complete, investigate
    UNCERTAIN data-only migration; schema cannot prove it ran

  Usage:
    sqlcmd -S YUG-PC\SQLEXPRESS -d DPCELLSalaryWebDB -E -i CheckMigrationStatus.sql -o MigrationStatus.txt
===============================================================================
*/

SET NOCOUNT ON;

SELECT DB_NAME() AS [Database], SUSER_SNAME() AS [LoginContext],
       CONVERT(varchar(30), SYSDATETIME(), 120) AS [CheckedAt];

DECLARE @p TABLE (
    Migration varchar(4), Expected nvarchar(200), ObjKind varchar(12),
    TableName nvarchar(128) NULL, ObjName nvarchar(200)
);

INSERT INTO @p (Migration, Expected, ObjKind, TableName, ObjName) VALUES
 ('01','Database + first master table','TABLE',NULL,'Sections'),
 ('02','Master tables','TABLE',NULL,'Institutes'),
 ('02','Master tables','TABLE',NULL,'Designations'),
 ('02','Master tables','TABLE',NULL,'Districts'),
 ('02','Master tables','TABLE',NULL,'CityClasses'),
 ('02','Master tables','TABLE',NULL,'AuditLogs'),
 ('02','Master tables','TABLE',NULL,'Users'),
 ('02','Master tables','TABLE',NULL,'Roles'),
 ('03','Master foreign keys','CONSTRAINT',NULL,'FK_EmployeeMaster_Section'),
 ('03','Master foreign keys','CONSTRAINT',NULL,'FK_Institutes_Districts'),
 ('03','Master foreign keys','CONSTRAINT',NULL,'FK_Institutes_CityClasses'),
 ('03','Master foreign keys','CONSTRAINT',NULL,'FK_HRAMaster_CityClass'),
 ('04','Master indexes','INDEX','Institutes','IX_Institutes_DistrictId'),
 ('04','Master indexes','INDEX','Institutes','IX_Institutes_CityClassId'),
 ('04','Master indexes','INDEX','Sections','UQ_Sections_SectionCode'),
 ('05','Pay revision tables','TABLE',NULL,'PayRevisionMaster'),
 ('05','Pay revision tables','TABLE',NULL,'PayMatrixMaster'),
 ('06','Pay matrix unique index','INDEX','PayMatrixMaster','UQ_PayMatrixMaster_Revision_Level_Cell'),
 ('07','Employee master','TABLE',NULL,'EmployeeMaster'),
 ('07','Employee pay history','TABLE',NULL,'EmployeePayHistory'),
 ('07','EmployeeMaster.DateOfJoining','COLUMN','EmployeeMaster','DateOfJoining'),
 ('07','EmployeeMaster.DateOfRetirement','COLUMN','EmployeeMaster','DateOfRetirement'),
 ('08','Core stored procedures','PROC',NULL,'usp_Salary_GetEmployeeCalculation'),
 ('08','Core stored procedures','PROC',NULL,'usp_PayMatrix_Save'),
 ('08','Core stored procedures','PROC',NULL,'usp_EmployeePayHistory_Save'),
 ('11','Salary component tables','TABLE',NULL,'SalaryComponentMaster'),
 ('11','Salary component tables','TABLE',NULL,'SalaryComponentRule'),
 ('11','Salary component tables','TABLE',NULL,'SalaryEmployeeComponentDetails'),
 ('12','Salary component FK','CONSTRAINT',NULL,'FK_SCR_SalaryComponent'),
 ('12','Salary component index','INDEX','SalaryComponentRule','IX_SCR_PayRevision'),
 ('14','Salary component procedures','PROC',NULL,'usp_SalaryComponent_Save'),
 ('14','Salary component procedures','PROC',NULL,'usp_SalaryComponentRule_Save'),
 ('16','EmployeeMaster.PayLevel','COLUMN','EmployeeMaster','PayLevel'),
 ('16','EmployeeMaster.PayMatrixCellNo','COLUMN','EmployeeMaster','PayMatrixCellNo'),
 ('17','PayMatrixId nullable + FK','CONSTRAINT',NULL,'FK_EmployeeMaster_PayMatrix'),
 ('18','Salary calc employee type','PROC',NULL,'usp_Salary_GetEmployeeCalculation'),
 ('19','Variation report proc','PROC',NULL,'usp_Salary_VariationReport'),
 ('20','Pay matrix import proc','PROC',NULL,'usp_PayMatrix_Import'),
 ('21','Payroll configuration table','TABLE',NULL,'EmployeePayrollConfiguration'),
 ('21','Payroll configuration proc','PROC',NULL,'usp_EmployeePayrollConfiguration_Save'),
 ('22','Employee id allocate proc','PROC',NULL,'usp_Employee_AllocateId'),
 ('22','Employee id peek proc','PROC',NULL,'usp_Employee_PeekNextId'),
 ('22','EmployeeCode unique index','INDEX','EmployeeMaster','UQ_EmployeeMaster_EmployeeCode'),
 ('23','Designation pay matrix mapping','TABLE',NULL,'DesignationPayMatrixMapping');

INSERT INTO @p (Migration, Expected, ObjKind, TableName, ObjName) VALUES
 ('24','SED snapshot ChequeAmount','COLUMN','SalaryEmployeeDetails','ChequeAmount'),
 ('24','SED snapshot NPPA','COLUMN','SalaryEmployeeDetails','NPPA'),
 ('24','SED snapshot NPSAdvance','COLUMN','SalaryEmployeeDetails','NPSAdvance'),
 ('24','SED snapshot PayLevel','COLUMN','SalaryEmployeeDetails','PayLevel'),
 ('24','SED snapshot AsOfDate','COLUMN','SalaryEmployeeDetails','AsOfDate'),
 ('25','Permissions table','TABLE',NULL,'Permissions'),
 ('25','RolePermissions table','TABLE',NULL,'RolePermissions'),
 ('26','SED CLA','COLUMN','SalaryEmployeeDetails','CLA'),
 ('26','SED CLAMasterId','COLUMN','SalaryEmployeeDetails','CLAMasterId'),
 ('27','SED DAPercentage','COLUMN','SalaryEmployeeDetails','DAPercentage'),
 ('27','SED HRAPercentage','COLUMN','SalaryEmployeeDetails','HRAPercentage'),
 ('28','BillCodes ApprovedBy','COLUMN','SalaryBillCodes','ApprovedBy'),
 ('28','BillCodes SubmittedDate','COLUMN','SalaryBillCodes','SubmittedDate'),
 ('28','BillCodes ReturnReason','COLUMN','SalaryBillCodes','ReturnReason'),
 ('28','BillCodes RejectedDate','COLUMN','SalaryBillCodes','RejectedDate'),
 ('29','Institute workflow table','TABLE',NULL,'SalaryBillInstituteWorkflow'),
 ('29','Approval history table','TABLE',NULL,'SalaryBillApprovalHistory'),
 ('29','Workflow unique key','CONSTRAINT',NULL,'UQ_SBIW_Bill_Institute'),
 ('30','Salary detail history table','TABLE',NULL,'SalaryEmployeeDetailHistory'),
 ('31','Workflow LockedBy','COLUMN','SalaryBillInstituteWorkflow','LockedBy'),
 ('31','Workflow LockedDate','COLUMN','SalaryBillInstituteWorkflow','LockedDate'),
 ('31','Workflow bill/status index','INDEX','SalaryBillInstituteWorkflow','IX_SBIW_Bill_Status'),
 ('32','ComponentRule EmployeeId','COLUMN','SalaryComponentRule','EmployeeId'),
 ('32','ComponentRule employee FK','CONSTRAINT',NULL,'FK_SCR_Employee'),
 ('33','DA Difference bill','TABLE',NULL,'DADifferenceBill'),
 ('33','DA Difference employee details','TABLE',NULL,'DADifferenceEmployeeDetails'),
 ('33','DA Difference month details','TABLE',NULL,'DADifferenceMonthDetails'),
 ('33','Employee increment','TABLE',NULL,'EmployeeIncrement'),
 ('33','EmployeeMaster.IncrementDate','COLUMN','EmployeeMaster','IncrementDate'),
 ('33','SED.IncrementId','COLUMN','SalaryEmployeeDetails','IncrementId'),
 ('34','DA month NPSDeduction','COLUMN','DADifferenceMonthDetails','NPSDeduction'),
 ('34','DA month NPSManual','COLUMN','DADifferenceMonthDetails','NPSManual'),
 ('34','DA emp TotalNPSDeduction','COLUMN','DADifferenceEmployeeDetails','TotalNPSDeduction'),
 ('34','DA emp TotalNetDifferenceAmount','COLUMN','DADifferenceEmployeeDetails','TotalNetDifferenceAmount'),
 ('34','SED IncrementId index','INDEX','SalaryEmployeeDetails','IX_SED_IncrementId'),
 ('36','Payroll config as-of proc','PROC',NULL,'usp_EmployeePayrollConfiguration_GetByEmployee'),
 ('37','Workflow BillNo','COLUMN','SalaryBillInstituteWorkflow','BillNo'),
 ('37','Workflow BillDate','COLUMN','SalaryBillInstituteWorkflow','BillDate'),
 ('38','DA Difference month lock','TABLE',NULL,'DADifferenceMonthLock'),
 ('38','DA month lock unique key','CONSTRAINT',NULL,'UQ_DADiffMonthLock_YearMonth'),
 ('39','BillCodes IsArchived','COLUMN','SalaryBillCodes','IsArchived'),
 ('42','SED NPSManual','COLUMN','SalaryEmployeeDetails','NPSManual'),
 ('43','BillCodes period unique index','INDEX','SalaryBillCodes','UQ_SalaryBillCodes_Bill_Salary_Period_Category_Type'),
 ('45','Workflow NPSScheduleNo','COLUMN','SalaryBillInstituteWorkflow','NPSScheduleNo'),
 ('46','SED TAManual','COLUMN','SalaryEmployeeDetails','TAManual'),
 ('47','NPS schedule header','TABLE',NULL,'NpsScheduleHeader'),
 ('47','NPS schedule details','TABLE',NULL,'NpsScheduleDetails'),
 ('47','NPS schedule FK','CONSTRAINT',NULL,'FK_NpsScheduleDetails_Header');

/* ---- Resolve every probe against the live catalog ---- */
SELECT p.Migration, p.Expected, p.ObjKind,
       ISNULL(p.TableName,'-') AS [Table], p.ObjName,
       CASE WHEN
         (p.ObjKind = 'TABLE' AND EXISTS (
             SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
             WHERE s.name = 'dbo' AND t.name = p.ObjName))
      OR (p.ObjKind = 'COLUMN' AND EXISTS (
             SELECT 1 FROM sys.columns c
             JOIN sys.tables t ON t.object_id = c.object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             WHERE s.name = 'dbo' AND t.name = p.TableName AND c.name = p.ObjName))
      OR (p.ObjKind = 'INDEX' AND EXISTS (
             SELECT 1 FROM sys.indexes i
             JOIN sys.tables t ON t.object_id = i.object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             WHERE s.name = 'dbo' AND t.name = p.TableName AND i.name = p.ObjName))
      OR (p.ObjKind = 'PROC' AND EXISTS (
             SELECT 1 FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = 'dbo' AND o.name = p.ObjName AND o.type IN ('P','PC')))
      OR (p.ObjKind = 'CONSTRAINT' AND (
             EXISTS (SELECT 1 FROM sys.objects o
                     WHERE o.name = p.ObjName AND o.type IN ('F','UQ','PK','C','D'))
          OR EXISTS (SELECT 1 FROM sys.indexes i WHERE i.name = p.ObjName)))
         THEN 'FOUND' ELSE 'NOT FOUND' END AS Result
INTO #detail
FROM @p p;

SELECT 'PER-OBJECT DETAIL' AS Section, * FROM #detail
ORDER BY Migration, Expected, ObjName;

SELECT 'MIGRATION ROLLUP' AS Section,
       Migration,
       COUNT(*)                                            AS ObjectsProbed,
       SUM(CASE WHEN Result = 'FOUND' THEN 1 ELSE 0 END)   AS ObjectsFound,
       CASE
         WHEN SUM(CASE WHEN Result = 'FOUND' THEN 1 ELSE 0 END) = COUNT(*) THEN 'PRESENT'
         WHEN SUM(CASE WHEN Result = 'FOUND' THEN 1 ELSE 0 END) = 0        THEN 'MISSING'
         ELSE 'PARTIAL - INVESTIGATE'
       END AS Status
FROM #detail
GROUP BY Migration
ORDER BY Migration;

SELECT 'NOT SCHEMA-DETECTABLE' AS Section, Migration, Note FROM (VALUES
 ('00','Runner script - orchestrates the others; nothing of its own to detect'),
 ('09','Seeds test master data - UNCERTAIN, data transformation cannot be proven from schema'),
 ('10','Validation queries only - nothing to detect'),
 ('13','Seeds SalaryComponentMaster - UNCERTAIN, data transformation cannot be proven from schema'),
 ('15','Validation queries only - nothing to detect'),
 ('35','Seeds roles/permissions rows - UNCERTAIN, data transformation cannot be proven from schema'),
 ('40','Seeds TA city class Z - UNCERTAIN, data transformation cannot be proven from schema'),
 ('41','Syncs institute district/city class - UNCERTAIN, data transformation cannot be proven from schema'),
 ('44','Revokes auditor SALARY_APPROVAL rows - UNCERTAIN, data transformation cannot be proven from schema')
) v(Migration, Note) ORDER BY Migration;

/* Supporting evidence for the data-only migrations. Row counts are evidence,
   never proof that a specific migration script executed. */
SELECT 'SEED EVIDENCE' AS Section, 'SalaryComponentMaster' AS TableName, COUNT(*) AS [Rows] FROM dbo.SalaryComponentMaster
UNION ALL SELECT 'SEED EVIDENCE','Permissions',     COUNT(*) FROM dbo.Permissions
UNION ALL SELECT 'SEED EVIDENCE','RolePermissions', COUNT(*) FROM dbo.RolePermissions
UNION ALL SELECT 'SEED EVIDENCE','Roles',           COUNT(*) FROM dbo.Roles;

/* Migration 44: any Auditor role still holding a SALARY_APPROVAL permission
   would mean it has NOT been applied. Zero is consistent with applied. */
SELECT 'MIGRATION 44 EVIDENCE' AS Section,
       COUNT(*) AS AuditorSalaryApprovalGrantsRemaining
FROM dbo.RolePermissions rp
JOIN dbo.Roles r       ON r.RoleId = rp.RoleId
JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
WHERE UPPER(r.RoleName) LIKE '%AUDITOR%'
  AND UPPER(p.PermissionCode) LIKE 'SALARY_APPROVAL%';

DROP TABLE #detail;
