/**
 * One-shot: ensure admin user password hash (bcrypt) for the configured bootstrap password.
 * Usage: node scripts/ensureAdminUser.js
 */
/* Phase 9: no credential literal in tests. Supply the password via the
   environment; the suite reports BLOCKED when it is not configured. */
const TEST_ADMIN_PASSWORD = String(
  process.env.TEST_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || ""
).trim();

require("dotenv").config();
const { connectDB } = require("../db");
const { ensureAdminUser } = require("../utils/ensureAdminUser");

async function main() {
  await connectDB();
  const result = await ensureAdminUser();
  console.log("ensureAdminUser result:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
