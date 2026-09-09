/*
  41_SyncInstituteDistrictAndCityClass.sql

  Backfill Institutes.DistrictId / CityClassId from text columns and
  ensure Gujarat districts used by the app exist in dbo.Districts.
*/

SET NOCOUNT ON;
GO

USE DPCELLSalaryWebDB;
GO

/* Ensure commonly used Gujarat districts exist (by name). */
DECLARE @MaxSr INT = (SELECT ISNULL(MAX(SrNo), 0) FROM dbo.Districts);

;WITH Needed AS (
    SELECT ROW_NUMBER() OVER (ORDER BY v.DistrictName) AS Rn, v.DistrictName
    FROM (VALUES
      (N'Ahmedabad'), (N'Amreli'), (N'Anand'), (N'Aravalli'),
      (N'Banaskantha'), (N'Bharuch'), (N'Bhavnagar'), (N'Botad'),
      (N'Chhota Udepur'), (N'Dahod'), (N'Dang'), (N'Devbhumi Dwarka'),
      (N'Gandhinagar'), (N'Gir Somnath'), (N'Jamnagar'), (N'Junagadh'),
      (N'Kheda'), (N'Kutch'), (N'Mahisagar'), (N'Mehsana'),
      (N'Morbi'), (N'Narmada'), (N'Navsari'), (N'Panchmahal'),
      (N'Patan'), (N'Porbandar'), (N'Rajkot'), (N'Sabarkantha'),
      (N'Surat'), (N'Surendranagar'), (N'Tapi'), (N'Vadodara'),
      (N'Valsad'), (N'Vav-Tharad')
    ) v(DistrictName)
)
INSERT INTO dbo.Districts (SrNo, DistrictName, Status, CreatedBy, CreatedDate, IsActive)
SELECT @MaxSr + n.Rn, n.DistrictName, N'Active', N'SYSTEM', GETDATE(), 1
FROM Needed n
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.Districts d
    WHERE UPPER(LTRIM(RTRIM(d.DistrictName))) = UPPER(LTRIM(RTRIM(n.DistrictName)))
);

PRINT 'District master names ensured.';
GO

/* Backfill DistrictId from InstituteDistrict / District text. */
UPDATE i
SET
  DistrictId = d.DistrictId,
  District = COALESCE(NULLIF(LTRIM(RTRIM(i.District)), N''), d.DistrictName),
  InstituteDistrict = COALESCE(
    NULLIF(LTRIM(RTRIM(i.InstituteDistrict)), N''),
    d.DistrictName
  )
FROM dbo.Institutes i
INNER JOIN dbo.Districts d
  ON UPPER(LTRIM(RTRIM(d.DistrictName))) = UPPER(LTRIM(RTRIM(
       COALESCE(NULLIF(i.InstituteDistrict, N''), NULLIF(i.District, N''))
     )));

PRINT 'Institutes.DistrictId backfilled from district name text.';
GO

/* Backfill CityClassId from CityClass text. */
UPDATE i
SET CityClassId = c.CityClassId
FROM dbo.Institutes i
INNER JOIN dbo.CityClasses c
  ON UPPER(LTRIM(RTRIM(c.CityClassName))) = UPPER(LTRIM(RTRIM(i.CityClass)))
WHERE i.CityClassId IS NULL
  AND NULLIF(LTRIM(RTRIM(i.CityClass)), N'') IS NOT NULL;

PRINT 'Institutes.CityClassId backfilled from CityClass text.';
GO
