export const MASTERS = [
  { id: "section-master", label: "Section Master" },
  { id: "institute-master", label: "Institute Master" },
  { id: "employee-master", label: "Employee Master" },
  { id: "payroll-configuration", label: "Payroll Configuration" },
  { id: "designation-master", label: "Designation Master" },
  { id: "pay-revision-master", label: "Pay Revision Master" },
  { id: "pay-matrix", label: "Pay Matrix" },
  { id: "salary-component-master", label: "Salary Component Master" },
  { id: "da-master", label: "DA Master" },
  { id: "increment-master", label: "Increment Master" },
  { id: "hra-master", label: "HRA Master" },
  { id: "cla-master", label: "CLA Master" },
  { id: "medical-allowance", label: "Medical Allowance" },
  { id: "transport-allowance-master", label: "Transport Allowance" },
  { id: "user-master", label: "User Master" },
  { id: "role-permission-master", label: "Role & Permission Master" },
  { id: "salary-bill-code-master", label: "Salary Bill Code Master" },
];

/**
 * Salary navigation.
 *
 * "Salary Process" was removed from this list: it was a stale menu
 * registration only. No SalaryProcess page component exists and AppShell has
 * no renderAuthorized("salary-process", ...) branch, so the entry navigated to
 * a hash that rendered nothing. Its PAGE_PERMISSION_PREFIX mapping and the
 * SALARY_PROCESS permission row are deliberately left in place so no role's
 * permissions change.
 */
export const SALARY = [
  { id: "salary-entry", label: "Salary Entry" },
  { id: "salary-approval", label: "Salary Approval" },
  { id: "returning-bills", label: "Returning Bills" },
  { id: "final-salary-bill", label: "Final Salary Bill" },
];

/** Existing DA Difference pages only — no invented routes. */
export const DA_DIFFERENCE = [
  { id: "da-difference-master", label: "DA Difference Master" },
  { id: "da-difference-entry", label: "DA Difference Entry" },
];

export const REPORTS = [
  { id: "salary-register", label: "Salary Register" },
  { id: "cheque-register", label: "Cheque Register" },
  { id: "bank-copy", label: "Bank Copy" },
  { id: "institute-wise-salary", label: "Institute Wise Salary Report" },
  { id: "employee-wise-salary", label: "Employee Wise Salary Report" },
  { id: "employee-pay-slip", label: "Employee Pay Slip" },
  { id: "section-summary", label: "Section Summary" },
  { id: "gpf-summary", label: "GPF Summary" },
  { id: "institute-wise-gpf", label: "Institute Wise GPF Summary" },
  { id: "nps-summary", label: "NPS Summary" },
  { id: "nps-institute-wise", label: "NPS Institute Wise Summary" },
  { id: "nps-deduction", label: "NPS / GPF Deduction" },
  { id: "income-tax-professional-tax", label: "Income Tax & Professional Tax" },
  { id: "nps-schedule", label: "NPS Schedule Summary" },
  { id: "employee-report", label: "Employee Report" },
  { id: "variation-report", label: "Variation Report" },
];

export const TITLES = {
  "section-master": "SECTION MASTER",
  "institute-master": "INSTITUTE MASTER",
  "employee-master": "EMPLOYEE MASTER",
  "payroll-configuration": "PAYROLL CONFIGURATION",
  "designation-master": "DESIGNATION MASTER",
  "pay-revision-master": "PAY REVISION MASTER",
  "pay-matrix": "PAY MATRIX",
  "salary-component-master": "SALARY COMPONENT MASTER",
  "da-master": "DA MASTER",
  "da-difference-master": "DA DIFFERENCE MASTER",
  "increment-master": "INCREMENT MASTER",
  "hra-master": "HRA MASTER",
  "cla-master": "CLA MASTER",
  "medical-allowance": "MEDICAL ALLOWANCE",
  "transport-allowance-master": "TRANSPORT ALLOWANCE",
  "salary-bill-code-master": "SALARY BILL CODE MASTER",
  "user-master": "USER MASTER",
  "role-permission-master": "ROLE & PERMISSION MASTER",
  "salary-process": "SALARY PROCESS",
  "salary-entry": "SALARY ENTRY",
  "da-difference-entry": "DA DIFFERENCE ENTRY",
  "salary-approval": "SALARY APPROVAL",
  "returning-bills": "RETURNING BILLS",
  "final-salary-bill": "FINAL SALARY BILL",
  "salary-register": "SALARY REGISTER",
  "cheque-register": "CHEQUE REGISTER",
  "bank-copy": "BANK COPY",
  "institute-wise-salary": "INSTITUTE WISE SALARY",
  "employee-wise-salary": "EMPLOYEE WISE SALARY",
  "employee-pay-slip": "EMPLOYEE PAY SLIP",
  "section-summary": "SECTION SUMMARY",
  "gpf-summary": "GPF SUMMARY",
  "institute-wise-gpf": "INSTITUTE WISE GPF SUMMARY",
  "nps-summary": "NPS SUMMARY",
  "nps-institute-wise": "NPS INSTITUTE WISE SUMMARY",
  "nps-deduction": "NPS / GPF DEDUCTION REPORT",
  "income-tax-professional-tax": "INCOME TAX & PROFESSIONAL TAX",
  "nps-schedule": "NPS SCHEDULE SUMMARY",
  "employee-report": "EMPLOYEE REPORT",
  "variation-report": "VARIATION REPORT",
  "change-password": "CHANGE PASSWORD",
};
