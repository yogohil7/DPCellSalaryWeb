/*
  29_SalaryBillInstituteWorkflow.sql
  Institute-scoped salary approval workflow + permanent approval history.
  Additive only.
*/

IF OBJECT_ID(N'dbo.SalaryBillInstituteWorkflow', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryBillInstituteWorkflow (
        WorkflowId              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SalaryBillInstituteWorkflow PRIMARY KEY,
        SalaryBillCodeId        INT NOT NULL,
        InstituteId             INT NULL,
        InstituteCode           NVARCHAR(50) NOT NULL,
        Status                  NVARCHAR(20) NOT NULL
            CONSTRAINT DF_SBIW_Status DEFAULT (N'DRAFT'),
        SubmittedDate           DATETIME2(0) NULL,
        SubmittedBy             NVARCHAR(200) NULL,
        SubmittedByUserId       INT NULL,
        ReturnedDate            DATETIME2(0) NULL,
        ReturnedBy              NVARCHAR(200) NULL,
        ReturnedByUserId        INT NULL,
        ReturnedToAuditorId     INT NULL,
        ReturnedRemarks         NVARCHAR(1000) NULL,
        ResubmittedDate         DATETIME2(0) NULL,
        ResubmittedBy           NVARCHAR(200) NULL,
        ResubmittedByUserId     INT NULL,
        VerifiedDate            DATETIME2(0) NULL,
        VerifiedBy              NVARCHAR(200) NULL,
        ApprovedDate            DATETIME2(0) NULL,
        ApprovedBy              NVARCHAR(200) NULL,
        RejectedDate            DATETIME2(0) NULL,
        RejectedBy              NVARCHAR(200) NULL,
        RejectReason            NVARCHAR(1000) NULL,
        AssignedAuditorId       INT NULL,
        CreatedDate             DATETIME2(0) NOT NULL CONSTRAINT DF_SBIW_CreatedDate DEFAULT (SYSUTCDATETIME()),
        UpdatedDate             DATETIME2(0) NULL,
        UpdatedBy               NVARCHAR(200) NULL,
        CONSTRAINT UQ_SBIW_Bill_Institute UNIQUE (SalaryBillCodeId, InstituteCode),
        CONSTRAINT CK_SBIW_Status CHECK (
            Status IN (
                N'OPEN', N'DRAFT', N'SUBMITTED', N'RESUBMITTED',
                N'RETURNED', N'VERIFIED', N'APPROVED', N'REJECTED'
            )
        )
    );

    CREATE INDEX IX_SBIW_Status ON dbo.SalaryBillInstituteWorkflow (Status);
    CREATE INDEX IX_SBIW_ReturnedToAuditorId ON dbo.SalaryBillInstituteWorkflow (ReturnedToAuditorId);
    PRINT 'Created dbo.SalaryBillInstituteWorkflow';
END
GO

IF OBJECT_ID(N'dbo.SalaryBillApprovalHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryBillApprovalHistory (
        HistoryId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SalaryBillApprovalHistory PRIMARY KEY,
        SalaryBillCodeId INT NOT NULL,
        InstituteCode   NVARCHAR(50) NULL,
        Action          NVARCHAR(40) NOT NULL,
        FromStatus      NVARCHAR(20) NULL,
        ToStatus        NVARCHAR(20) NULL,
        ActionBy        NVARCHAR(200) NULL,
        ActionByUserId  INT NULL,
        ActionDate      DATETIME2(0) NOT NULL CONSTRAINT DF_SBAH_ActionDate DEFAULT (SYSUTCDATETIME()),
        AssignedToUserId INT NULL,
        Remarks         NVARCHAR(1000) NULL
    );
    CREATE INDEX IX_SBAH_Bill ON dbo.SalaryBillApprovalHistory (SalaryBillCodeId, InstituteCode, ActionDate);
    PRINT 'Created dbo.SalaryBillApprovalHistory';
END
GO

/* Keep header columns in sync for reporting (reuse if already present). */
IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ReturnedToAuditorId') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ReturnedToAuditorId INT NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ResubmittedDate') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ResubmittedDate DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.SalaryBillCodes', N'ResubmittedBy') IS NULL
    ALTER TABLE dbo.SalaryBillCodes ADD ResubmittedBy NVARCHAR(200) NULL;
GO

/* Backfill institute workflow rows from existing salary details + bill status. */
INSERT INTO dbo.SalaryBillInstituteWorkflow (
    SalaryBillCodeId,
    InstituteId,
    InstituteCode,
    Status,
    SubmittedDate,
    SubmittedBy,
    ReturnedDate,
    ReturnedBy,
    ReturnedRemarks,
    ApprovedDate,
    ApprovedBy,
    VerifiedDate,
    VerifiedBy,
    CreatedDate,
    UpdatedDate,
    UpdatedBy
)
SELECT
    d.SalaryBillCodeId,
    i.InstituteId,
    d.InstituteCode,
    CASE
        WHEN UPPER(b.Status) IN (
            N'SUBMITTED', N'RESUBMITTED', N'RETURNED', N'VERIFIED',
            N'APPROVED', N'REJECTED', N'DRAFT'
        ) THEN UPPER(b.Status)
        WHEN UPPER(b.Status) = N'OPEN' THEN N'DRAFT'
        ELSE N'DRAFT'
    END,
    b.SubmittedDate,
    b.SubmittedBy,
    b.ReturnedDate,
    b.ReturnedBy,
    b.ReturnReason,
    b.ApprovedDate,
    b.ApprovedBy,
    b.VerifiedDate,
    b.VerifiedBy,
    SYSUTCDATETIME(),
    SYSUTCDATETIME(),
    N'SYSTEM'
FROM (
    SELECT DISTINCT SalaryBillCodeId, InstituteCode
    FROM dbo.SalaryEmployeeDetails
    WHERE ISNULL(InstituteCode, N'') <> N''
) d
INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
LEFT JOIN dbo.Institutes i ON i.InstituteCode = d.InstituteCode
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.SalaryBillInstituteWorkflow w
    WHERE w.SalaryBillCodeId = d.SalaryBillCodeId
      AND w.InstituteCode = d.InstituteCode
);
GO

PRINT '29_SalaryBillInstituteWorkflow.sql completed.';
GO
