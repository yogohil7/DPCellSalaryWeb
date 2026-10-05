/**
 * Central Basic → Total Basic Pay → DA / HRA / NPS calculation.
 * Total Basic Pay is a calculation base only (do not add it again into Gross).
 */

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Number(toNum(value).toFixed(2));
}

/**
 * DA amount, nearest rupee, half up (away from zero).
 * Below .50 stays on the lower rupee; .50 and above goes to the next.
 * 17380.49 → 17380, 17380.50 → 17381. Other components stay on roundMoney.
 */
function roundDaRupee(value) {
  const n = toNum(value);
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const fraction = abs - whole;
  return sign * (fraction + 1e-9 >= 0.5 ? whole + 1 : whole);
}

/**
 * NPS = CEILING((Total Basic Pay + DA) × 10%, 1)
 */
function calculateNps(totalBasicPay, da) {
  return Math.ceil((toNum(totalBasicPay) + toNum(da)) * 0.1);
}

/**
 * @param {object} input
 * @param {number|string} input.basic
 * @param {number|string} [input.fixBasic]
 * @param {number|string} [input.daPercentage]
 * @param {number|string} [input.hraPercentage]
 * @param {boolean} [input.payrollHra] - When true, force HRA amount to 0 (HRA NO)
 * @param {boolean} [input.includeNps] - when true, also return NPS from Total Basic + DA
 */
function calculateSalaryAmounts(input = {}) {
  const basic = Math.max(0, toNum(input.basic));
  const fixBasic = Math.max(0, toNum(input.fixBasic));
  const daPercentage = Math.max(0, toNum(input.daPercentage));
  const hraPercentage = Math.max(0, toNum(input.hraPercentage));
  const payrollHra = Boolean(input.payrollHra);

  const totalBasicPay = roundMoney(basic + fixBasic);
  const da = roundDaRupee((totalBasicPay * daPercentage) / 100);
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

/**
 * Cheque Amount = Net Salary + Income Tax + Professional Tax.
 * Do not derive from Gross or other deductions (GPF/NPS/etc.).
 */
function calculateChequeAmount({
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

module.exports = {
  toNum,
  roundMoney,
  roundDaRupee,
  calculateNps,
  calculateSalaryAmounts,
  calculateChequeAmount,
};
