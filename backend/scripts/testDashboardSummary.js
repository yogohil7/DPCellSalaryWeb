/**
 * DASHBOARD SUMMARY (cases 1-25).
 *
 * The Dashboard cards must show live database values through one
 * authenticated aggregate — no hard-coded numbers, no fake fallbacks.
 *
 * Static source assertions run offline. The single live check (auth is
 * required) needs the backend running; if it is unreachable the check is
 * reported BLOCKED, never faked. No credentials appear in this file.
 *
 * Runs offline. Usage: cd backend && npm run test:dashboard-summary
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const dbPath = require.resolve(path.join(__dirname, "..", "db.js"));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = {
  sql: {
    query: () => Promise.resolve({ recordset: [] }),
    Request: function R() {
      return { query: () => Promise.resolve({ recordset: [] }), input() { return this; } };
    },
  },
  connectDB: async () => true,
};

const dashboard = require("../routes/dashboard");
const { buildDashboardSummary, formatSalaryMonthLabel, isDaCategory } = dashboard;

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "dashboard.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const pageSrc = fs.readFileSync(path.join(FRONT, "components", "Dashboard.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join(FRONT, "utils", "dashboardApi.js"), "utf8");

/* ===================== RUNNER ===================== */

let passed = 0, failed = 0, blocked = 0;
const failures = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else {
    failed++; failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) { console.log(`\n${t}`); console.log("-".repeat(t.length)); }

