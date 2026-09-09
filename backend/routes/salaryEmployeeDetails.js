const { sql } = require("../db");
const { calculateChequeAmount } = require("../utils/salaryBasicCalc");

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function calcTotals(row) {
  const basicPay = toNum(row.basicPay);
  const gradePay = toNum(row.gradePay);
  const totalBasic = basicPay + gradePay;
  const da = toNum(row.da);
  const hra = toNum(row.hra);
  const ma = toNum(row.ma);
  const ta = toNum(row.ta);
  const specialAllowance = toNum(row.specialAllowance);
  const washingAllowance = toNum(row.washingAllowance);
  const grossSalary =
    totalBasic + da + hra + ma + ta + specialAllowance + washingAllowance;

  const gpfSubscription = toNum(row.gpfSubscription);
  const gpfAdvance = toNum(row.gpfAdv ?? row.gpfAdvance);
  const nps = toNum(row.nps);
  const incomeTax = toNum(row.incomeTax);
  const professionalTax = toNum(row.professionTax ?? row.professionalTax);
  const otherDeduction = toNum(row.otherDeduction);
  const totalDeduction =
    gpfSubscription +
    gpfAdvance +
    nps +
    incomeTax +
    professionalTax +
    otherDeduction;
  const netSalary = grossSalary - totalDeduction;
  const chequeAmount = calculateChequeAmount({
    netSalary,
    incomeTax,
    professionalTax,
  });

  return {
    basicPay,
    gradePay,
    totalBasic,
    da,
    hra,
    ma,
    ta,
    specialAllowance,
    washingAllowance,
    grossSalary,
    gpfSubscription,
    gpfAdvance,
    nps,
    incomeTax,
    professionalTax,
    otherDeduction,
    totalDeduction,
    netSalary,
    chequeAmount,
  };
}

function mapEmployeeRow(row) {
  return {
    id: Number(row.Id),
    salaryBillCodeId: Number(row.SalaryBillCodeId),
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName,
    designation: row.Designation || "",
    employeeType: row.EmployeeType || "",
    displayOrder: Number(row.DisplayOrder),
    basicPay: toNum(row.BasicPay),
    gradePay: toNum(row.GradePay),
    totalBasic: toNum(row.TotalBasic),
    da: toNum(row.DA),
    hra: toNum(row.HRA),
    ma: toNum(row.MA),
    ta: toNum(row.TA),
    specialAllowance: toNum(row.SpecialAllowance),
    washingAllowance: toNum(row.WashingAllowance),
    grossAmount: toNum(row.GrossSalary),
    grossSalary: toNum(row.GrossSalary),
    gpfSubscription: toNum(row.GPFSubscription),
    gpfAdv: toNum(row.GPFAdvance),
    gpfAdvance: toNum(row.GPFAdvance),
    nps: toNum(row.NPS),
    incomeTax: toNum(row.IncomeTax),
    professionTax: toNum(row.ProfessionalTax),
    professionalTax: toNum(row.ProfessionalTax),
    otherDeduction: toNum(row.OtherDeduction),
    totalDeduction: toNum(row.TotalDeduction),
    netSalary: toNum(row.NetSalary),
    chequeAmount: calculateChequeAmount({
      netSalary: toNum(row.NetSalary),
      incomeTax: toNum(row.IncomeTax),
      professionalTax: toNum(row.ProfessionalTax),
    }),
    instituteCode: row.InstituteCode || "",
  };
}

function lockedEmployeeMessage(billCode) {
  return `Bill Code ${billCode} is locked and employee salary data cannot be modified.`;
}

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

async function getEmployeesByBillCodeId(billCodeId, transaction = null) {
  const request = makeRequest(transaction);
  const result = await request.query`
    SELECT *
    FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${billCodeId}
    ORDER BY DisplayOrder ASC, EmployeeId ASC
  `;
  return result.recordset.map(mapEmployeeRow);
}

