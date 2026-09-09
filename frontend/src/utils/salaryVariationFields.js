/**
 * Shared Salary Entry component fields for Variation Report.
 * Keep labels/keys aligned with Salary Entry grid + backend VARIATION_COMPONENT_FIELDS.
 */
export const VARIATION_COMPONENT_FIELDS = [
  { key: "basicPay", label: "Basic Pay", group: "EARNING" },
  { key: "fixBasic", label: "FIX Basic", group: "EARNING" },
  { key: "totalBasicPay", label: "Total Basic Pay", group: "EARNING" },
  { key: "da", label: "DA", group: "EARNING" },
  { key: "hra", label: "HRA", group: "EARNING" },
  { key: "ma", label: "MA", group: "EARNING" },
  { key: "ta", label: "TA", group: "EARNING" },
  { key: "cla", label: "CLA", group: "EARNING" },
  { key: "specialAllowance", label: "Special Allowance", group: "EARNING" },
  { key: "washingAllowance", label: "Washing Allowance", group: "EARNING" },
  { key: "otherEarnings", label: "Other Earnings", group: "EARNING" },
  { key: "nppa", label: "NPPA", group: "EARNING" },
  { key: "grossSalary", label: "Gross Amount", group: "TOTAL" },
  { key: "gpfSubscription", label: "GPF Amount", group: "DEDUCTION" },
  { key: "gpfAdvance", label: "GPF Advance", group: "DEDUCTION" },
  { key: "nps", label: "NPS", group: "DEDUCTION" },
  { key: "incomeTax", label: "IT Tax", group: "DEDUCTION" },
  { key: "professionalTax", label: "P.Tax", group: "DEDUCTION" },
  { key: "otherDeduction", label: "Other Deduction", group: "DEDUCTION" },
  { key: "totalDeduction", label: "Total Deduction", group: "TOTAL" },
  { key: "netSalary", label: "Net Salary", group: "TOTAL" },
  { key: "chequeAmount", label: "Cheque Amount", group: "TOTAL" },
];

export function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function money(value) {
  return toNum(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function signedMoney(value) {
  const n = toNum(value);
  const formatted = money(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

export function variationClass(value) {
  const n = toNum(value);
  if (n > 0) return "ser-plus";
  if (n < 0) return "ser-minus";
  return "ser-zero";
}
