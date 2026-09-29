/*
  ACCOUNT OFFICER -> GET /api/dashboard/summary  (API-level regression)

  Runs the REAL authenticate / requirePermissionPrefix middleware and the REAL
  routes/dashboard.js router, mounted with the EXACT app.use(...) statement
  read out of server.js, over a real HTTP listener (express). Only the SQL
  layer is stubbed (same require.cache pattern as testDashboardSummary.js), so
  no SQL Server is needed. Tokens are signed with a throw-away test secret.

  Offline. Usage: cd backend && npm run test:account-officer-dashboard-api
*/
const fs = require("fs");
const path = require("path");
const http = require("http");
const Module = require("module");

process.env.JWT_SECRET = "test-only-secret-not-used-anywhere-else";

/* ---- users the stub "database" knows about ---- */
const USERS = {
  1: { RoleId: 1, RoleName: "Super Admin", perms: [] },
  2: { RoleId: 2, RoleName: "Account Officer", perms: [] },
  3: { RoleId: 3, RoleName: "Auditor", perms: ["DASHBOARD_VIEW", "REPORT_SALARY_VIEW"] },
  4: { RoleId: 3, RoleName: "Auditor", perms: [] },
  5: { RoleId: 9, RoleName: "Viewer", perms: ["REPORT_SALARY_VIEW"] },
  6: { RoleId: 9, RoleName: "Viewer", perms: ["DASHBOARD_VIEW"] },
  7: { RoleId: 2, RoleName: "ACCOUNT OFFICER", perms: [] },
  8: { RoleId: 2, RoleName: "account officer", perms: ["REPORT_SALARY_VIEW"] },
};

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: (strings, ...values) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (/FROM\s+dbo\.Users/i.test(text)) {
        const u = USERS[values[0]];
        return Promise.resolve({
          recordset: u ? [{ UserId: values[0], UserName: `u${values[0]}`, FullName: `User ${values[0]}`, RoleId: u.RoleId, IsActive: true, RoleName: u.RoleName }] : [],
        });
      }
      if (/FROM\s+dbo\.RolePermissions/i.test(text)) {
        /* permissions are per test user, keyed by the userId stashed below */
        return Promise.resolve({ recordset: (currentPerms || []).map((c) => ({ PermissionCode: c })) });
      }
      return Promise.resolve({ recordset: [] }); /* dashboard aggregates: empty DB */
    },
    Request: function R() { return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } }; },
  },
  connectDB: async () => true,
};
let currentPerms = [];

const auth = require("../middleware/auth");
const express = require("express");

const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
function mountStatement(prefix) {
  const m = new RegExp(`app\\.use\\("${prefix}",[^\\n]*\\);`).exec(serverSrc);
  if (!m) throw new Error(`mount for ${prefix} not found in server.js`);
  return m[0];
}

const app = express();
app.use(express.json());
const authed = [auth.authenticate];
const { normalizeRole, requirePermissionPrefix } = auth;
/* Evaluate the real mount lines from server.js against the real middleware. */
new Function("app", "authed", "normalizeRole", "requirePermissionPrefix", "require",
  `${mountStatement("/api/dashboard")}\n${mountStatement("/api/sections")}`)(
  app, authed, normalizeRole, requirePermissionPrefix,
  (p) => (p.startsWith("./") ? require(path.join(__dirname, "..", p)) : require(p)));

/* Route the permissions stub by which user is authenticating. */
const origAuthenticate = auth.authenticate;
void origAuthenticate;

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`); }
}
const section = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

function request(server, urlPath, token) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(body); } catch { json = undefined; }
        resolve({ status: res.statusCode, json, contentType: res.headers["content-type"] || "" });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
const tokenFor = (id) => {
  currentPerms = USERS[id].perms;
  return auth.signAccessToken({ userId: id, userName: `u${id}`, roleId: USERS[id].RoleId, roleName: USERS[id].RoleName });
};
const call = (server, urlPath, id) => {
  const t = id ? tokenFor(id) : undefined;
  return request(server, urlPath, t);
};

const METRICS = ["salaryBills", "employees", "pendingApproval", "salaryEntry", "verification", "approvalDetails", "returnedBills", "variationReport", "finalSalaryBill"];

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  console.log("ACCOUNT OFFICER DASHBOARD API");

  section("A-D. Account Officer (no DASHBOARD_* permission in the role)");
  const ao = await call(server, "/api/dashboard/summary", 2);
  check("A. authenticated request succeeds (HTTP 200)", ao.status, 200);
  check("B. response is valid JSON", ao.json !== undefined && /json/.test(ao.contentType), true);
  check("C. existing structure: { message: 'OK', data: { salaryMonth, metrics } }",
    [ao.json && ao.json.message, !!(ao.json && ao.json.data && "salaryMonth" in ao.json.data), !!(ao.json && ao.json.data && ao.json.data.metrics)], ["OK", true, true]);
  check("D. all nine existing summary metrics are returned",
    METRICS.filter((k) => ao.json && ao.json.data && ao.json.data.metrics && k in ao.json.data.metrics), METRICS);
  check("role-name spellings are normalised by the project's own function (ACCOUNT OFFICER)",
    (await call(server, "/api/dashboard/summary", 7)).status, 200);
  check("role-name spelling (account officer, other perms)",
    (await call(server, "/api/dashboard/summary", 8)).status, 200);

  section("E. Unauthenticated stays protected");
  check("no token -> 401", (await call(server, "/api/dashboard/summary")).status, 401);
  check("garbage token -> 401", (await request(server, "/api/dashboard/summary", "not.a.jwt")).status, 401);

  section("F-H. Other roles unchanged");
  check("Admin -> 200", (await call(server, "/api/dashboard/summary", 1)).status, 200);
  check("Auditor with DASHBOARD_VIEW -> 200", (await call(server, "/api/dashboard/summary", 3)).status, 200);
  check("Auditor without DASHBOARD_* -> 403", (await call(server, "/api/dashboard/summary", 4)).status, 403);
  check("other role without DASHBOARD_* -> 403", (await call(server, "/api/dashboard/summary", 5)).status, 403);
  check("other role with DASHBOARD_VIEW -> 200", (await call(server, "/api/dashboard/summary", 6)).status, 200);

  section("Account Officer is NOT widened elsewhere");
  check("Masters API (sections) still denied to Account Officer -> 403", (await call(server, "/api/sections", 2)).status, 403);
  check("Masters API (sections) allowed to Admin (not 401/403)", [401, 403].includes((await call(server, "/api/sections", 1)).status), false);
  check("Account Officer bypass is limited to the dashboard mount",
    (serverSrc.match(/ACCOUNT_OFFICER/g) || []).length >= 1 && !/app\.use\("\/api\/sections"[^\n]*ACCOUNT_OFFICER/.test(serverSrc), true);

  server.close();
  console.log(`\nTOTAL ${passed + failed}  PASSED ${passed}  FAILED ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
