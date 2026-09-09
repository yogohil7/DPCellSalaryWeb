/**
 * PHASE 8 — security & deployment configuration.
 * No secret or credential appears in this file.
 * Usage: cd backend && npm run test:phase8-security
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: { query: () => Promise.resolve({ recordset: [] }),
    Request: function R(){ return { query: () => Promise.resolve({recordset:[]}), input(){return this;} }; } },
  connectDB: async () => true,
};

const ROOT = path.join(__dirname, "..");
const FRONT = path.join(ROOT, "..", "frontend");
const authSrc   = fs.readFileSync(path.join(ROOT, "middleware", "auth.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const apiConfig = fs.readFileSync(path.join(FRONT, "src", "utils", "apiConfig.js"), "utf8");
const ewsRoute  = fs.readFileSync(path.join(ROOT, "routes", "employeeWiseSalary.js"), "utf8");
const ewsPage   = fs.readFileSync(path.join(FRONT, "src", "pages", "EmployeeWiseSalary.jsx"), "utf8");

let passed = 0, failed = 0; const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`); console.log(`        expected ${e}`); console.log(`        actual   ${a}`); }
}
const section = (t) => { console.log(`\n${t}`); console.log("-".repeat(t.length)); };

/** Walk the frontend source for a pattern. */
function frontendFilesContaining(needle, skip = []) {
  const hits = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(p); continue; }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      if (skip.some((s) => p.endsWith(s))) continue;
      if (fs.readFileSync(p, "utf8").includes(needle)) hits.push(path.relative(FRONT, p));
    }
  })(path.join(FRONT, "src"));
  return hits;
}

