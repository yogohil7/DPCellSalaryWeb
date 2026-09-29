import { MASTERS, REPORTS, SALARY, DA_DIFFERENCE } from "../modules";

export function normalizeRole(roleName) {
  const raw = String(roleName || "")
    .trim()
    .toUpperCase();
  if (!raw) return "OTHER";
  if (raw.includes("SUPER") || raw === "ADMIN" || raw.includes("ADMINISTRATOR")) {
    return "ADMIN";
  }
  if (raw.includes("ACCOUNT") && raw.includes("OFFICER")) {
    return "ACCOUNT_OFFICER";
  }
  if (raw.includes("AUDITOR")) return "AUDITOR";
  return "OTHER";
}

export function isAdminUser(user) {
  return normalizeRole(user?.roleName || user?.role) === "ADMIN";
}

export function isAccountOfficer(user) {
  return normalizeRole(user?.roleName || user?.role) === "ACCOUNT_OFFICER";
}

export function isAuditor(user) {
  return normalizeRole(user?.roleName || user?.role) === "AUDITOR";
}

export const PAGE_PERMISSION_PREFIX = {
  home: "DASHBOARD",
  "change-password": "CHANGE_PASSWORD",
  "section-master": "MASTER_SECTION",
  "institute-master": "MASTER_INSTITUTE",
  "employee-master": "MASTER_EMPLOYEE",
  "payroll-configuration": "MASTER_PAYROLL_CONFIG",
  "designation-master": "MASTER_DESIGNATION",
  "pay-revision-master": "MASTER_PAY_REVISION",
  "pay-matrix": "MASTER_PAY_MATRIX",
  "salary-component-master": "MASTER_SALARY_COMPONENT",
  "da-master": "MASTER_DA",
  "da-difference-master": "MASTER_DA_DIFFERENCE",
  "increment-master": "MASTER_INCREMENT",
  "hra-master": "MASTER_HRA",
  "cla-master": "MASTER_CLA",
  "medical-allowance": "MASTER_MEDICAL_ALLOWANCE",
  "transport-allowance-master": "MASTER_TRANSPORT_ALLOWANCE",
  "user-master": "MASTER_USER",
  "role-permission-master": "MASTER_ROLE_PERMISSION",
  "salary-bill-code-master": "MASTER_SALARY_BILL_CODE",
  "salary-entry": "SALARY_ENTRY",
  "da-difference-entry": "DA_DIFFERENCE_ENTRY",
  "salary-approval": "SALARY_APPROVAL",
  "returning-bills": "SALARY_RETURNING",
  "final-salary-bill": "SALARY_FINAL_BILL",
  "salary-register": "REPORT_SALARY",
  "cheque-register": "REPORT_BILL",
  "bank-copy": "REPORT_BILL",
  "institute-wise-salary": "REPORT_SALARY",
  "employee-wise-salary": "REPORT_SALARY",
  "employee-pay-slip": "REPORT_SALARY",
  "section-summary": "REPORT_SALARY",
  "gpf-summary": "REPORT_SALARY",
  "institute-wise-gpf": "REPORT_SALARY",
  "nps-summary": "REPORT_SALARY",
  "nps-institute-wise": "REPORT_SALARY",
  "nps-deduction": "REPORT_SALARY",
  "income-tax-professional-tax": "REPORT_SALARY",
  "nps-schedule": "REPORT_SALARY",
  "month-wise-employee-salary": "REPORT_SALARY",
  "employee-report": "REPORT_SALARY",
  "variation-report": "REPORT_VARIATION",
  /* Drill-down of Salary Register — same permission as the register itself;
     not a separate menu entry (see modules.js REPORTS: intentionally absent). */
  "salary-register-detail": "REPORT_SALARY",
};

function permissionList(user) {
  if (Array.isArray(user?.permissions)) return user.permissions;
  return [];
}

export function hasPermissionPrefix(user, prefix) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const needle = String(prefix || "").toUpperCase();
  if (!needle) return false;
  return permissionList(user).some((code) =>
    String(code).toUpperCase().startsWith(needle)
  );
}

/*
 * A page id is valid only if it is registered here. Anything else (a removed
 * module, a mistyped hash) is not a page: it is never rendered and AppShell
 * silently redirects to the user's home page.
 */
export function isKnownPage(pageId) {
  const id = String(pageId || "").trim();
  return Object.prototype.hasOwnProperty.call(PAGE_PERMISSION_PREFIX, id);
}

