/**
 * Central Basic → Total Basic Pay → DA / HRA / NPS calculation.
 * Total Basic Pay is a calculation base only (do not add it again into Gross).
 */

export function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Number(toNum(value).toFixed(2));
}

/** NPS = CEILING((Total Basic Pay + DA) × 10%, 1) */
export function calculateNps(totalBasicPay, da) {
  return Math.ceil((toNum(totalBasicPay) + toNum(da)) * 0.1);
}

/**
 * Cheque Amount = Net Salary + Income Tax + Professional Tax.
 * Do not derive from Gross or other deductions (GPF/NPS/etc.).
 */
export function calculateChequeAmount({
  netSalary,
  incomeTax,
  professionalTax,
  professionTax,
} = {}) {
  return roundMoney(
    toNum(netSalary) +
      toNum(incomeTax) +
      toNum(
        professionalTax != null && professionalTax !== ""
          ? professionalTax
          : professionTax
      )
  );
}

/**
 * @param {object} input
 * @param {boolean} [input.payrollHra] when true, force HRA amount to 0 (HRA NO)
 */
export function calculateSalaryAmounts(input = {}) {
  const basic = Math.max(0, toNum(input.basic));
  const fixBasic = Math.max(0, toNum(input.fixBasic));
  const daPercentage = Math.max(0, toNum(input.daPercentage));
  const hraPercentage = Math.max(0, toNum(input.hraPercentage));
  const payrollHra = Boolean(input.payrollHra);

  const totalBasicPay = roundMoney(basic + fixBasic);
  const da = roundMoney((totalBasicPay * daPercentage) / 100);
  const hra = payrollHra
    ? 0
    : roundMoney((totalBasicPay * hraPercentage) / 100);
  const nps = calculateNps(totalBasicPay, da);

  return {
    basic,
    fixBasic,
    totalBasicPay,
    daPercentage,
    hraPercentage,
    da,
    hra,
    nps,
    payrollHra,
  };
}
