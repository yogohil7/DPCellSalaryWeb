/*
  47_NpsSchedule.sql

  Saved NPS remittance schedules — a HISTORICAL SNAPSHOT.

  WHY A NEW TABLE:
    Nothing existing can hold this. SalaryBillInstituteWorkflow.NPSScheduleNo
    (migration 45) stores one schedule NUMBER per bill per institute, which
    this report reads, but there is nowhere to persist a generated schedule
    (its rows, its amounts, who saved it and when). A saved schedule must
    keep showing the same figures after salary data or Employee Master
    changes, so the values are copied in at save time rather than joined
    at read time.

  SCOPE:
    - Two new tables only. No existing table is altered, dropped or rewritten.
    - No salary, GPF or NPS value is computed here; amounts are copied from
      the stored dbo.SalaryEmployeeDetails.NPS figures the report displays.

  SAFE / ADDITIVE ONLY / IDEMPOTENT:
    - Each object is created only when missing (OBJECT_ID / index guards).
    - Re-running the migration changes nothing.
*/

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SalaryBillCodes', N'U') IS NULL
BEGIN
    RAISERROR(N'dbo.SalaryBillCodes is missing. Apply the earlier migrations first.', 16, 1);
    RETURN;
END;
GO

/* ---------------------------------------------------------------------
   HEADER — one row per saved schedule.
   Scope is (SalaryMonth, BillType, Section, Institute); RevisionNo lets a
   month legitimately carry more than one schedule instead of silently
   creating duplicates.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.NpsScheduleHeader', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NpsScheduleHeader
    (
        ScheduleId        INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_NpsScheduleHeader PRIMARY KEY,
        ScheduleNo        NVARCHAR(50)   NOT NULL,
        SalaryMonthKey    NVARCHAR(10)   NOT NULL,   -- sortable YYYY-MM
        SalaryMonthLabel  NVARCHAR(20)   NOT NULL,   -- display, e.g. JUL-2026
        SalaryYear        INT            NOT NULL,
        SalaryMonthNumber INT            NOT NULL,
        BillType          NVARCHAR(10)   NOT NULL,   -- REGULAR | OLD
        ScheduleDate      DATE           NOT NULL,
        SectionId         INT            NULL,       -- NULL = all sections
        SectionName       NVARCHAR(150)  NULL,
        InstituteCode     NVARCHAR(50)   NULL,       -- NULL = all institutes
        InstituteName     NVARCHAR(250)  NULL,
        EmployeeCount     INT            NOT NULL CONSTRAINT DF_NpsScheduleHeader_EmployeeCount DEFAULT (0),
        TotalNPS          DECIMAL(18, 2) NOT NULL CONSTRAINT DF_NpsScheduleHeader_TotalNPS DEFAULT (0),
        RevisionNo        INT            NOT NULL CONSTRAINT DF_NpsScheduleHeader_RevisionNo DEFAULT (1),
        Status            NVARCHAR(20)   NOT NULL CONSTRAINT DF_NpsScheduleHeader_Status DEFAULT (N'SAVED'),
        CreatedBy         NVARCHAR(100)  NULL,
        CreatedAt         DATETIME2(0)   NOT NULL CONSTRAINT DF_NpsScheduleHeader_CreatedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT CK_NpsScheduleHeader_BillType
            CHECK (BillType IN (N'REGULAR', N'OLD')),
        CONSTRAINT CK_NpsScheduleHeader_Status
            CHECK (Status IN (N'SAVED', N'CANCELLED'))
    );
    PRINT 'Created dbo.NpsScheduleHeader';
END
ELSE
    PRINT 'dbo.NpsScheduleHeader already exists - skipped.';
GO

/* ---------------------------------------------------------------------
   DETAIL — the schedule's institute rows, exactly as printed, plus the
   employee-level snapshot rows behind each institute line.
   RowKind separates the two so one table serves both without a join.
   --------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.NpsScheduleDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NpsScheduleDetails
    (
        ScheduleDetailId      INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_NpsScheduleDetails PRIMARY KEY,
        ScheduleId            INT            NOT NULL,
        RowKind               NVARCHAR(10)   NOT NULL,  -- INSTITUTE | EMPLOYEE
        SrNo                  INT            NOT NULL,

        /* Institute-line snapshot (the printed schedule). */
        InstituteCode         NVARCHAR(50)   NULL,
        InstituteNameSnapshot NVARCHAR(250)  NULL,
        SectionId             INT            NULL,
        SectionNameSnapshot   NVARCHAR(150)  NULL,
        NpsScheduleNoSnapshot NVARCHAR(50)   NULL,      -- from workflow (migration 45)
        EmployeeCount         INT            NOT NULL CONSTRAINT DF_NpsScheduleDetails_EmployeeCount DEFAULT (0),

        /* Employee-line snapshot (kept for audit / drill-down). */
        EmployeeId            INT            NULL,
        EmployeeCodeSnapshot  NVARCHAR(50)   NULL,
        EmployeeNameSnapshot  NVARCHAR(200)  NULL,
        PranSnapshot          NVARCHAR(50)   NULL,      -- EmployeeMaster.GPFNPSNumber

        NpsAmount             DECIMAL(18, 2) NOT NULL CONSTRAINT DF_NpsScheduleDetails_NpsAmount DEFAULT (0),

        /* Traceability back to the source bill. */
        SourceSalaryBillId    INT            NULL,
        SourceSalaryBillCode  NVARCHAR(50)   NULL,
        BillMonthLabel        NVARCHAR(20)   NULL,
        SalaryMonthLabel      NVARCHAR(20)   NULL,
        BillType              NVARCHAR(10)   NULL,

        CreatedAt             DATETIME2(0)   NOT NULL CONSTRAINT DF_NpsScheduleDetails_CreatedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT FK_NpsScheduleDetails_Header
            FOREIGN KEY (ScheduleId) REFERENCES dbo.NpsScheduleHeader (ScheduleId)
            ON DELETE CASCADE,
        CONSTRAINT CK_NpsScheduleDetails_RowKind
            CHECK (RowKind IN (N'INSTITUTE', N'EMPLOYEE'))
    );
    PRINT 'Created dbo.NpsScheduleDetails';
