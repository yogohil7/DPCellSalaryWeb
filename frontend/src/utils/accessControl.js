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
  "salary-process": "SALARY_PROCESS",
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
  "employee-report": "REPORT_SALARY",
  "variation-report": "REPORT_VARIATION",
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

export function canAccessPage(user, pageId) {
  const id = String(pageId || "").trim();
  if (!id || !user) return false;
  if (id === "change-password") return true;

  const role = normalizeRole(user.roleName || user.role);
  if (role === "ADMIN") return true;

  /* Salary Bill Approval is Accounts Officer / Admin only — never Auditor. */
  if (id === "salary-approval") {
    return role === "ACCOUNT_OFFICER";
  }

  if (role === "ACCOUNT_OFFICER") {
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

export function defaultHomePage(user) {
  if (isAccountOfficer(user)) return "salary-approval";
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
      showHome: false,
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

export function writeHashPage(pageId) {
  const id = String(pageId || "home");
  const next = id === "home" ? "#/" : `#/${id}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}