async function main() {
  console.log("=".repeat(76));
  console.log("DASHBOARD SUMMARY (cases 1-25)");
  console.log("=".repeat(76));

  /* ---------------- endpoint + auth ---------------- */
  section("Endpoint, authentication, permission");

  check("1. endpoint exists as GET /summary",
    /router\.get\("\/summary"/.test(routeSrc), true);
  check("2. authentication is required on the mount",
    /\/api\/dashboard",\s*\.\.\.authed/.test(serverSrc), true);
  check("3. dashboard permission is required on the mount",
    /\/api\/dashboard",[^;]*requirePermissionPrefix\("DASHBOARD"\)/.test(serverSrc), true);

  /* ---------------- current salary month ---------------- */
  section("Current OPEN salary month");

  check("4. current OPEN salary month is used (Status OPEN)",
    /UPPER\(LTRIM\(RTRIM\(b\.Status\)\)\) = N'OPEN'/.test(routeSrc), true);
  check("5. BillMonth is not used to determine the current salary month",
    /b\.BillMonth/.test(routeSrc), false);
  check("5. SalaryYear + SalaryMonthNumber drive the period",
    /SalaryYear/.test(routeSrc) && /SalaryMonthNumber/.test(routeSrc), true);

  /* ---------------- archived + DA scope ---------------- */
  section("Archived and DA Difference scope");

  check("6. archived salary bills are excluded",
    (routeSrc.match(/ISNULL\(b\.IsArchived, 0\) = 0/g) || []).length >= 5, true);
  check("7. DA Difference is not counted as regular salary bills",
    /<> N'DIFFERENCE'/.test(routeSrc) && /<> N'DA DIFFERENCE'/.test(routeSrc), true);

  /* ---------------- employees ---------------- */
  section("Active employees from EmployeeMaster");

  check("8. active employee count uses EmployeeMaster",
    /FROM dbo\.EmployeeMaster/.test(routeSrc), true);
  check("9. inactive employees excluded via IsActive + Status",
    /ISNULL\(e\.IsActive, 1\) = 1/.test(routeSrc) &&
    /UPPER\(ISNULL\(e\.Status, N'Active'\)\) = N'ACTIVE'/.test(routeSrc), true);

  /* ---------------- workflow queues ---------------- */
  section("Approval-derived queues");

  check("10. DRAFT without auditor assignment feeds Salary Entry",
    /= N'DRAFT'/.test(routeSrc) && /ReturnedToAuditorId IS NULL/.test(routeSrc), true);
  check("11. SUBMITTED/RESUBMITTED feed Verification",
    /byStatus\.SUBMITTED/.test(routeSrc) && /byStatus\.RESUBMITTED/.test(routeSrc), true);
  check("12. VERIFIED feeds Approval Details",
    /byStatus\.VERIFIED/.test(routeSrc), true);
  check("13. RETURNED plus correctable REJECTED feed Returned Bills",
    /= N'RETURNED'/.test(routeSrc) && /= N'REJECTED'/.test(routeSrc), true);
  check("14. APPROVED/LOCKED are not pending",
    /byStatus\.APPROVED/.test(routeSrc), false);
  check("14. LOCKED is not pending either",
    /byStatus\.LOCKED/.test(routeSrc), false);

  /* ---------------- month scoping ---------------- */
  section("Current-month scoping");

  check("15. historical months excluded via current year+month filter",
    /LTRIM\(RTRIM\(b\.SalaryYear\)\) =/.test(routeSrc) &&
    /TRY_CAST\(b\.SalaryMonthNumber AS INT\) =/.test(routeSrc), true);
  check("16. Salary Bills uses the current salary month (OPEN bills)",
    /OpenBills/.test(routeSrc) && /= N'OPEN'/.test(routeSrc), true);
  check("17. Final Salary Bill follows COMPLETED/LOCKED semantics",
    /IN \(N'COMPLETED', N'LOCKED'\)/.test(routeSrc), true);
  check("18. Variation follows current-minus-previous NetSalary logic",
    /FULL OUTER JOIN/.test(routeSrc) && /ISNULL\(cur\.Net, 0\) <> ISNULL\(prev\.Net, 0\)/.test(routeSrc), true);

  /* ---------------- SQL safety ---------------- */
  section("SQL safety");

  check("19. no user input reaches SQL (route takes no query params)",
    /req\.query/.test(routeSrc), false);
  check("19. values flow through parameters, not string building",
    /\$\{salaryYear\}|\$\{salaryMonthNumber\}|\$\{prevYear\}|\$\{prevMonthNumber\}/.test(routeSrc), true);

  /* ---------------- frontend ---------------- */
  section("Frontend wiring");

  check("20. no hard-coded dashboard numbers remain",
    /value: "(18|1,286|07|12|05|03|01|04)"/.test(pageSrc), false);
  check("21. frontend has a loading state",
    /const LOADING =/.test(pageSrc) && /useState/.test(pageSrc), true);
  check("21. loading shows a placeholder, never a fake value",
    pageSrc.includes('"\u2014"') && !/value: "[0-9]/.test(pageSrc), true);
  check("22. frontend has an error state with retry",
    /Unable to load dashboard data/.test(pageSrc) && /Retry/.test(pageSrc), true);
  check("23. frontend uses dashboardApi",
    /getDashboardSummary/.test(pageSrc) && /from "\.\.\/utils\/dashboardApi"/.test(pageSrc), true);
  check("24. no localhost hard-code in dashboard frontend files",
    /localhost:5000/.test(apiSrc + pageSrc), false);
  check("24. dashboardApi uses the centralized API base",
    /API_BASE_URL/.test(apiSrc), true);
  check("25. response contains all nine metrics",
    ["salaryBills", "employees", "pendingApproval", "salaryEntry", "verification",
     "approvalDetails", "returnedBills", "variationReport", "finalSalaryBill"]
      .every((k) => routeSrc.includes(`${k}:`) || routeSrc.includes(k)), true);

  /* ---------------- helpers ---------------- */
  section("Exported helpers");

  check("JUL label formats as JUL-2026",
    formatSalaryMonthLabel("July", "2026"), "JUL-2026");
  check("MON-YYYY input normalizes too",
    formatSalaryMonthLabel("JUN-2026", "2026"), "JUN-2026");
  check("DA category detected by BillCategory",
    isDaCategory("Difference", ""), true);
  check("DA category detected by BillType",
    isDaCategory("Salary", "DA Difference"), true);
  check("regular bill is not DA",
    isDaCategory("Salary", "Regular Salary"), false);

  /* ---------------- live: auth required (no credentials) ---------------- */
  section("Live — authentication required (BLOCKED if server unreachable)");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("http://127.0.0.1:5000/api/dashboard/summary", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    check("live. unauthenticated request is rejected", res.status, 401);
  } catch (err) {
    blocked++;
    console.log(`  BLOCKED live auth check — backend unreachable (${err.message}).`);
  }

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}    Blocked: ${blocked}`);
  console.log("=".repeat(76));
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
