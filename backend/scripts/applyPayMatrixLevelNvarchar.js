/**
 * Apply 23_PayMatrixLevel_NVARCHAR.sql
 * Usage: npm run migrate:pay-matrix-level
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function runBatch(batch, label) {
  const text = batch.trim();
  if (!text) return;
  console.log(`\n--- ${label} ---`);
  const request = new sql.Request();
  request.multiple = true;
  await request.query(text);
  console.log(`OK: ${label}`);
}

async function main() {
  await connectDB();
  const filePath = path.join(
    __dirname,
    "..",
    "sql",
    "schema",
    "23_PayMatrixLevel_NVARCHAR.sql"
  );
  const raw = fs.readFileSync(filePath, "utf8");
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean)
    .filter((b) => !/^USE\s+/i.test(b));

  for (let i = 0; i < batches.length; i += 1) {
    await runBatch(batches[i], `23_PayMatrixLevel_NVARCHAR.sql #${i + 1}`);
  }

  const col = await sql.query`
    SELECT t.name AS type_name, c.max_length
    FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.PayMatrixMaster') AND c.name = N'Level'
  `;
  console.log("\nPayMatrixMaster.Level now:", col.recordset[0]);
  const cnt = await sql.query`SELECT COUNT(1) AS Cnt FROM dbo.PayMatrixMaster`;
  console.log("Preserved PayMatrixMaster rows:", cnt.recordset[0].Cnt);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