function main() {
  console.log("=".repeat(76));
  console.log("PHASE 8 — SECURITY & DEPLOYMENT CONFIGURATION");
  console.log("=".repeat(76));

  section("1-3. JWT secret comes from configuration only");
  check("1. no hard-coded fallback secret remains",
    /JWT_SECRET\s*\|\|\s*["'][^"']+["']/.test(authSrc), false);
  check("1. nor a ?? fallback", /JWT_SECRET\s*\?\?\s*["'][^"']+["']/.test(authSrc), false);
  check("2. a startup guard exists", /function requireJwtSecret/.test(authSrc), true);
  check("2. the guard throws when the secret is missing",
    /JWT_SECRET is not configured/.test(authSrc), true);
  check("2. and rejects an obviously weak secret",
    /MIN_SECRET_LENGTH/.test(authSrc), true);
  check("2. server startup calls the guard before serving",
    /requireJwtSecret\(\);/.test(serverSrc), true);
  check("3. the secret is never logged",
    /console\.[a-z]+\([^)]*JWT_SECRET/.test(authSrc + serverSrc), false);
  check("3. no random per-start secret (which would drop all sessions)",
    /randomBytes[^;]*JWT_SECRET|JWT_SECRET\s*=\s*.*randomBytes/.test(authSrc), false);
  check("JWT expiry behaviour is unchanged", /JWT_EXPIRES_IN/.test(authSrc), true);

  /* The guard is behaviour, not just text: exercise it both ways. */
  section("Guard behaviour (executed)");
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  delete require.cache[require.resolve(path.join(ROOT, "middleware", "auth.js"))];
  let threwWhenMissing = false;
  try { require(path.join(ROOT, "middleware", "auth.js")).requireJwtSecret(); }
  catch (e) { threwWhenMissing = /not configured/.test(e.message); }
  check("missing JWT_SECRET throws at startup", threwWhenMissing, true);

  process.env.JWT_SECRET = "x".repeat(8);
  delete require.cache[require.resolve(path.join(ROOT, "middleware", "auth.js"))];
  let threwWhenShort = false;
  try { require(path.join(ROOT, "middleware", "auth.js")).requireJwtSecret(); }
  catch (e) { threwWhenShort = /too short/.test(e.message); }
  check("a too-short JWT_SECRET is rejected", threwWhenShort, true);

  process.env.JWT_SECRET = "y".repeat(40);
  delete require.cache[require.resolve(path.join(ROOT, "middleware", "auth.js"))];
  const okAuth = require(path.join(ROOT, "middleware", "auth.js"));
  check("a configured secret is accepted", typeof okAuth.requireJwtSecret(), "string");
  if (saved === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved;

  section("4-6. authorization is unchanged");
  check("4. protected routes still require authentication",
    /Authentication required\./.test(authSrc), true);
  check("5. an invalid/expired token is rejected",
    /jwt\.verify/.test(authSrc), true);
  check("6. permission enforcement still returns 403",
    /do not have permission/i.test(authSrc), true);
  check("6. role permissions are still loaded from the database",
    /FROM dbo\.RolePermissions/.test(authSrc), true);

  section("7-8. CORS is an environment-driven allowlist");
  check("7. CORS reads CORS_ORIGIN", /process\.env\.CORS_ORIGIN/.test(serverSrc), true);
  check("7. localhost development still works by default",
    /CORS_ORIGIN \|\| "http:\/\/localhost:5173"/.test(serverSrc), true);
  check("8. an unconfigured origin is refused",
    /is not allowed by CORS/.test(serverSrc), true);
  check("8. no wildcard origin", /origin:\s*["']\*["']/.test(serverSrc), false);
  check("8. no blanket origin reflection",
    /callback\(null,\s*true\)\s*;?\s*\}\s*\)/.test(serverSrc.replace(/if \(!origin\)[^\n]*\n/, "")), false);

  section("9-10. frontend API base is configuration");
  check("9. apiConfig reads VITE_API_BASE_URL",
    /import\.meta\.env[\s\S]{0,40}VITE_API_BASE_URL/.test(apiConfig), true);
  check("9. a trailing slash cannot produce a double slash",
    /replace\(\/\\\/\+\$\/, ""\)/.test(apiConfig), true);
  /* Strip block and line comments first: the header documents a
     .env.production example, which is prose, not a runtime URL. */
  const apiConfigCode = apiConfig
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check("9. no production URL is hard-coded in runtime code",
    /https?:\/\/(?!localhost)/.test(apiConfigCode), false);
  check("10. no runtime source hard-codes the API host",
    frontendFilesContaining("http://localhost:5000", ["utils/apiConfig.js"]), []);
  check("10. nor the dev server origin",
    frontendFilesContaining("http://localhost:5173"), []);

  section("11-15. Employee Wise Salary — real DA data only");
  check("11. all four categories are offered",
    ["ALL","REGULAR","OLD","DA_DIFFERENCE"].every((v) => ewsPage.includes(`value="${v}"`)), true);
  check("12-14. the filter narrows by category",
    /salaryType === "DA_DIFFERENCE" && row\.type !== "DA DIFFERENCE"/.test(ewsRoute), true);
  check("14. DA rows come from the shared DA loader",
    /loadDaDifferenceRows/.test(ewsRoute), true);
  check("15. absent DA columns are null, never a fabricated zero",
    /basic: null,[\s\S]{0,200}hra: null,/.test(ewsRoute), true);
  check("15. only the three stored DA amounts are populated",
    /total: round2\(row\.differenceAmount\)[\s\S]{0,200}nps: round2\(row\.nps\)/.test(ewsRoute), true);
  check("15. the screen shows an em dash for a non-existent field",
    /if \(value == null\) return "\\u2014";/.test(ewsPage), true);
  check("15. no DA financial value is invented",
    /basic:\s*round2\(|hra:\s*round2\(|da:\s*[0-9]/.test(
      ewsRoute.slice(ewsRoute.indexOf("function daRowToSalaryRow"),
                     ewsRoute.indexOf("function daRowToSalaryRow") + 2000)), false);

  section("No secret material in source or tests");
  check("this test file contains no secret",
    /JWT_SECRET\s*=\s*["'](?!replace|x|y)[A-Za-z0-9+/=]{16,}/.test(
      fs.readFileSync(__filename, "utf8")), false);
  check(".env.example ships a placeholder only",
    /replace-with-a-long-random-secret/.test(
      fs.readFileSync(path.join(ROOT, ".env.example"), "utf8")), true);

  console.log("\n" + "=".repeat(76));
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) { console.log("\nFailures:"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(failed ? 1 : 0);
}
main();
