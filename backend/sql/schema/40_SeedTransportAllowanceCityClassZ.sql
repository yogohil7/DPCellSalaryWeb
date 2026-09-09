/*
  40_SeedTransportAllowanceCityClassZ.sql

  TransportAllowanceMaster previously had City Class X and Y only.
  City Class Z (other places) must exist with the same rates as Y.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

DECLARE @CityClassZId INT =
(
    SELECT TOP 1 CityClassId
    FROM dbo.CityClasses
    WHERE UPPER(LTRIM(RTRIM(CityClassName))) = N'Z'
);

;WITH YRates AS (
    SELECT PayLevelGroup, TAAmount, EffectiveDate, EmployeeClass, PayRevisionId, Status
    FROM dbo.TransportAllowanceMaster
    WHERE UPPER(LTRIM(RTRIM(CityClass))) = N'Y'
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
)
INSERT INTO dbo.TransportAllowanceMaster
  (
    EffectiveDate, PayLevelGroup, CityClass, CityClassId, TAAmount,
    EmployeeClass, PayRevisionId, Description, Status, CreatedBy
  )
SELECT
  y.EffectiveDate,
  y.PayLevelGroup,
  N'Z',
  @CityClassZId,
  y.TAAmount,
  y.EmployeeClass,
  y.PayRevisionId,
  N'Seeded from City Class Y (other places)',
  N'Active',
  N'SYSTEM'
FROM YRates y
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.TransportAllowanceMaster z
    WHERE z.PayLevelGroup = y.PayLevelGroup
      AND UPPER(LTRIM(RTRIM(z.CityClass))) = N'Z'
      AND z.EffectiveDate = y.EffectiveDate
      AND ISNULL(z.PayRevisionId, 0) = ISNULL(y.PayRevisionId, 0)
);

PRINT 'City Class Z Transport Allowance rows ensured.';
GO

/* Backfill CityClassId on any TA rows that only store CityClass text. */
UPDATE t
SET CityClassId = c.CityClassId
FROM dbo.TransportAllowanceMaster t
INNER JOIN dbo.CityClasses c
  ON UPPER(LTRIM(RTRIM(c.CityClassName))) = UPPER(LTRIM(RTRIM(t.CityClass)))
WHERE t.CityClassId IS NULL
  AND NULLIF(LTRIM(RTRIM(t.CityClass)), N'') IS NOT NULL;

PRINT 'TransportAllowanceMaster.CityClassId backfilled.';
GO
