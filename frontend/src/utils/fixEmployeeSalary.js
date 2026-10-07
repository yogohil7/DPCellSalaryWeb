/**
 * FIX employees are paid only Fix Basic.
 * Regular percentage and fixed allowances do not apply.
 * Deduction rules (GPF, NPS, tax) stay with the caller.
 */

export function isFixEmployeeType(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return raw === "FIX" || raw === "FIXED";
}

export const FIX_INAPPLICABLE_EARNING_FIELDS = [
  "da",
  "hra",
  "ma",
  "ta",
  "cla",
  "specialAllowance",
  "washingAllowance",
  "otherEarnings",
  "nppa",
];

/**
 * Returns the same object for a REGULAR employee, or when preserve is set
 * so an Approved/Locked snapshot stays on screen unchanged.
 */
export function applyFixEmployeeEarnings(row, { preserve = false } = {}) {
  if (!row || preserve || !isFixEmployeeType(row.employeeType)) return row;
  const next = { ...row, basicPay: 0 };
  for (const key of FIX_INAPPLICABLE_EARNING_FIELDS) next[key] = 0;
  return next;
}
