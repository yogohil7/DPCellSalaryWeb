/*
  ==================================================================
  GLOBAL BREADCRUMB — "HOME" NAVIGATION
  ==================================================================

  The shared components/Breadcrumb.jsx renders  Home / <section> / <current>
  on every page that uses it. "Home" must take the signed-in user to THEIR
  home page, on every page, for every role, without a full reload and without
  weakening access control.

  This suite does two things:

    1. It EXECUTES the real utils/accessControl.js. That file is ESM, which
       node cannot require directly, so its source is evaluated in a sandbox
       with a fake `window` — the genuine defaultHomePage / canAccessPage /
       writeHashPage run, not a copy.

    2. It asserts the shared component's contract and that no page has grown
       its own competing Home link.

  Offline. No database, no server, no network.

  Usage: cd backend && npm run test:breadcrumb-home
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const crumbSrc = fs.readFileSync(path.join(FRONT, "components", "Breadcrumb.jsx"), "utf8");
// Executable view of the component: block and line comments removed. Negative
// assertions ("the breadcrumb must NOT do X") run against this so that an
// explanatory comment mentioning X cannot fail a correct implementation.
const crumbCode = crumbSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const accessSrc = fs.readFileSync(path.join(FRONT, "utils", "accessControl.js"), "utf8");
const shellSrc = fs.readFileSync(path.join(FRONT, "components", "AppShell.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(FRONT, "App.css"), "utf8");
const pagesDir = path.join(FRONT, "pages");
const pageFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".jsx"));

/* ---- runner with per-section accounting ---- */
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

/* ------------------------------------------------------------------ *
 * Evaluate the REAL accessControl module.
 *
 * It is ESM and imports ./modules.js, so both are stripped of their module
 * syntax and evaluated together in one sandbox. The function bodies are
 * untouched — this executes the shipped logic, not a re-implementation.
 * ------------------------------------------------------------------ */
function loadAccessControl() {
  const modulesSrc = fs.readFileSync(path.join(FRONT, "modules.js"), "utf8");
  const strip = (src) =>
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
  vm.runInContext(`${strip(modulesSrc)}\n${strip(accessSrc)}`, sandbox, {
    filename: "accessControl.js",
  });
  return { sandbox, hashState };
}

const { sandbox: AC, hashState } = loadAccessControl();

const ADMIN = { roleName: "Super Admin", permissions: [] };
const ACCOUNT_OFFICER = { roleName: "Account Officer", permissions: [] };
const AUDITOR = { roleName: "Auditor", permissions: [] };

/* The seven journeys the requirement names. */
const JOURNEYS = [
  { page: "home", label: "Dashboard / Home" },
  { page: "section-master", label: "Masters > Section Master" },
  { page: "institute-master", label: "Masters > Institute Master" },
  { page: "employee-master", label: "Employee Master" },
  { page: "salary-entry", label: "Salary Entry" },
  { page: "salary-approval", label: "Salary Bill Approval" },
  { page: "employee-wise-salary", label: "a report page" },
];

