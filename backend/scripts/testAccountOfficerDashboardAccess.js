/*
  ACCOUNT OFFICER CAN OPEN THE DASHBOARD
  Executes the real ESM utils/accessControl.js + modules.js in a vm sandbox
  (same technique as testLoginHomeNavigation.js). Offline: no DB / network.
  Usage: cd backend && npm run test:account-officer-dashboard
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const BACK = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`); }
}
const section = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

const esm = (src) => src.replace(/^\s*import[^;]*;\s*$/gm, "").replace(/^\s*export\s+default\s+/gm, "const __default = ").replace(/^\s*export\s+/gm, "");
const hashState = { value: "" };
const sandbox = {
  window: { get location() { return { get hash() { return hashState.value; }, set hash(v) { hashState.value = v; } }; } },
  console, module: { exports: {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${esm(read(FRONT, "modules.js"))}\n${esm(read(FRONT, "utils", "accessControl.js"))}`, sandbox, { filename: "accessControl.js" });
const AC = sandbox;

const AO = { roleName: "Account Officer", permissions: [] };
const ADMIN = { roleName: "Super Admin", permissions: [] };
const AUDITOR = { roleName: "Auditor", permissions: ["SALARY_ENTRY_VIEW", "REPORT_SALARY_VIEW", "DASHBOARD_VIEW"] };
const VIEWER = { roleName: "Viewer", permissions: ["DASHBOARD_VIEW", "REPORT_SALARY_VIEW"] };
const VIEWER_NO_DASH = { roleName: "Viewer", permissions: ["REPORT_SALARY_VIEW"] };

console.log("ACCOUNT OFFICER DASHBOARD ACCESS");

section("1. Account Officer: Dashboard / Home");
check("Account Officer role is recognised", AC.normalizeRole(AO.roleName), "ACCOUNT_OFFICER");
check("canAccessPage(home) is true", AC.canAccessPage(AO, "home"), true);
check("nav menus show Home", AC.getNavMenus(AO).showHome, true);
check("landing page is the Dashboard", AC.defaultHomePage(AO), "home");
hashState.value = "";
AC.writeHashPage("home");
check("navigating to the Dashboard writes the canonical hash", hashState.value, "#/");
check("and that hash reads back as the Dashboard page", AC.readHashPage(), "home");
check("the Dashboard page id is a registered page", AC.isKnownPage("home"), true);

section("2. Account Officer keeps everything else");
check("Salary Approval still allowed", AC.canAccessPage(AO, "salary-approval"), true);
check("Salary Approval still a direct nav item", AC.getNavMenus(AO).salaryApprovalDirect, true);
check("Reports still shown", AC.getNavMenus(AO).showReports, true);
check("every report page still allowed", vm.runInContext("REPORTS", sandbox).every((r) => AC.canAccessPage(AO, r.id)), true);
check("still no Masters / Salary / DA Difference groups",
  [AC.getNavMenus(AO).showMasters, AC.getNavMenus(AO).showSalary, AC.getNavMenus(AO).showDaDifference], [false, false, false]);
check("still denied Salary Entry, Employee Master, User Master",
  ["salary-entry", "employee-master", "user-master"].map((p) => AC.canAccessPage(AO, p)), [false, false, false]);
check("Change Password still allowed", AC.canAccessPage(AO, "change-password"), true);

section("3. Unauthenticated user cannot open the Dashboard");
check("no user -> home denied", AC.canAccessPage(null, "home"), false);
check("undefined user -> home denied", AC.canAccessPage(undefined, "home"), false);
const appCode = strip(read(FRONT, "App.jsx"));
check("App.jsx still renders the login form when there is no user", /if \(user\) \{[\s\S]*<AppShell/.test(appCode), true);

section("4. Other roles are unchanged");
check("Admin: home + everything", ["home", "salary-approval", "user-master"].map((p) => AC.canAccessPage(ADMIN, p)), [true, true, true]);
check("Auditor: home allowed, salary-approval still denied",
  [AC.canAccessPage(AUDITOR, "home"), AC.canAccessPage(AUDITOR, "salary-approval")], [true, false]);
check("Viewer with DASHBOARD_VIEW: home allowed", AC.canAccessPage(VIEWER, "home"), true);
check("Viewer without DASHBOARD permission: home still denied", AC.canAccessPage(VIEWER_NO_DASH, "home"), false);
check("defaultHomePage unchanged for Admin/Auditor/Viewer",
  [ADMIN, AUDITOR, VIEWER].map((u) => AC.defaultHomePage(u)), ["home", "home", "home"]);

section("6. Login lands on the Dashboard (Account Officer); other roles unchanged");
/* The exact two steps App.jsx performs, then the AppShell's initial-page rule. */
function simulateLogin(user, oldHash) {
  hashState.value = oldHash;
  AC.writeHashPage(AC.defaultHomePage(user));
  return initialPage(user);
}
function initialPage(user) {
  const fromHash = AC.readHashPage();
  const preferred = fromHash || AC.defaultHomePage(user);
  return AC.canAccessPage(user, preferred) ? preferred : AC.defaultHomePage(user);
}
check("A. Account Officer login -> Dashboard", simulateLogin(AO, ""), "home");
check("A. ...even with a stale #/salary-approval left in the address bar", simulateLogin(AO, "#/salary-approval"), "home");
check("A. ...and a stale #/salary-entry (denied page)", simulateLogin(AO, "#/salary-entry"), "home");
check("the Dashboard hash is what is written", hashState.value, "#/");
check("C. hash round-trip: writeHashPage('home') reads back as home", (AC.writeHashPage("home"), AC.readHashPage()), "home");
check("D. refresh on the Dashboard stays on the Dashboard", initialPage(AO), "home");
check("direct Dashboard URL (#/) opens the Dashboard", (hashState.value = "#/", initialPage(AO)), "home");
check("direct Dashboard URL (#/home) opens the Dashboard", (hashState.value = "#/home", initialPage(AO)), "home");
check("E. Salary Approval is still reachable directly", (hashState.value = "#/salary-approval", initialPage(AO)), "salary-approval");
check("stale/invalid hash falls back to the normal home", (hashState.value = "#/no-such-page", initialPage(AO)), "home");
check("logout clears the hash, next login -> Dashboard again", (AC.writeHashPage("home"), simulateLogin(AO, "#/")), "home");
check("Admin login unchanged (Dashboard)", simulateLogin(ADMIN, "#/salary-entry"), "home");
check("Auditor login unchanged (Dashboard)", simulateLogin(AUDITOR, "#/salary-entry"), "home");
check("Viewer login unchanged (Dashboard)", simulateLogin(VIEWER, "#/salary-entry"), "home");

