/* Institute locks are independent; header LOCKED is set only after all are locked. */
IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'LockedDate') IS NULL
  ALTER TABLE dbo.SalaryBillInstituteWorkflow ADD LockedDate DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'LockedBy') IS NULL
  ALTER TABLE dbo.SalaryBillInstituteWorkflow ADD LockedBy NVARCHAR(200) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_SBIW_Status')
  ALTER TABLE dbo.SalaryBillInstituteWorkflow DROP CONSTRAINT CK_SBIW_Status;
GO
ALTER TABLE dbo.SalaryBillInstituteWorkflow ADD CONSTRAINT CK_SBIW_Status CHECK (
  Status IN (N'OPEN', N'DRAFT', N'SUBMITTED', N'RESUBMITTED', N'RETURNED', N'VERIFIED', N'APPROVED', N'REJECTED', N'LOCKED')
);
GO
CREATE INDEX IX_SBIW_Bill_Status ON dbo.SalaryBillInstituteWorkflow (SalaryBillCodeId, Status);
GO
