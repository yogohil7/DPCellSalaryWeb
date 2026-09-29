/*
  ==================================================================
  "SALARY PROCESS" MENU REMOVAL
  ==================================================================

  "Salary Process" appeared in the top Salary dropdown (components/Header.jsx)
  and in the sidebar SALARY group (components/Sidebar.jsx). Both surfaces are
  driven by the SAME source: getNavMenus(user) -> filterNavItems(user, SALARY)
  where SALARY lives in frontend/src/modules.js. Removing the entry from that
  one list removes it from both surfaces.

  Inspection established it was a STALE registration: no SalaryProcess page
  component exists under frontend/src/pages, and AppShell.jsx has no
  renderAuthorized("salary-process", ...) branch, so the item navigated to a
  hash that rendered nothing.

  This suite EXECUTES the real modules.js + accessControl.js in a sandbox (they
  are ESM, which node cannot require), so getNavMenus / canAccessPage /
  defaultHomePage genuinely run — this is not a re-implementation.

  Offline. No database, no server, no network.

  Usage: cd backend && npm run test:salary-process-menu-removal
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const FRONT = path.join(ROOT, "frontend", "src");
const BACK = path.join(ROOT, "backend");

const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const modulesSrc = read(FRONT, "modules.js");
const accessSrc = read(FRONT, "utils", "accessControl.js");
const headerSrc = read(FRONT, "components", "Header.jsx");
const sidebarSrc = read(FRONT, "components", "Sidebar.jsx");
const shellSrc = read(FRONT, "components", "AppShell.jsx");

/* Executable views: comments stripped, so an explanatory comment that names
   "Salary Process" cannot fail an assertion about what is RENDERED. */
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const modulesCode = strip(modulesSrc);
const accessCode = strip(accessSrc);

