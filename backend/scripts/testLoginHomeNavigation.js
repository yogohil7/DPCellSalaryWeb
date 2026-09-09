/*
  ==================================================================
  LOGIN ALWAYS OPENS THE USER'S HOME / DASHBOARD
  ==================================================================

  THE DEFECT

    The URL hash outlives the session. After a logout, or a browser close and
    reopen, "#/salary-entry" was still in the address bar. App.jsx mounted the
    AppShell on login success, and the AppShell initialises its page from

        const fromHash = readHashPage();
        const preferred = fromHash && fromHash !== "home" ? fromHash : defaultHomePage(user);

    so the stale hash won and the user landed back on the page they had open
    before instead of the Dashboard.

  THE FIX

    App.jsx writes the user's own home hash BEFORE setUser(), so the AppShell
    mounts with the home hash already in place and never sees the old one. The
    target is defaultHomePage(user) — the project's canonical role-aware home —
    never a hard-coded "home", so an Account Officer lands on Salary Approval
    with no access-denied notice. The logout handler clears the hash too, so
    nothing is left behind for the next login to restore.

  HOW THIS SUITE RUNS

    The real ESM utils/accessControl.js and modules.js are evaluated in a vm
    sandbox with a fake window, so the shipped defaultHomePage, canAccessPage,
    readHashPage and writeHashPage genuinely execute — this is not a
    re-implementation. simulateLogin() below performs exactly the two steps
    App.jsx performs, in that order, and then exactly the initialisation the
    AppShell performs.

  Offline. No database, no server, no network.

  Usage: cd backend && npm run test:login-home-navigation
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const read = (...p) => fs.readFileSync(path.join(FRONT, ...p), "utf8");
const appSrc = read("App.jsx");
const shellSrc = read("components", "AppShell.jsx");
const accessSrc = read("utils", "accessControl.js");
const modulesSrc = read("modules.js");

/* Executable views: comments stripped, so an explanatory comment naming a
   thing cannot satisfy or fail an assertion about the code. */
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const appCode = strip(appSrc);
const shellCode = strip(shellSrc);

/* ---------- runner ---------- */
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

/* ---------- execute the real ESM modules ---------- */
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
  vm.runInContext(`${esm(modulesSrc)}\n${esm(accessSrc)}`, sandbox, {
    filename: "accessControl.js",
  });
  return { AC: sandbox, hashState };
}
const { AC, hashState } = loadAccessControl();

const ADMIN = { roleName: "Super Admin", permissions: [] };
const ACCOUNT_OFFICER = { roleName: "Account Officer", permissions: [] };
const AUDITOR = {
  roleName: "Auditor",
  permissions: ["SALARY_ENTRY_VIEW", "REPORT_SALARY_VIEW", "MASTER_EMPLOYEE_VIEW", "DASHBOARD_VIEW"],
};
/* "Viewer" is not a role the project defines. An unknown role falls through
   canAccessPage's permission branch, which is exactly what this asserts —
   the role list is not invented to make a test pass. */
const VIEWER = { roleName: "Viewer", permissions: ["DASHBOARD_VIEW", "REPORT_SALARY_VIEW"] };

const ROLES = [
  ["Super Admin", ADMIN, "home"],
  ["Account Officer", ACCOUNT_OFFICER, "salary-approval"],
  ["Auditor", AUDITOR, "home"],
  ["Viewer", VIEWER, "home"],
];

/* Pages that really exist in this project, used as stale hashes. */
const STALE_HASHES = [
  "salary-entry", "employee-report", "section-master",
  "final-salary-bill", "bank-copy", "cheque-register",
];

/**
 * The login sequence exactly as App.jsx performs it, followed by the AppShell's
 * own initialisation. Nothing here decides the answer — it calls the shipped
 * functions in the shipped order.
 */
function simulateLogin(user, oldHash) {
  hashState.value = oldHash;                        /* the stale page hash */
  AC.writeHashPage(AC.defaultHomePage(user));       /* App.jsx, before setUser */
  return appShellInitialPage(user);                 /* AppShell mounts */
}

/** The AppShell's initial-page expression, transcribed from its source. */
function appShellInitialPage(user) {
  const fromHash = AC.readHashPage();
  const preferred =
    fromHash && fromHash !== "home" ? fromHash : AC.defaultHomePage(user);
  return AC.canAccessPage(user, preferred) ? preferred : AC.defaultHomePage(user);
}

console.log("======================================================================");
console.log("  LOGIN ALWAYS OPENS THE USER'S HOME / DASHBOARD");
console.log("======================================================================");

/* ================================================================== */
section("1. A stale hash never survives login");

for (const stale of STALE_HASHES) {
  check(`old hash #/${stale} → the Dashboard for an Admin`,
    simulateLogin(ADMIN, `#/${stale}`), "home");
}
check("and the address bar itself no longer holds the old page",
  (() => { simulateLogin(ADMIN, "#/salary-entry"); return hashState.value; })(),
  "#/");
check("no stale hash is ever the page an Admin lands on",
  STALE_HASHES.filter((h) => simulateLogin(ADMIN, `#/${h}`) !== "home"), []);
check("a hash with a query string is discarded too",
  simulateLogin(ADMIN, "#/salary-entry?month=6&year=2026"), "home");
check("an empty hash still lands on home",
  simulateLogin(ADMIN, ""), "home");

/* ================================================================== */
section("2. Every role lands on its own canonical home");

