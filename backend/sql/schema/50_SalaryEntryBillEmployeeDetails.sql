/*
  50_SalaryEntryBillEmployeeDetails.sql

  Per-Bill-Month employee salary data, for the multiple-independent-bills
  business rule (2026-09-24 follow-up to migrations 48/49):

  For one Salary Month (e.g. AUG-2026), Salary Entry can now hold several
  fully independent bill instances, one per Bill Month <= Salary Month:
    - Bill Month AUG-2026 (the canonical, "August salary paid in August"
      instance) - unchanged, keeps using dbo.SalaryEmployeeDetails /
      dbo.SalaryEmployeeComponentDetails exactly as before. Every existing
      consumer (Bank Copy, DA Difference, Cheque Register, Salary Register,
      NPS/GPF reports, Dashboard, Employee Pay Slip, ...) keeps reading
      those two tables unchanged and is therefore unaffected by this
      migration.
    - Bill Month JUL-2026, JUN-2026, ... (earlier-than-Salary-Month
      instances) - NEW: stored here, in
      dbo.SalaryEntryBillEmployeeDetails / dbo.SalaryEntryBillEmployeeComponentDetails,
      keyed additionally by BillMonth so two instances of the same
      SalaryBillCodeId + InstituteCode never collide or overwrite
      each other.

  Column shape mirrors dbo.SalaryEmployeeDetails / dbo.SalaryEmployeeComponentDetails
  (as of migrations 003, 11, 24, 26, 27, 33, 42, 46) exactly, so the existing
  save/read/mapping code can be reused for either table with only the
  target table name and the extra BillMonth key changing.

  Additive, idempotent: safe to run against a database that already has
  these tables (does nothing) or does not yet have them (creates them).
  Does not touch dbo.SalaryEmployeeDetails, dbo.SalaryEmployeeComponentDetails,
  or any other existing table/column/index/constraint.
*/
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryEntryBillEmployeeDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEntryBillEmployeeDetails (
        Id                  INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_SalaryEntryBillEmployeeDetails PRIMARY KEY,
        SalaryBillCodeId    INT            NOT NULL,
        InstituteCode       NVARCHAR(50)   NOT NULL,
        BillMonth           NVARCHAR(10)   NOT NULL,
        EmployeeId          INT            NOT NULL,
        EmployeeName        NVARCHAR(200)  NOT NULL,
        Designation         NVARCHAR(200)  NULL,
        EmployeeType        NVARCHAR(50)   NULL,
        DisplayOrder        INT            NOT NULL CONSTRAINT DF_SEBED_DisplayOrder DEFAULT (1),

        BasicPay            DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_BasicPay DEFAULT (0),
        GradePay            DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_GradePay DEFAULT (0),
        TotalBasic          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_TotalBasic DEFAULT (0),
        DA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_DA DEFAULT (0),
        HRA                 DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_HRA DEFAULT (0),
        MA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_MA DEFAULT (0),
        TA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_TA DEFAULT (0),
        CLA                 DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_CLA DEFAULT (0),
        SpecialAllowance    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_SpecialAllowance DEFAULT (0),
        WashingAllowance    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_WashingAllowance DEFAULT (0),
        OtherEarnings       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_OtherEarnings DEFAULT (0),
        NPPA                DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_NPPA DEFAULT (0),
        GrossSalary         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_GrossSalary DEFAULT (0),

        GPFSubscription     DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_GPFSubscription DEFAULT (0),
        GPFAdvance          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_GPFAdvance DEFAULT (0),
        NPS                 DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_NPS DEFAULT (0),
        NPSAdvance          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_NPSAdvance DEFAULT (0),
        IncomeTax           DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_IncomeTax DEFAULT (0),
        ProfessionalTax     DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_ProfessionalTax DEFAULT (0),
        OtherDeduction      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_OtherDeduction DEFAULT (0),
        TotalDeduction      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_TotalDeduction DEFAULT (0),
        NetSalary           DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_NetSalary DEFAULT (0),
        ChequeAmount        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SEBED_ChequeAmount DEFAULT (0),

        PensionType         NVARCHAR(10)   NULL,
        PayRevisionId       INT            NULL,
        PayLevel            NVARCHAR(50)   NULL,
        PayMatrixCellNo     INT            NULL,
        PayMatrixId         INT            NULL,
        DAMasterId          INT            NULL,
        HRAMasterId         INT            NULL,
        CLAMasterId         INT            NULL,
        PayrollConfigId     INT            NULL,
        CityClass           NVARCHAR(50)   NULL,
        AsOfDate            DATE           NULL,
        HraForcedZero       BIT            NOT NULL CONSTRAINT DF_SEBED_HraForcedZero DEFAULT (0),
        DAPercentage        DECIMAL(9,4)   NULL,
        HRAPercentage       DECIMAL(9,4)   NULL,
        DARate              DECIMAL(9,4)   NULL,
        HRARate             DECIMAL(9,4)   NULL,
        IncrementId         INT            NULL,
        NPSManual           BIT            NOT NULL CONSTRAINT DF_SEBED_NPSManual DEFAULT (0),
        TAManual            BIT            NOT NULL CONSTRAINT DF_SEBED_TAManual DEFAULT (0),

        CreatedDate         DATETIME2(0)   NOT NULL CONSTRAINT DF_SEBED_CreatedDate DEFAULT (SYSUTCDATETIME()),
        UpdatedDate         DATETIME2(0)   NULL,

        CONSTRAINT FK_SalaryEntryBillEmployeeDetails_BillCode
            FOREIGN KEY (SalaryBillCodeId) REFERENCES dbo.SalaryBillCodes (BillCodeId),
        CONSTRAINT UQ_SEBED_Bill_Institute_Month_Employee
            UNIQUE (SalaryBillCodeId, InstituteCode, BillMonth, EmployeeId)
    );

    CREATE INDEX IX_SEBED_Bill_Institute_Month
        ON dbo.SalaryEntryBillEmployeeDetails (SalaryBillCodeId, InstituteCode, BillMonth);

    PRINT 'Created dbo.SalaryEntryBillEmployeeDetails';