/* ---- runner ---- */
let passed = 0, failed = 0;
const failures = [];
let sectionName = "", secPass = 0, secFail = 0;
const sectionReport = [];
function closeSection() {
  if (!sectionName) return;
  sectionReport.push({
    name: sectionName,
    verdict: secFail === 0 ? "PASS" : "FAIL",
    assertions: secPass + secFail,
  });
  console.log(`  → ${secFail === 0 ? "PASS" : "FAIL"}   assertions: ${secPass + secFail}`);
}
function section(t) {
  closeSection();
  sectionName = t; secPass = 0; secFail = 0;
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; secPass++; console.log(`  PASS  ${name}`); }
  else {
    failed++; secFail++;
    failures.push(`[${sectionName}] ${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}

/* ---- execute the real ESM modules ---- */
function loadAccessControl() {
  const esm = (src) =>
    src
      .replace(/^\s*import[^;]*;\s*$/gm, "")
      .replace(/^\s*export\s+default\s+/gm, "const __default = ")
      .replace(/^\s*export\s+/gm, "");
  const hashState = { value: "" };
  const sandbox = {
    window: {
      get location() {
        return {
          get hash() { return hashState.value; },
          set hash(v) { hashState.value = v; },
        };
      },
    },
    console,
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  /* `const` declarations inside runInContext are lexical and do not become
     properties of the sandbox object (function declarations do). The trailing
     assignment publishes the const-declared lists and maps so the assertions
     can read the REAL values, not a copy. */
  const publish = `
    globalThis.SALARY = SALARY;
    globalThis.MASTERS = MASTERS;
    globalThis.REPORTS = REPORTS;
    globalThis.DA_DIFFERENCE = DA_DIFFERENCE;
    globalThis.PAGE_PERMISSION_PREFIX = PAGE_PERMISSION_PREFIX;
  `;
  vm.runInContext(`${esm(modulesSrc)}\n${esm(accessSrc)}\n${publish}`, sandbox, {
    filename: "accessControl.js",
  });
  return sandbox;
}
const AC = loadAccessControl();

const ADMIN = { roleName: "Super Admin", permissions: [] };
const ACCOUNT_OFFICER = { roleName: "Account Officer", permissions: [] };
const AUDITOR_FULL = {
  roleName: "Auditor",
  permissions: [
    "SALARY_ENTRY_VIEW", "SALARY_RETURNING_VIEW", "SALARY_FINAL_BILL_VIEW",
    "SALARY_PROCESS_VIEW", "REPORT_SALARY_VIEW", "MASTER_EMPLOYEE_VIEW",
  ],
};

const labels = (items) => (items || []).map((i) => i.label);
const ids = (items) => (items || []).map((i) => i.id);

const EXPECTED_SALARY = [
  "Salary Entry", "Salary Approval", "Returning Bills", "Final Salary Bill",
];

console.log("======================================================================");
console.log('  "SALARY PROCESS" MENU REMOVAL');
console.log("======================================================================");

/* ------------------------------------------------------------------ */
section("1. The single source of the Salary menu no longer lists it");

check("modules.js SALARY has exactly the four required items",
  labels(AC.SALARY), EXPECTED_SALARY);
check("and no salary-process id remains in it",
  ids(AC.SALARY).includes("salary-process"), false);
check("the executable SALARY list mentions no Salary Process label",
  /\{\s*id:\s*"salary-process"/.test(modulesCode), false);
check("SALARY still has four entries — nothing else was dropped",
  AC.SALARY.length, 4);
check("the order is unchanged for the surviving items",
  ids(AC.SALARY),
  ["salary-entry", "salary-approval", "returning-bills", "final-salary-bill"]);

/* ------------------------------------------------------------------ */
section("2. Not rendered in the top Salary menu");

check("Header builds its menus from getNavMenus, not a private list",
  /getNavMenus\(user\)/.test(headerSrc), true);
check("Header hard-codes no Salary Process entry",
  /Salary Process|salary-process/i.test(strip(headerSrc)), false);
/* Per role. An Auditor is denied Salary Approval by design (canAccessPage
   returns false for it), so the Auditor's Salary menu legitimately shows
   three items — that pre-existing rule is unchanged by this removal. */
const EXPECTED_BY_ROLE = [
  ["Admin", ADMIN, EXPECTED_SALARY],
  ["Auditor", AUDITOR_FULL,
    ["Salary Entry", "Returning Bills", "Final Salary Bill"]],
];
for (const [name, user, expected] of EXPECTED_BY_ROLE) {
  const menus = AC.getNavMenus(user);
  check(`top Salary menu for ${name} omits Salary Process`,
    ids(menus.salary).includes("salary-process"), false);
  check(`top Salary menu for ${name} is exactly its permitted items`,
    labels(menus.salary), expected);
}

/* ------------------------------------------------------------------ */
section("3. Not rendered in the sidebar");

check("Sidebar builds its groups from getNavMenus, not a private list",
  /getNavMenus\(user\)/.test(sidebarSrc), true);
check("Sidebar hard-codes no Salary Process entry",
  /Salary Process|salary-process/i.test(strip(sidebarSrc)), false);
check("the sidebar SALARY group renders menus.salary verbatim",
  /title="SALARY"[\s\S]{0,120}items=\{menus\.salary\}/.test(sidebarSrc), true);
check("sidebar SALARY group for Admin omits Salary Process",
  ids(AC.getNavMenus(ADMIN).salary).includes("salary-process"), false);
check("a group renders only its items — no placeholder, so no empty gap",
  /items\.map\(\(item\)/.test(sidebarSrc) &&
    /if \(!items \|\| items\.length === 0\) return null;/.test(sidebarSrc), true);

/* ------------------------------------------------------------------ */
section("4. The four required salary pages remain available");

const SURVIVORS = [
  ["salary-entry", "Salary Entry"],
  ["salary-approval", "Salary Approval"],
  ["returning-bills", "Returning Bills"],
  ["final-salary-bill", "Final Salary Bill"],
];
for (const [id, label] of SURVIVORS) {
  check(`${label} is still registered in SALARY`,
    ids(AC.SALARY).includes(id), true);
  check(`${label} still renders in AppShell`,
    new RegExp(`renderAuthorized\\(\\s*"${id}"`).test(shellSrc), true);
  check(`${label} still has a permission mapping`,
    typeof AC.PAGE_PERMISSION_PREFIX[id] === "string" &&
      AC.PAGE_PERMISSION_PREFIX[id].length > 0, true);
}
check("Admin still sees all four in the Salary menu",
  labels(AC.getNavMenus(ADMIN).salary), EXPECTED_SALARY);

/* ------------------------------------------------------------------ */
section("5. It was a stale registration — no page ever existed");

const pageFiles = fs.readdirSync(path.join(FRONT, "pages"));
check("no SalaryProcess page component exists",
  pageFiles.some((f) => /^SalaryProcess\.jsx$/i.test(f)), false);
check("AppShell has no renderAuthorized branch for it",
  /renderAuthorized\(\s*"salary-process"/.test(shellSrc), false);
check("AppShell imports no SalaryProcess component",
  /SalaryProcess/.test(shellSrc), false);
check("so the removed entry rendered nothing — no functionality was lost",
  pageFiles.some((f) => /^SalaryProcess\.jsx$/i.test(f)) ||
    /renderAuthorized\(\s*"salary-process"/.test(shellSrc), false);

/* ------------------------------------------------------------------ */
section("6. Role-based visibility is unchanged");

/* 2026-09-24: the module is now removed completely (user request), including
   its page-permission mapping. */
check("the salary-process page-permission mapping is removed",
  Object.prototype.hasOwnProperty.call(AC.PAGE_PERMISSION_PREFIX, "salary-process"), false);
check("salary-process is not a known page", AC.isKnownPage("salary-process"), false);
check("Admin cannot open #/salary-process (redirects home)",
  AC.canAccessPage(ADMIN, "salary-process"), false);
check("Auditor cannot open #/salary-process (redirects home)",
  AC.canAccessPage(AUDITOR_FULL, "salary-process"), false);
check("unknown hashes are never pages", AC.canAccessPage(ADMIN, "no-such-page"), false);
check("every registered page is still a known page",
  Object.keys(AC.PAGE_PERMISSION_PREFIX).every((id) => AC.isKnownPage(id)), true);
check("Account Officer still sees no Salary group",
  AC.getNavMenus(ACCOUNT_OFFICER).showSalary, false);
check("Account Officer still reaches Salary Approval directly",
  AC.getNavMenus(ACCOUNT_OFFICER).salaryApprovalDirect, true);
check("Account Officer still sees Reports",
  AC.getNavMenus(ACCOUNT_OFFICER).showReports, true);
check("Auditor is still denied Salary Approval",
  AC.canAccessPage(AUDITOR_FULL, "salary-approval"), false);
check("Auditor still reaches Salary Entry",
  AC.canAccessPage(AUDITOR_FULL, "salary-entry"), true);
check("Admin still reaches every surviving salary page",
  SURVIVORS.every(([id]) => AC.canAccessPage(ADMIN, id)), true);
check("Masters menu is untouched for Admin",
  AC.getNavMenus(ADMIN).masters.length > 0, true);
check("Reports menu is untouched for Admin",
  AC.getNavMenus(ADMIN).reports.length > 0, true);
check("DA Difference menu is untouched for Admin",
  ids(AC.getNavMenus(ADMIN).daDifference),
  ["da-difference-master", "da-difference-entry"]);

/* ------------------------------------------------------------------ */
section("7. defaultHomePage behaviour is unchanged");

check("Admin home is still the dashboard", AC.defaultHomePage(ADMIN), "home");
check("Auditor home is still the dashboard", AC.defaultHomePage(AUDITOR_FULL), "home");
check("Account Officer home is now the dashboard",
  AC.defaultHomePage(ACCOUNT_OFFICER), "home");
check("defaultHomePage never returns the removed id",
  [ADMIN, AUDITOR_FULL, ACCOUNT_OFFICER]
    .map((u) => AC.defaultHomePage(u))
    .includes("salary-process"), false);

/* ------------------------------------------------------------------ */
section("8. Page fully removed; no backend, API, schema or salary logic changed");

const dashSrc = read(FRONT, "components", "Dashboard.jsx");
const schemaSrc = read(BACK, "sql", "schema", "35_RoleBasedAccess.sql");
check("placeholder page (GenericModule) removed",
  pageFiles.some((f) => /^GenericModule\.jsx$/.test(f)), false);
check("AppShell no longer renders a placeholder fallback",
  /GenericModule/.test(shellSrc), false);
check("AppShell redirects unknown pages quietly (isKnownPage)",
  /isKnownPage\(target\)/.test(shellSrc), true);
check("Dashboard cards no longer link to salary-process",
  /salary-process/.test(dashSrc), false);
check("Dashboard Verification tile opens Salary Approval",
  /id: "salary-approval", label: "Verification"/.test(dashSrc), true);
check("Dashboard Salary Bills card opens Salary Entry",
  /id: "salary-entry",\s*title: "Salary Bills"/.test(dashSrc), true);
check("no frontend source names salary-process",
  ["modules.js", "utils/accessControl.js", "components/AppShell.jsx", "components/Dashboard.jsx",
   "components/Header.jsx", "components/Sidebar.jsx"].some((f) => /salary-process|SalaryProcess/.test(read(FRONT, f))), false);
check("no database/schema change: SQL schema file untouched (SALARY_PROCESS seed row still present)",
  /N'SALARY_PROCESS'/.test(schemaSrc), true);
check("the salary permission codes themselves are untouched",
  ["salary-entry", "salary-approval", "returning-bills", "final-salary-bill"]
    .map((id) => AC.PAGE_PERMISSION_PREFIX[id]),
  ["SALARY_ENTRY", "SALARY_APPROVAL", "SALARY_RETURNING", "SALARY_FINAL_BILL"]);
check("no salary calculation module is referenced by the nav source",
  /calculate|npsDeduction|grossSalary/i.test(modulesCode), false);

closeSection();

console.log("\n======================================================================");
console.log("SECTION SUMMARY");
console.log("======================================================================");
for (const s of sectionReport) {
  console.log(`  ${s.verdict.padEnd(6)} ${String(s.assertions).padStart(2)} assertions   ${s.name}`);
}
console.log("\n======================================================================");
console.log(`  TOTAL ASSERTIONS : ${passed + failed}`);
console.log(`  PASSED           : ${passed}`);
console.log(`  FAILED           : ${failed}`);
console.log("======================================================================");
if (failures.length) {
  console.log("\nFAILURES");
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed === 0 ? 0 : 1);