section("7. Account Officer remains denied everywhere it was denied");
const MASTER_IDS = vm.runInContext("MASTERS", sandbox).map((m) => m.id);
const SALARY_IDS = vm.runInContext("SALARY", sandbox).map((m) => m.id).filter((id) => id !== "salary-approval");
const DA_IDS = vm.runInContext("DA_DIFFERENCE", sandbox).map((m) => m.id);
check("G. every Master page denied", MASTER_IDS.filter((id) => AC.canAccessPage(AO, id)), []);
check("H. Salary Entry / Returning Bills / Final Salary Bill denied", SALARY_IDS.filter((id) => AC.canAccessPage(AO, id)), []);
check("H. DA Difference pages denied", DA_IDS.filter((id) => AC.canAccessPage(AO, id)), []);
check("F. Reports all still allowed", vm.runInContext("REPORTS", sandbox).every((r) => AC.canAccessPage(AO, r.id)), true);
check("nav still Home + Salary Approval + Reports only",
  [AC.getNavMenus(AO).showHome, AC.getNavMenus(AO).salaryApprovalDirect, AC.getNavMenus(AO).showReports, AC.getNavMenus(AO).showMasters, AC.getNavMenus(AO).showSalary, AC.getNavMenus(AO).showDaDifference],
  [true, true, true, false, false, false]);

section("8. No leftover Account Officer -> Salary Approval redirect");
for (const f of [["App.jsx"], ["components", "AppShell.jsx"], ["components", "Breadcrumb.jsx"], ["components", "Header.jsx"], ["components", "Sidebar.jsx"]]) {
  const code = strip(read(FRONT, ...f));
  check(`${f.join("/")} has no Account Officer special-case`, /isAccountOfficer|ACCOUNT_OFFICER/.test(code), false);
}
check("accessControl.defaultHomePage has no Salary Approval landing",
  /export function defaultHomePage[\s\S]{0,120}?\n\}/.exec(strip(read(FRONT, "utils", "accessControl.js")))[0].includes("salary-approval"), false);

section("5. Wiring (source)");
const shell = strip(read(FRONT, "components", "AppShell.jsx"));
check("AppShell honours a Dashboard hash for any role that may open it",
  /const preferred = fromHash \|\| defaultHomePage\(user\)/.test(shell), true);
check("AppShell still validates with canAccessPage", /canAccessPage\(user, preferred\)/.test(shell), true);
const header = strip(read(FRONT, "components", "Header.jsx"));
check("top-nav Home button navigates to the home page id", /navigateAndClose\("home"\)/.test(header), true);
const sidebar = strip(read(FRONT, "components", "Sidebar.jsx"));
check("sidebar branding navigates to Home", /onNavigate\("home"\)/.test(sidebar), true);
const server = read(BACK, "server.js");
check("dashboard API: Account Officer bypass + DASHBOARD prefix kept for others",
  /\/api\/dashboard",[^;]*ACCOUNT_OFFICER[^;]*requirePermissionPrefix\("DASHBOARD"\)/.test(server), true);
check("dashboard API still behind authenticate", /\/api\/dashboard", \.\.\.authed/.test(server), true);

console.log(`\nTOTAL ${passed + failed}  PASSED ${passed}  FAILED ${failed}`);
process.exit(failed ? 1 : 0);
