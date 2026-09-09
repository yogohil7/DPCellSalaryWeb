/**
 * Seed missing City Class Z TA rows (mirror Y / other-places rates).
 * Usage: node scripts/seedTransportAllowanceCityClassZ.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function main() {
  await connectDB();
  const text = fs.readFileSync(
    path.join(__dirname, "../sql/schema/40_SeedTransportAllowanceCityClassZ.sql"),
    "utf8"
  );
  for (const batch of text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean)) {
    await new sql.Request().batch(batch);
  }

  const check = await sql.query`
    SELECT PayLevelGroup, CityClass, TAAmount
    FROM dbo.TransportAllowanceMaster
    WHERE UPPER(LTRIM(RTRIM(CityClass))) = N'Z'
    ORDER BY PayLevelGroup
  `;
  console.log("City Class Z TA rows:", check.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
