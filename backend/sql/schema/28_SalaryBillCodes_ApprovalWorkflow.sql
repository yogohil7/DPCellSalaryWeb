/*
  28_SalaryBillCodes_ApprovalWorkflow.sql
  Expand SalaryBillCodes status workflow for Save Draft / Submit / Approval.
  Additive only — does not drop data.
*/

IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NULL
BEGIN
    RAISERROR(N'SalaryBillCodes table not found.', 16, 1);
    RETURN;
END
GO

/* Expand status check constraint */
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_SalaryBillCodes_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.SalaryBillCodes')
)
BEGIN
    ALTER TABLE dbo.SalaryBillCodes DROP CONSTRAINT CK_SalaryBillCodes_Status;
END
GO

ALTER TABLE dbo.SalaryBillCodes
ADD CONSTRAINT CK_SalaryBillCodes_Status CHECK (
    Status IN (
        N'OPEN',
        N'DRAFT',
        N'SUBMITTED',
        N'RESUBMITTED',
        N'RETURNED',
        N'VERIFIED',
        N'APPROVED',
        N'REJECTED',
        N'COMPLETED',
        N'LOCKED'
    )
);
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'SubmittedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD SubmittedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'SubmittedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD SubmittedBy NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ApprovedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ApprovedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ApprovedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ApprovedBy NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ReturnedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ReturnedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ReturnedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ReturnedBy NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ReturnReason') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ReturnReason NVARCHAR(1000) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'RejectedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD RejectedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'RejectedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD RejectedBy NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'RejectReason') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD RejectReason NVARCHAR(1000) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'VerifiedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD VerifiedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'VerifiedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD VerifiedBy NVARCHAR(200) NULL;
GO

PRINT 'SalaryBillCodes approval workflow columns/status ensured.';
GO
