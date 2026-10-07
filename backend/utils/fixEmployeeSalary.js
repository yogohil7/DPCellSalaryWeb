/**
 * FIX employees are paid only Fix Basic.
 * Regular percentage and fixed allowances do not apply.
 * Deduction rules (GPF, NPS, tax) stay with the caller.
 */

function isFixEmployeeType(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return raw === "FIX" || raw === "FIXED";
}

const FIX_INAPPLICABLE_EARNING_FIELDS = [
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
 * so an Approved/Locked snapshot stays unchanged.
 */
function applyFixEmployeeEarnings(row, { preserve = false } = {}) {
  if (!row || preserve || !isFixEmployeeType(row.employeeType)) return row;
  const next = { ...row, basicPay: 0 };
  for (const key of FIX_INAPPLICABLE_EARNING_FIELDS) next[key] = 0;
  return next;
}

/** Zero earning component lines for a FIX employee. Deduction lines stay as calculated. */
function zeroFixEarningComponentLines(lines, employeeType) {
  if (!isFixEmployeeType(employeeType) || !Array.isArray(lines)) return lines;
  for (const line of lines) {
    const earning = line.isEarning === true || line.isEarning === 1;
    if (!earning) continue;
    line.amount = 0;
    const code = String(line.componentCode || "").toUpperCase();
    if (code === "DA" || code === "HRA") line.rate = 0;
  }
  return lines;
}

module.exports = {
  isFixEmployeeType,
  FIX_INAPPLICABLE_EARNING_FIELDS,
  applyFixEmployeeEarnings,
  zeroFixEarningComponentLines,
};