END
ELSE
    PRINT 'dbo.NpsScheduleDetails already exists - skipped.';
GO

/* ------------------------------ INDEXES ------------------------------ */
IF OBJECT_ID(N'dbo.NpsScheduleHeader', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_NpsScheduleHeader_MonthType'
                     AND object_id = OBJECT_ID(N'dbo.NpsScheduleHeader'))
BEGIN
    CREATE INDEX IX_NpsScheduleHeader_MonthType
      ON dbo.NpsScheduleHeader (SalaryMonthKey, BillType, SectionId, InstituteCode);
    PRINT 'Created IX_NpsScheduleHeader_MonthType';
END
GO

IF OBJECT_ID(N'dbo.NpsScheduleHeader', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'UX_NpsScheduleHeader_ScheduleNo'
                     AND object_id = OBJECT_ID(N'dbo.NpsScheduleHeader'))
BEGIN
    CREATE UNIQUE INDEX UX_NpsScheduleHeader_ScheduleNo
      ON dbo.NpsScheduleHeader (ScheduleNo);
    PRINT 'Created UX_NpsScheduleHeader_ScheduleNo';
END
GO

IF OBJECT_ID(N'dbo.NpsScheduleDetails', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_NpsScheduleDetails_Schedule'
                     AND object_id = OBJECT_ID(N'dbo.NpsScheduleDetails'))
BEGIN
    CREATE INDEX IX_NpsScheduleDetails_Schedule
      ON dbo.NpsScheduleDetails (ScheduleId, RowKind, SrNo);
    PRINT 'Created IX_NpsScheduleDetails_Schedule';
END
GO

IF OBJECT_ID(N'dbo.NpsScheduleDetails', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_NpsScheduleDetails_Employee'
                     AND object_id = OBJECT_ID(N'dbo.NpsScheduleDetails'))
BEGIN
    CREATE INDEX IX_NpsScheduleDetails_Employee
      ON dbo.NpsScheduleDetails (EmployeeId, SourceSalaryBillId);
    PRINT 'Created IX_NpsScheduleDetails_Employee';
END
GO

PRINT 'Migration 47 (NPS Schedule storage) complete.';
GO
