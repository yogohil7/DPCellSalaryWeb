/*
  Salary Employee Details — monthly employee salary rows linked to SalaryBillCodes.
  DisplayOrder preserves user-arranged employee order across months.
*/

IF OBJECT_ID(N'dbo.SalaryEmployeeDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalaryEmployeeDetails (
        Id                  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SalaryBillCodeId    INT            NOT NULL,
        EmployeeId          INT            NOT NULL,
        EmployeeName        NVARCHAR(200)  NOT NULL,
        Designation         NVARCHAR(200)  NULL,
        EmployeeType        NVARCHAR(50)   NULL,
        DisplayOrder        INT            NOT NULL CONSTRAINT DF_SalaryEmployeeDetails_DisplayOrder DEFAULT (1),

        BasicPay            DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_BasicPay DEFAULT (0),
        GradePay            DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_GradePay DEFAULT (0),
        TotalBasic          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_TotalBasic DEFAULT (0),
        DA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_DA DEFAULT (0),
        HRA                 DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_HRA DEFAULT (0),
        MA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_MA DEFAULT (0),
        TA                  DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_TA DEFAULT (0),
        SpecialAllowance    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_SpecialAllowance DEFAULT (0),
        WashingAllowance    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_WashingAllowance DEFAULT (0),
        GrossSalary         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_GrossSalary DEFAULT (0),

        GPFSubscription     DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_GPFSubscription DEFAULT (0),
        GPFAdvance          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_GPFAdvance DEFAULT (0),
        NPS                 DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_NPS DEFAULT (0),
        IncomeTax           DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_IncomeTax DEFAULT (0),
        ProfessionalTax     DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_ProfessionalTax DEFAULT (0),
        OtherDeduction      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_OtherDeduction DEFAULT (0),
        TotalDeduction      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_TotalDeduction DEFAULT (0),
        NetSalary           DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SED_NetSalary DEFAULT (0),

        InstituteCode       NVARCHAR(50)   NULL,
        CreatedDate         DATETIME2(0)   NOT NULL CONSTRAINT DF_SED_CreatedDate DEFAULT (SYSUTCDATETIME()),
        UpdatedDate         DATETIME2(0)   NULL,

        CONSTRAINT FK_SalaryEmployeeDetails_BillCode
            FOREIGN KEY (SalaryBillCodeId) REFERENCES dbo.SalaryBillCodes (BillCodeId),
        CONSTRAINT UQ_SalaryEmployeeDetails_Bill_Employee
            UNIQUE (SalaryBillCodeId, EmployeeId)
    );

    CREATE INDEX IX_SalaryEmployeeDetails_Bill_Order
        ON dbo.SalaryEmployeeDetails (SalaryBillCodeId, DisplayOrder);
END
GO

PRINT 'SalaryEmployeeDetails migration completed.';
GO