for (const [name, user, expected] of ROLES) {
  check(`${name} → defaultHomePage() = ${expected}`,
    AC.defaultHomePage(user), expected);
  check(`${name} logs in to ${expected}, not the stale page`,
    simulateLogin(user, "#/salary-entry"), expected);
}
check("the Account Officer's landing page is one they may access",
  AC.canAccessPage(ACCOUNT_OFFICER, AC.defaultHomePage(ACCOUNT_OFFICER)), true);
check("so no role is redirected on arrival, which is what raised the notice",
  ROLES.filter(([, user]) =>
    !AC.canAccessPage(user, AC.defaultHomePage(user))), []);
check("every role reaches its own home from every stale hash",
  ROLES.flatMap(([name, user, expected]) =>
    STALE_HASHES
      .filter((h) => simulateLogin(user, `#/${h}`) !== expected)
      .map((h) => `${name}:${h}`)), []);

/* ================================================================== */
section("3. The fix is in the login-success flow, in the right order");

check("App.jsx writes the home hash on login success",
  /writeHashPage\(defaultHomePage\(data\.user\)\)/.test(appCode), true);
check("and does so BEFORE setUser mounts the AppShell",
  appCode.indexOf("writeHashPage(defaultHomePage(data.user))") <
    appCode.indexOf("setUser(data.user)"), true);
check("the home page is resolved by role, never hard-coded",
  /writeHashPage\(\s*["'](home|#\/)["']\s*\)\s*;[\s\S]{0,40}setUser\(data\.user\)/
    .test(appCode), false);
check("logout leaves no page hash behind",
  /clearAuthSession\(\);[\s\S]{0,120}writeHashPage\("home"\)/.test(appCode), true);
check("the app imports the shared helpers rather than touching the hash itself",
  /import \{ defaultHomePage, writeHashPage \} from ".\/utils\/accessControl"/
    .test(appCode), true);
check("App.jsx sets no raw window.location.hash of its own",
  /window\.location\.hash\s*=/.test(appCode), false);
check("no react-router was introduced",
  /react-router|useNavigate|<Link/.test(appCode + shellCode), false);

/* ================================================================== */
section("4. defaultHomePage() itself was not changed");

check("it still returns salary-approval for an Account Officer only",
  /isAccountOfficer\(user\)\) return "salary-approval"/.test(accessSrc), true);
check("and home for everyone else",
  AC.defaultHomePage({ roleName: "Anything Else", permissions: [] }), "home");
check("it takes no hash and no storage into account",
  /export function defaultHomePage[\s\S]{0,200}?\n\}/.exec(accessSrc)[0]
    .match(/hash|localStorage|sessionStorage/), null);

/* ================================================================== */
section("5. In-session navigation still works");

check("the AppShell still routes every move through safeNavigate",
  /const navigate = \(id, params = \{\}\) => safeNavigate\(id, params\)/
    .test(shellCode), true);
check("safeNavigate still performs the permission check",
  /safeNavigate = \([\s\S]{0,200}?if \(!canAccessPage\(user, target\)\)/
    .test(shellCode), true);
check("the hashchange listener is untouched",
  /window\.addEventListener\("hashchange", onHashChange\)/.test(shellCode), true);
check("the AppShell's own initial-page expression is unchanged",
  /fromHash && fromHash !== "home" \? fromHash : defaultHomePage\(user\)/
    .test(shellCode), true);

/* Home → Salary Entry → Employee Report, using the shipped helpers. */
const journey = [];
AC.writeHashPage("salary-entry");
journey.push([AC.readHashPage(), AC.canAccessPage(ADMIN, "salary-entry")]);
AC.writeHashPage("employee-report");
journey.push([AC.readHashPage(), AC.canAccessPage(ADMIN, "employee-report")]);
AC.writeHashPage("home");
journey.push([AC.readHashPage(), AC.canAccessPage(ADMIN, "home")]);
check("Home → Salary Entry → Employee Report → Home still navigates",
  journey, [["salary-entry", true], ["employee-report", true], ["home", true]]);
check("the breadcrumb Home still resolves through defaultHomePage",
  /writeHashPage\(defaultHomePage\(actor\)\)/.test(read("components", "Breadcrumb.jsx")),
  true);

/* ================================================================== */
section("6. Access control is unchanged");

check("an Auditor is still denied Salary Approval",
  AC.canAccessPage(AUDITOR, "salary-approval"), false);
check("and still cannot reach the user masters",
  [AC.canAccessPage(AUDITOR, "user-master"),
   AC.canAccessPage(AUDITOR, "role-permission-master")], [false, false]);
check("an Account Officer still sees no Salary group",
  AC.getNavMenus(ACCOUNT_OFFICER).showSalary, false);
check("an Account Officer still reaches Reports",
  AC.getNavMenus(ACCOUNT_OFFICER).showReports, true);
check("an Admin still reaches every page",
  ["home", "salary-entry", "employee-report", "final-salary-bill"]
    .every((p) => AC.canAccessPage(ADMIN, p)), true);
check("canAccessPage was not modified to let a stale page through",
  /export function canAccessPage[\s\S]{0,600}?hash/.test(accessSrc), false);

/* ================================================================== */
section("7. Nothing outside the login flow changed");

check("no salary, report or API file is referenced by the change",
  /salaryBasicCalc|api\/salary|routes\//.test(appCode), false);
check("the login request itself is untouched",
  /\/api\/auth\/login/.test(appCode), true);
check("the token is still stored by the existing session helper",
  /setAuthSession\(\{ token: data\.token, user: data\.user \}\)/.test(appCode), true);
check("no JWT or auth logic was added here",
  /jwt|decode|atob\(/i.test(appCode), false);

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
