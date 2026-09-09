/**
 * Authoritative REGULAR / FIX BasicPay rules.
 * REGULAR → PayMatrixMaster.BasicPay
 * FIX → 0
 */

function normalizeEmployeeType(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (raw === "REGULAR" || raw === "REG") return "REGULAR";
  if (raw === "FIX" || raw === "FIXED") return "FIX";
  return null;
}

function isPayChanged(before, after) {
  const n = (v) => (v == null || v === "" ? null : Number(v));
  return (
    normalizeEmployeeType(before.EmployeeType || before.employeeType) !==
      after.employeeType ||
    n(before.PayRevisionId ?? before.payRevisionId) !== n(after.payRevisionId) ||
    n(before.PayLevel ?? before.payLevel) !== n(after.payLevel) ||
    n(before.PayMatrixCellNo ?? before.payMatrixCellNo) !==
      n(after.payMatrixCellNo) ||
    n(before.PayMatrixId ?? before.payMatrixId) !== n(after.payMatrixId) ||
    Number(before.BasicPay ?? before.basicPay ?? 0) !== Number(after.basicPay ?? 0)
  );
}

module.exports = {
  normalizeEmployeeType,
  isPayChanged,
};
