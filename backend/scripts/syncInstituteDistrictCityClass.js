/**
 * Sync institute DistrictId/CityClassId and seed missing districts.
 * Usage: node scripts/syncInstituteDistrictCityClass.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const text = fs.readFileSync(
    path.join(__dirname, "../sql/schema/41_SyncInstituteDistrictAndCityClass.sql"),
    "utf8"
  );
  for (const batch of text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean)) {
    await new sql.Request().batch(batch);
  }

  const sample = await sql.query`
    SELECT InstituteCode, DistrictId, InstituteDistrict, District, CityClassId, CityClass
    FROM dbo.Institutes
    WHERE InstituteCode IN (N'OGE-05', N'CPD-25', N'CPD-17')
  `;
  console.log(sample.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
