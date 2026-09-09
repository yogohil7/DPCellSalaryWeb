const fs = require("fs");
const path = require("path");
const { connectDB, sql } = require("../db");

async function applyBatches(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    if (/^PRINT\s+/i.test(batch) && batch.split("\n").length === 1) {
      console.log(
        batch.replace(/^PRINT\s+'?/i, "").replace(/';?\s*;?\s*$/, "")
      );
      continue;
    }
    await new sql.Request().batch(batch);
  }
}

async function main() {
  await connectDB();
  const file = path.join(
    __dirname,
    "../sql/schema/25_UsersRolesPermissions.sql"
  );
  await applyBatches(file);
  console.log("Applied 25_UsersRolesPermissions.sql");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