export function canAccessPage(user, pageId) {
  const id = String(pageId || "").trim();
  if (!id || !user) return false;
  if (id === "change-password") return true;
  if (!isKnownPage(id)) return false;

  const role = normalizeRole(user.roleName || user.role);
  if (role === "ADMIN") return true;

  /* Salary Bill Approval is Accounts Officer / Admin only — never Auditor. */
  if (id === "salary-approval") {
    return role === "ACCOUNT_OFFICER";
  }

  if (role === "ACCOUNT_OFFICER") {
    /* The Dashboard is open to an Account Officer (their landing page is
       still Salary Approval — see defaultHomePage). */
    if (id === "home") return true;
    if (REPORTS.some((item) => item.id === id)) return true;
    return false;
  }

  if (role === "AUDITOR") {
    if (id === "user-master" || id === "role-permission-master") return false;
    const prefix = PAGE_PERMISSION_PREFIX[id];
    if (prefix && permissionList(user).length > 0) {
      /* Ignore any wrongly granted SALARY_APPROVAL_* on Auditor. */
      if (String(prefix).toUpperCase().startsWith("SALARY_APPROVAL")) {
        return false;
      }
      return hasPermissionPrefix(user, prefix);
    }
    return id !== "user-master" && id !== "role-permission-master";
  }

  const prefix = PAGE_PERMISSION_PREFIX[id];
  if (!prefix) return false;
  return hasPermissionPrefix(user, prefix);
}

/* Every role lands on the Dashboard. (An Account Officer used to land on
   Salary Approval; the Dashboard is now their home, and Salary Approval is
   one click away in the top navigation.) */
export function defaultHomePage() {
  return "home";
}

export function filterNavItems(user, items) {
  return (items || []).filter((item) => canAccessPage(user, item.id));
}

export function getNavMenus(user) {
  const authorizedMasters = filterNavItems(user, MASTERS);
  const administrationIds = new Set(["user-master", "role-permission-master"]);
  const masters = authorizedMasters.filter((item) => !administrationIds.has(item.id));
  const administration = authorizedMasters.filter((item) => administrationIds.has(item.id));
  const salary = filterNavItems(user, SALARY);
  const daDifference = filterNavItems(user, DA_DIFFERENCE);
  const reports = filterNavItems(user, REPORTS);
  const role = normalizeRole(user?.roleName || user?.role);

  if (role === "ACCOUNT_OFFICER") {
    return {
      showHome: canAccessPage(user, "home"),
      masters: [],
      administration: [],
      salary: [],
      daDifference: [],
      reports,
      salaryApprovalDirect: canAccessPage(user, "salary-approval"),
      showMasters: false,
      showSalary: false,
      showDaDifference: false,
      showReports: reports.length > 0,
    };
  }

  return {
    showHome: true,
    masters,
    administration,
    salary,
    daDifference,
    reports,
    salaryApprovalDirect: false,
    showMasters: masters.length > 0,
    showAdministration: administration.length > 0,
    showSalary: salary.length > 0,
    showDaDifference: daDifference.length > 0,
    showReports: reports.length > 0,
  };
}

export function readHashPage() {
  const hash = String(window.location.hash || "").replace(/^#\/?/, "").trim();
  if (!hash || hash === "home") return "home";
  return hash.split("?")[0];
}

/*
 * The query-string portion of the hash, as a plain object — e.g.
 * "#/salary-register-detail?workflowId=52&month=8" -> { workflowId: "52", month: "8" }.
 * Used so a page can carry state (a drill-down's bill identity, a report's
 * filters) through refresh and browser back/forward, rather than only in
 * transient React state that a reload discards. Empty when the hash has no
 * "?" — every existing single-id hash keeps working exactly as before.
 */
export function readHashParams() {
  const hash = String(window.location.hash || "");
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return {};
  const out = {};
  new URLSearchParams(hash.slice(qIndex + 1)).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/*
 * params is optional and additive: writeHashPage(id) writes exactly the same
 * "#/id" it always has. writeHashPage(id, params) appends params as a query
 * string on the hash, so a refresh or a hashchange (back/forward) can restore
 * them via readHashParams() instead of losing them to in-memory state alone.
 */
export function writeHashPage(pageId, params) {
  const id = String(pageId || "home");
  const usable =
    params && typeof params === "object"
      ? Object.entries(params).filter(
          ([, v]) => v !== undefined && v !== null && v !== ""
        )
      : [];
  const query = usable.length
    ? `?${new URLSearchParams(usable.map(([k, v]) => [k, String(v)])).toString()}`
    : "";
  const next = (id === "home" ? "#/" : `#/${id}`) + query;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}
