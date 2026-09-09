/**
 * Offline test for the User Master duplicate-username rule.
 *
 * Stubs dbo.Users with exactly what SSMS reports — a single row, "admin" —
 * and emulates the SQL comparison the route uses, so cases A-E can be
 * verified without SQL Server.
 *
 * Usage:  cd backend && npm run test:usernames
 */

const path = require("path");
const Module = require("module");

/* =========================================================
   FIXTURE — matches the live database exactly
   UserId | UserName | FullName             | RoleId | IsActive
        2 | admin    | System Administrator |      1 |        1
   ========================================================= */

const USERS = [
  { UserId: 2, UserName: "admin", FullName: "System Administrator", RoleId: 1, IsActive: 1 },
];

/* =========================================================
   DB STUB
   Emulates: LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@UserName)))
             AND (@UserId IS NULL OR UserId <> @UserId)
   ========================================================= */

function makeRequest() {
  const params = {};
  return {
    input(name, _type, value) {
      params[name] = value;
      return this;
    },
    async query(text) {
      if (!/FROM dbo\.Users/i.test(text)) return { recordset: [] };

      const target = String(params.UserName ?? "").trim().toLowerCase();
      const exclude = params.UserId;

      const rows = USERS.filter((u) => {
        const stored = String(u.UserName ?? "").trim().toLowerCase();
        if (stored !== target) return false;
        /* NULL exclusion must be a no-op, never a match. */
        if (exclude === null || exclude === undefined) return true;
        return Number(u.UserId) !== Number(exclude);
      }).map((u) => ({ UserId: u.UserId }));

      return { recordset: rows };
    },
  };
}

const sqlStub = {
  Request: makeRequest,
  NVarChar: (len) => ({ type: "nvarchar", len }),
  Int: { type: "int" },
  query: async () => ({ recordset: [] }),
};

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = { sql: sqlStub, connectDB: async () => true };

const { isUserNameTaken } = require("../routes/users");

/* =========================================================
   RUNNER
   ========================================================= */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function main() {
  console.log("=".repeat(66));
  console.log("User Master duplicate-username tests");
  console.log('Database fixture: one user, "admin" (UserId 2)');
  console.log("=".repeat(66));

  section("A. New username 'ao' must be allowed");
  check("'ao' is not taken", (await isUserNameTaken("ao", null)).taken, false);
  check(
    "'ao' is not taken when userId is undefined",
    (await isUserNameTaken("ao", undefined)).taken,
    false
  );
  check(
    "'ao' is not taken when userId is an empty string",
    (await isUserNameTaken("ao", "")).taken,
    false
  );
  check(
    "'ao' is not taken when userId is NaN",
    (await isUserNameTaken("ao", Number("abc"))).taken,
    false
  );
  check(
    "'ao' is not taken when userId is 0",
    (await isUserNameTaken("ao", 0)).taken,
    false
  );

  section("B. Existing username 'admin' must be rejected");
  const admin = await isUserNameTaken("admin", null);
  check("'admin' is taken", admin.taken, true);
  check("and reports the owning UserId", admin.userId, 2);

  section("C. Case-insensitive duplicate");
  check("'ADMIN' is taken", (await isUserNameTaken("ADMIN", null)).taken, true);
  check("'Admin' is taken", (await isUserNameTaken("Admin", null)).taken, true);
  check("'aDmIn' is taken", (await isUserNameTaken("aDmIn", null)).taken, true);

  section("D. Surrounding spaces are trimmed consistently");
  check("' ao ' is not taken", (await isUserNameTaken(" ao ", null)).taken, false);
  check("' admin ' is taken", (await isUserNameTaken(" admin ", null)).taken, true);
  check("'  ADMIN  ' is taken", (await isUserNameTaken("  ADMIN  ", null)).taken, true);
  check("a whitespace-only name is not taken", (await isUserNameTaken("   ", null)).taken, false);
  check("an empty name is not taken", (await isUserNameTaken("", null)).taken, false);
  check("null is not taken", (await isUserNameTaken(null, null)).taken, false);

  section("E. Editing a user must not flag itself");
  check(
    "admin keeping its own username (UserId 2)",
    (await isUserNameTaken("admin", 2)).taken,
    false
  );
  check(
    "admin keeping it with different casing",
    (await isUserNameTaken("ADMIN", 2)).taken,
    false
  );
  check(
    "admin keeping it with spaces",
    (await isUserNameTaken(" admin ", 2)).taken,
    false
  );
  check(
    "a DIFFERENT user (UserId 9) taking 'admin' is still blocked",
    (await isUserNameTaken("admin", 9)).taken,
    true
  );
  check(
    "editing admin to the free name 'ao' is allowed",
    (await isUserNameTaken("ao", 2)).taken,
    false
  );

  section("Regression: duplicate protection is still real");
  USERS.push({ UserId: 3, UserName: "ao", FullName: "Accounts Officer", RoleId: 2, IsActive: 1 });
  check("once 'ao' exists, a new 'ao' is blocked", (await isUserNameTaken("ao", null)).taken, true);
  check("and 'AO' is blocked too", (await isUserNameTaken("AO", null)).taken, true);
  check("but 'ao' editing itself is fine", (await isUserNameTaken("ao", 3)).taken, false);
  check("and an unrelated new name is free", (await isUserNameTaken("auditor", null)).taken, false);
  USERS.pop();

  console.log(`\n${"=".repeat(66)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(66));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
