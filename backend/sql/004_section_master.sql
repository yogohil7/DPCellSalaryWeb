/*
  Section Master + Institute Master SectionId relationship
  Safe for existing DBs: SectionId starts nullable on Institutes.
*/

IF OBJECT_ID(N'dbo.Sections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sections (
        SectionId     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SrNo          INT            NOT NULL,
        SectionName   NVARCHAR(200)  NOT NULL,
        Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_Sections_Status DEFAULT (N'ACTIVE'),
        CreatedDate   DATETIME       NOT NULL CONSTRAINT DF_Sections_CreatedDate DEFAULT (GETDATE()),
        CreatedBy     NVARCHAR(100)  NULL,
        ModifiedDate  DATETIME       NULL,
        ModifiedBy    NVARCHAR(100)  NULL,
        CONSTRAINT UQ_Sections_SrNo UNIQUE (SrNo),
        CONSTRAINT UQ_Sections_SectionName UNIQUE (SectionName),
        CONSTRAINT CK_Sections_Status CHECK (Status IN (N'ACTIVE', N'INACTIVE'))
    );

    CREATE INDEX IX_Sections_Status ON dbo.Sections (Status);
    CREATE INDEX IX_Sections_SrNo ON dbo.Sections (SrNo);
    CREATE INDEX IX_Sections_SectionName ON dbo.Sections (SectionName);
END
GO

IF OBJECT_ID(N'dbo.Institutes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Institutes (
        InstituteId         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SectionId           INT            NULL,
        InstituteCode       NVARCHAR(50)   NOT NULL,
        InstituteName       NVARCHAR(250)  NOT NULL,
        InstituteDistrict   NVARCHAR(100)  NULL,
        CityClass           NVARCHAR(10)   NULL,
        InstituteAddress    NVARCHAR(500)  NULL,
        BankAccountNumber   NVARCHAR(50)   NULL,
        Status              NVARCHAR(20)   NOT NULL CONSTRAINT DF_Institutes_Status DEFAULT (N'Active'),
        CreatedDate         DATETIME       NOT NULL CONSTRAINT DF_Institutes_CreatedDate DEFAULT (GETDATE()),
        CreatedBy           NVARCHAR(100)  NULL,
        ModifiedDate        DATETIME       NULL,
        ModifiedBy          NVARCHAR(100)  NULL,
        CONSTRAINT UQ_Institutes_InstituteCode UNIQUE (InstituteCode),
        CONSTRAINT CK_Institutes_Status CHECK (Status IN (N'Active', N'Inactive'))
    );

    CREATE INDEX IX_Institutes_SectionId ON dbo.Institutes (SectionId);
    CREATE INDEX IX_Institutes_Status ON dbo.Institutes (Status);
END
GO

IF OBJECT_ID(N'dbo.Institutes', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Institutes', N'SectionId') IS NULL
BEGIN
    ALTER TABLE dbo.Institutes ADD SectionId INT NULL;
END
GO

IF OBJECT_ID(N'dbo.Institutes', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes
       WHERE name = N'IX_Institutes_SectionId'
         AND object_id = OBJECT_ID(N'dbo.Institutes')
   )
BEGIN
    CREATE INDEX IX_Institutes_SectionId ON dbo.Institutes (SectionId);
END
GO

IF OBJECT_ID(N'dbo.Institutes', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.Sections', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.foreign_keys
       WHERE name = N'FK_Institutes_Sections'
   )
BEGIN
    ALTER TABLE dbo.Institutes
    ADD CONSTRAINT FK_Institutes_Sections
        FOREIGN KEY (SectionId) REFERENCES dbo.Sections (SectionId);
END
GO

PRINT 'Section Master / Institutes migration completed.';
GO
