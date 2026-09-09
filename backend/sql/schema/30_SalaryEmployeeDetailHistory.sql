/*
  30_SalaryEmployeeDetailHistory.sql
  Snapshot of SalaryEmployeeDetails at SUBMIT / RESUBMIT for Variation Report.
*/

IF OBJECT_ID(N'dbo.SalaryEmployeeDetailHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEmployeeDetailHistory (
        HistoryId            BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_SalaryEmployeeDetailHistory PRIMARY KEY,
        SalaryBillCodeId     INT NOT NULL,
        InstituteCode        NVARCHAR(50) NOT NULL,
        EmployeeId           INT NOT NULL,
        SnapshotType         NVARCHAR(20) NOT NULL,
        SnapshotDate         DATETIME2(0) NOT NULL
            CONSTRAINT DF_SEDH_SnapshotDate DEFAULT (SYSUTCDATETIME()),
        EmployeeName         NVARCHAR(200) NULL,
        Designation          NVARCHAR(200) NULL,
        EmployeeType         NVARCHAR(50) NULL,
        PensionType          NVARCHAR(10) NULL,
        BasicPay             DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_Basic DEFAULT (0),
        GradePay             DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_GP DEFAULT (0),
        TotalBasic           DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_TB DEFAULT (0),
        DA                   DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_DA DEFAULT (0),
        HRA                  DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_HRA DEFAULT (0),
        MA                   DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_MA DEFAULT (0),
        TA                   DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_TA DEFAULT (0),
        CLA                  DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_CLA DEFAULT (0),
        SpecialAllowance     DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_SA DEFAULT (0),
        WashingAllowance     DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_WA DEFAULT (0),
        GrossSalary          DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_Gross DEFAULT (0),
        GPFSubscription      DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_GPF DEFAULT (0),
        GPFAdvance           DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_GPFAdv DEFAULT (0),
        NPS                  DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_NPS DEFAULT (0),
        IncomeTax            DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_IT DEFAULT (0),
        ProfessionalTax      DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_PT DEFAULT (0),
        OtherDeduction       DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_OD DEFAULT (0),
        TotalDeduction       DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_TD DEFAULT (0),
        NetSalary            DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEDH_Net DEFAULT (0)
    );

    CREATE INDEX IX_SEDH_Bill_Inst_Date
        ON dbo.SalaryEmployeeDetailHistory (SalaryBillCodeId, InstituteCode, SnapshotDate DESC);
    CREATE INDEX IX_SEDH_Emp
        ON dbo.SalaryEmployeeDetailHistory (SalaryBillCodeId, InstituteCode, EmployeeId, SnapshotDate DESC);

    PRINT 'Created dbo.SalaryEmployeeDetailHistory';
END
GO

PRINT '30_SalaryEmployeeDetailHistory.sql completed.';
GO