async function insertEmployeeRow(transaction, billCodeId, employee, displayOrder, instituteCode) {
  const totals = calcTotals(employee);
  const employeeId = Number(employee.employeeId);
  const name = employee.employeeName || `Employee ${employeeId}`;
  const designation = employee.designation || "";
  const employeeType = employee.employeeType || "";
  const orderNo = Number(displayOrder) || 1;
  const institute = instituteCode || employee.instituteCode || null;
  const request = makeRequest(transaction);

  await request.query`
    INSERT INTO dbo.SalaryEmployeeDetails
      (
        SalaryBillCodeId, EmployeeId, EmployeeName, Designation, EmployeeType, DisplayOrder,
        BasicPay, GradePay, TotalBasic, DA, HRA, MA, TA, SpecialAllowance, WashingAllowance, GrossSalary,
        GPFSubscription, GPFAdvance, NPS, IncomeTax, ProfessionalTax, OtherDeduction, TotalDeduction, NetSalary,
        ChequeAmount, InstituteCode
      )
    VALUES
      (
        ${billCodeId},
        ${employeeId},
        ${name},
        ${designation},
        ${employeeType},
        ${orderNo},
        ${totals.basicPay},
        ${totals.gradePay},
        ${totals.totalBasic},
        ${totals.da},
        ${totals.hra},
        ${totals.ma},
        ${totals.ta},
        ${totals.specialAllowance},
        ${totals.washingAllowance},
        ${totals.grossSalary},
        ${totals.gpfSubscription},
        ${totals.gpfAdvance},
        ${totals.nps},
        ${totals.incomeTax},
        ${totals.professionalTax},
        ${totals.otherDeduction},
        ${totals.totalDeduction},
        ${totals.netSalary},
        ${totals.chequeAmount},
        ${institute}
      )
  `;
}

async function replaceEmployeesForBill(transaction, billCodeId, employees, instituteCode) {
  const deleteChildren = makeRequest(transaction);
  await deleteChildren.query`
    DELETE secd
    FROM dbo.SalaryEmployeeComponentDetails secd
    INNER JOIN dbo.SalaryEmployeeDetails sed ON sed.Id = secd.SalaryEmployeeDetailId
    WHERE sed.SalaryBillCodeId = ${billCodeId}
  `;

  const deleteRequest = makeRequest(transaction);
  await deleteRequest.query`
    DELETE FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${billCodeId}
  `;

  const list = Array.isArray(employees) ? employees : [];
  for (let i = 0; i < list.length; i += 1) {
    const employee = list[i];
    const order =
      employee.displayOrder != null ? Number(employee.displayOrder) : i + 1;
    await insertEmployeeRow(transaction, billCodeId, employee, order, instituteCode);
  }
}

async function copyEmployeesBetweenBills(transaction, sourceBillCodeId, targetBillCodeId) {
  const request = makeRequest(transaction);
  await request.query`
    INSERT INTO dbo.SalaryEmployeeDetails
      (
        SalaryBillCodeId, EmployeeId, EmployeeName, Designation, EmployeeType, DisplayOrder,
        BasicPay, GradePay, TotalBasic, DA, HRA, MA, TA, SpecialAllowance, WashingAllowance, GrossSalary,
        GPFSubscription, GPFAdvance, NPS, IncomeTax, ProfessionalTax, OtherDeduction, TotalDeduction, NetSalary,
        ChequeAmount, InstituteCode
      )
    SELECT
      ${targetBillCodeId},
      EmployeeId,
      EmployeeName,
      Designation,
      EmployeeType,
      DisplayOrder,
      BasicPay,
      GradePay,
      (BasicPay + GradePay),
      DA,
      HRA,
      MA,
      TA,
      SpecialAllowance,
      WashingAllowance,
      ((BasicPay + GradePay) + DA + HRA + MA + TA + SpecialAllowance + WashingAllowance),
      GPFSubscription,
      GPFAdvance,
      NPS,
      IncomeTax,
      ProfessionalTax,
      OtherDeduction,
      (GPFSubscription + GPFAdvance + NPS + IncomeTax + ProfessionalTax + OtherDeduction),
      (
        ((BasicPay + GradePay) + DA + HRA + MA + TA + SpecialAllowance + WashingAllowance)
        - (GPFSubscription + GPFAdvance + NPS + IncomeTax + ProfessionalTax + OtherDeduction)
      ),
      (
        (
          ((BasicPay + GradePay) + DA + HRA + MA + TA + SpecialAllowance + WashingAllowance)
          - (GPFSubscription + GPFAdvance + NPS + IncomeTax + ProfessionalTax + OtherDeduction)
        )
        + ISNULL(IncomeTax, 0)
        + ISNULL(ProfessionalTax, 0)
      ),
      InstituteCode
    FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${sourceBillCodeId}
  `;
}

async function withTransaction(work) {
  const transaction = new sql.Transaction();
  await transaction.begin();
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (_) {
      /* ignore rollback errors */
    }
    throw error;
  }
}

module.exports = {
  toNum,
  calcTotals,
  mapEmployeeRow,
  lockedEmployeeMessage,
  getEmployeesByBillCodeId,
  insertEmployeeRow,
  replaceEmployeesForBill,
  copyEmployeesBetweenBills,
  withTransaction,
};
