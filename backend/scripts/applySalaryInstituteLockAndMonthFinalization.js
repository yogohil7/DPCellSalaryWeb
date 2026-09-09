require("dotenv").config();
const fs = require("fs"); const path = require("path");
const { connectDB, sql } = require("../db");
async function apply() {
  await connectDB();
  const text = fs.readFileSync(path.join(__dirname, "../sql/schema/31_SalaryInstituteLockAndMonthFinalization.sql"), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((x) => x.trim()).filter(Boolean)) await new sql.Request().batch(batch);
  console.log("Applied 31_SalaryInstituteLockAndMonthFinalization.sql");
}
if (require.main === module) apply().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
module.exports = { apply };