(function main() {
  console.log("=".repeat(70));
  console.log("GLOBAL BREADCRUMB — HOME NAVIGATION");
  console.log("=".repeat(70));

  section("1. A single shared breadcrumb, used everywhere");
  {
    const consumers = pageFiles.filter((f) =>
      /<Breadcrumb\b/.test(fs.readFileSync(path.join(pagesDir, f), "utf8"))
    );
    check("the shared component exists",
      fs.existsSync(path.join(FRONT, "components", "Breadcrumb.jsx")), true);
    check("it is used by many pages", consumers.length >= 15, true);
    check("every consumer imports the shared one, none reimplements it",
      consumers.filter((f) => {
        const src = fs.readFileSync(path.join(pagesDir, f), "utf8");
        return !/from ["'][^"']*components\/Breadcrumb["']/.test(src);
      }), []);
    check("no page renders its own Home link beside the breadcrumb",
      consumers.filter((f) => {
        const src = fs.readFileSync(path.join(pagesDir, f), "utf8");
        return /breadcrumb[\s\S]{0,400}>\s*Home\s*</i.test(src);
      }), []);
    check("Home appears exactly once in the shared component",
      (crumbSrc.match(/>\s*Home\s*</g) || []).length, 1);
  }

  section("2. Home is a real, accessible control");
  {
    check("it is a <button>, not inert text",
      /<button[\s\S]{0,200}app-breadcrumb-home/.test(crumbSrc), true);
    check("with type=\"button\" so it never submits a form",
      /type="button"[\s\S]{0,120}app-breadcrumb-home/.test(crumbSrc), true);
    check("and an onClick handler", /onClick=\{goHome\}/.test(crumbSrc), true);
    check("the section and current segments are unchanged",
      /\{section \? ` \/ \$\{section\}` : ""\} \/ \{current\}/.test(crumbSrc), true);
    check("the current page is NOT a link",
      /<button[\s\S]*\{current\}[\s\S]*<\/button>/.test(crumbCode), false);
  }

  section("3. Home resolves to the user's OWN home, per role");
  {
    /* The real, executed defaultHomePage. */
    check("Admin's home is the dashboard",
      AC.defaultHomePage(ADMIN), "home");
    check("Auditor's home is the dashboard",
      AC.defaultHomePage(AUDITOR), "home");
    check("Account Officer's home is Salary Approval",
      AC.defaultHomePage(ACCOUNT_OFFICER), "salary-approval");

    /* The defect this fixes: "home" is NOT accessible to an Account Officer,
       so navigating to the literal id raised a false access-denied notice. */
    check("canAccessPage denies the literal \"home\" to an Account Officer",
      AC.canAccessPage(ACCOUNT_OFFICER, "home"), false);
    check("but every role CAN reach its own resolved home",
      [ADMIN, AUDITOR, ACCOUNT_OFFICER].map((u) =>
        AC.canAccessPage(u, AC.defaultHomePage(u))), [true, true, true]);
    check("the breadcrumb resolves through defaultHomePage",
      /writeHashPage\(defaultHomePage\(actor\)\)/.test(crumbSrc), true);
    check("and no longer hard-codes the \"home\" id",
      /window\.location\.hash\s*=\s*["']#\/home["']/.test(crumbCode), false);
  }

  section("4. Navigation uses the app's own routing helper");
  {
    check("it calls the shared writeHashPage, not a raw hash assignment",
      /writeHashPage\(/.test(crumbSrc) &&
        !/window\.location\.hash\s*=/.test(crumbCode), true);
    check("no full-page reload is triggered",
      /location\.(href|assign|replace)\s*=|window\.location\.reload/.test(crumbCode),
      false);
    check("no router library is introduced",
      /react-router|useNavigate|<Link/.test(crumbCode), false);

    /* Execute the real writeHashPage for each role's home. */
    hashState.value = "#/section-master";
    AC.writeHashPage(AC.defaultHomePage(ADMIN));
    check("Admin: the canonical home hash is written", hashState.value, "#/");
    hashState.value = "#/section-master";
    AC.writeHashPage(AC.defaultHomePage(ACCOUNT_OFFICER));
    check("Account Officer: lands on Salary Approval",
      hashState.value, "#/salary-approval");
    check("the hash round-trips back to the same page id",
      AC.readHashPage(), "salary-approval");
  }

  section("5. The seven required journeys");
  {
    for (const j of JOURNEYS) {
      for (const [roleName, user] of [
        ["Admin", ADMIN], ["Auditor", AUDITOR], ["AO", ACCOUNT_OFFICER],
      ]) {
        hashState.value = `#/${j.page}`;
        const target = AC.defaultHomePage(user);
        AC.writeHashPage(target);
        const landed = AC.readHashPage();
        const allowed = AC.canAccessPage(user, landed);
        if (!allowed || landed !== target) {
          check(`${roleName} on ${j.label} → home`, { landed, allowed }, { landed: target, allowed: true });
        }
      }
      check(`${j.label}: Home reaches an allowed home page for every role`, true, true);
    }
  }

  section("6. Access control is unchanged");
  {
    check("the breadcrumb performs no permission check of its own",
      /canAccessPage|permission|roleName/i.test(crumbCode), false);
    check("it reads the session user rather than trusting a prop alone",
      /getStoredUser\(\)/.test(crumbSrc), true);
    check("AppShell still routes every hash change through safeNavigate",
      /onHashChange[\s\S]{0,220}safeNavigate\(/.test(shellSrc), true);
    check("and safeNavigate still checks canAccessPage",
      /canAccessPage\(/.test(shellSrc), true);
    check("no authentication is bypassed",
      /clearAuthSession|setAuthSession|token/i.test(crumbCode), false);
    check("accessControl.js itself was not modified for this fix",
      /export function defaultHomePage\(user\) \{\s*\n\s*if \(isAccountOfficer\(user\)\) return "salary-approval";\s*\n\s*return "home";/
        .test(accessSrc), true);
  }

  section("7. Appearance and side effects");
  {
    check("the existing Home style is reused, not redesigned",
      /\.app-breadcrumb-home\s*\{/.test(cssSrc), true);
    check("it already shows a pointer cursor",
      /\.app-breadcrumb-home[\s\S]{0,220}cursor:\s*pointer/.test(cssSrc), true);
    check("and has a hover / focus state",
      /\.app-breadcrumb-home:hover/.test(cssSrc), true);
    check("no new class or inline style was introduced",
      /style=\{\{|className="(?!app-breadcrumb-home)/.test(
        crumbCode.replace(/className=\{className\}/g, "")), false);
    check("clicking Home makes no API call",
      /fetch\(|apiFetch|axios|API_BASE/.test(crumbCode), false);
    check("and writes nothing anywhere",
      /localStorage|sessionStorage\.setItem|POST|PUT|DELETE/.test(crumbCode), false);
  }

  section("8. Nothing outside the breadcrumb changed");
  {
    check("no salary calculation file is touched by this component",
      /salaryBasicCalc|calculateNps|daDifference/i.test(crumbCode), false);
    check("the component is small and single-purpose",
      crumbSrc.split("\n").filter((l) => l.trim() && !l.trim().startsWith("*") &&
        !l.trim().startsWith("/*")).length < 30, true);
    check("it imports only session + routing helpers",
      (crumbSrc.match(/^import /gm) || []).length, 2);
  }

  closeSection();
  sectionName = "";

  console.log(`\n${"=".repeat(70)}`);
  console.log("SECTION SUMMARY");
  console.log("=".repeat(70));
  sectionReport.forEach((s) => {
    console.log(`  ${s.verdict.padEnd(5)} ${String(s.assertions).padStart(3)} assertions   ${s.name}`);
  });
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  TOTAL ASSERTIONS : ${passed + failed}`);
  console.log(`  PASSED           : ${passed}`);
  console.log(`  FAILED           : ${failed}`);
  console.log("=".repeat(70));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
})();
