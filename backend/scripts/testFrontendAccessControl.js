/**
 * Offline frontend access-control unit checks (no browser).
 */
const assert = require("assert");

/* Mirror the role rules used by frontend/src/utils/accessControl.js */
function normalizeRole(roleName) {
  const raw = String(roleName || "").trim().toUpperCase();
  if (!raw) return "OTHER";
  if (raw.includes("SUPER") || raw === "ADMIN" || raw.includes("ADMINISTRATOR")) {
    return "ADMIN";
  }
  if (raw.includes("ACCOUNT") && raw.includes("OFFICER")) return "ACCOUNT_OFFICER";
  if (raw.includes("AUDITOR")) return "AUDITOR";
  return "OTHER";
}

const REPORTS = [
  "salary-register",
  "cheque-register",
  "variation-report",
];

function canAccessPage(user, pageId) {
  const id = String(pageId || "").trim();
  if (!id || !user) return false;
  if (id === "change-password") return true;
  const role = normalizeRole(user.roleName);
  if (role === "ADMIN") return true;
  if (id === "salary-approval") {
    return role === "ACCOUNT_OFFICER";
  }
  if (role === "ACCOUNT_OFFICER") {
    if (REPORTS.includes(id)) return true;
    return false;
  }
  if (role === "AUDITOR") {
    if (id === "user-master" || id === "role-permission-master") return false;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (perms.length > 0) {
      const map = {
        "salary-entry": "SALARY_ENTRY",
        "salary-approval": "SALARY_APPROVAL",
        "institute-master": "MASTER_INSTITUTE",
        "variation-report": "REPORT_VARIATION",
        "cheque-register": "REPORT_BILL",
      };
      const prefix = map[id];
      if (!prefix) return false;
      if (String(prefix).toUpperCase().startsWith("SALARY_APPROVAL")) return false;
      return perms.some((p) => String(p).toUpperCase().startsWith(prefix));
    }
    return id !== "user-master" && id !== "role-permission-master";
  }
  return false;
}

let failed = 0;
function check(label, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    console.log(`  PASS  ${label}`);
  } catch {
    console.error(`  FAIL  ${label} (got ${actual}, expected ${expected})`);
    failed += 1;
  }
}

console.log("Frontend access-control unit checks\n");

const ao = { roleName: "Account Officer", permissions: [] };
check("AO can open Salary Approval", canAccessPage(ao, "salary-approval"), true);
check("AO can open Reports", canAccessPage(ao, "salary-register"), true);
check("AO can open Cheque Register", canAccessPage(ao, "cheque-register"), true);
check("AO cannot open Home", canAccessPage(ao, "home"), false);
check("AO cannot open User Master", canAccessPage(ao, "user-master"), false);
check("AO cannot open Salary Entry", canAccessPage(ao, "salary-entry"), false);
check("AO cannot open DA Difference", canAccessPage(ao, "da-difference-entry"), false);
check("AO cannot open Employee Master", canAccessPage(ao, "employee-master"), false);

const aud = { roleName: "Auditor", permissions: [] };
check("Auditor can open Salary Entry", canAccessPage(aud, "salary-entry"), true);
check("Auditor can open Masters", canAccessPage(aud, "institute-master"), true);
check("Auditor cannot open User Master", canAccessPage(aud, "user-master"), false);
check("Auditor can open Reports", canAccessPage(aud, "variation-report"), true);
check("Auditor can open Cheque Register", canAccessPage(aud, "cheque-register"), true);
check("Auditor cannot open Salary Approval", canAccessPage(aud, "salary-approval"), false);

const audWithWrongPerms = {
  roleName: "Auditor",
  permissions: ["SALARY_APPROVAL_VIEW", "SALARY_ENTRY_VIEW"],
};
check(
  "Auditor blocked from Salary Approval even with SALARY_APPROVAL permission",
  canAccessPage(audWithWrongPerms, "salary-approval"),
  false
);
check(
  "Auditor still can open Salary Entry with permissions",
  canAccessPage(audWithWrongPerms, "salary-entry"),
  true
);

const admin = { roleName: "Super Admin", permissions: [] };
check("Admin can open User Master", canAccessPage(admin, "user-master"), true);
check("Admin can open Role Permission", canAccessPage(admin, "role-permission-master"), true);

console.log(
  failed
    ? `\nFAILED: ${failed}`
    : "\nAll frontend access-control checks passed."
);
process.exit(failed ? 1 : 0);