END
ELSE
    PRINT 'dbo.SalaryEntryBillEmployeeDetails already exists';
GO

IF OBJECT_ID(N'dbo.SalaryEntryBillEmployeeComponentDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEntryBillEmployeeComponentDetails (
        Id                                  INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_SalaryEntryBillEmployeeComponentDetails PRIMARY KEY,
        SalaryEntryBillEmployeeDetailId     INT           NOT NULL,
        SalaryComponentId                   INT           NOT NULL,
        Amount                              DECIMAL(18,2) NOT NULL CONSTRAINT DF_SEBECD_Amount DEFAULT (0),
        CalculationBase                     DECIMAL(18,2) NULL,
        Rate                                DECIMAL(10,4) NULL,
        Remarks                             NVARCHAR(500) NULL,
        CreatedDate                         DATETIME2(0)  NOT NULL CONSTRAINT DF_SEBECD_CreatedDate DEFAULT (SYSUTCDATETIME()),
        UpdatedDate                         DATETIME2(0)  NULL,
        CONSTRAINT FK_SEBECD_Detail
            FOREIGN KEY (SalaryEntryBillEmployeeDetailId)
            REFERENCES dbo.SalaryEntryBillEmployeeDetails (Id),
        CONSTRAINT UQ_SEBECD_Detail_Component
            UNIQUE (SalaryEntryBillEmployeeDetailId, SalaryComponentId)
    );

    PRINT 'Created dbo.SalaryEntryBillEmployeeComponentDetails';
END
ELSE
    PRINT 'dbo.SalaryEntryBillEmployeeComponentDetails already exists';
GO

PRINT '50_SalaryEntryBillEmployeeDetails.sql complete.';
GO
