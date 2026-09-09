require("dotenv").config();
const { connectDB, sql } = require("../db");
const { calculateForEmployee } = require("../routes/salaryCalculate");

async function saveFlags(employeeId, id, flags) {
  const saveReq = new sql.Request();
  saveReq.input("Id", sql.Int, id);
  saveReq.input("EmployeeId", sql.Int, employeeId);
  saveReq.input("MedicalAllowanceApplicable", sql.Bit, flags.ma ? 1 : 0);
  saveReq.input("TransportAllowanceApplicable", sql.Bit, flags.ta ? 1 : 0);
  saveReq.input("HraPreviousLocationApplicable", sql.Bit, flags.hraPrev ? 1 : 0);
  saveReq.input("ProfessionalTaxApplicable", sql.Bit, flags.pt ? 1 : 0);
  saveReq.input("NppaApplicable", sql.NVarChar(10), flags.nppa || "NA");
  saveReq.input("EffectiveFrom", sql.Date, new Date().toISOString().slice(0, 10));
  saveReq.input("EffectiveTo", sql.Date, null);
  saveReq.input("IsActive", sql.Bit, 1);
  saveReq.input("Actor", sql.NVarChar(100), "TEST");
  const result = await saveReq.execute("usp_EmployeePayrollConfiguration_Save");
  return result.recordset?.[0]?.Id;
}

(async () => {
  await connectDB();
  const empId = 1;

  let active = await sql.query`
    SELECT TOP 1 Id FROM dbo.EmployeePayrollConfiguration
    WHERE EmployeeId = ${empId} AND IsActive = 1
  `;
  let id = active.recordset[0]?.Id || null;

  id = await saveFlags(empId, id, { ma: true, ta: true });
  let calc = await calculateForEmployee(empId);
  console.log("MA+TA YES:", {
    basic: calc.basicPay,
    ma: calc.earnings.ma,
    ta: calc.earnings.ta,
    config: calc.payrollConfig,
  });

  id = await saveFlags(empId, id, { ma: false, ta: false });
  calc = await calculateForEmployee(empId);
  console.log("MA+TA NO:", {
    basic: calc.basicPay,
    ma: calc.earnings.ma,
    ta: calc.earnings.ta,
    config: calc.payrollConfig,
  });

  const med = await sql.query`SELECT TOP 3 Amount, Status, EffectiveFrom FROM dbo.MedicalAllowanceMaster`;
  const ta = await sql.query`SELECT TOP 3 TAAmount, Status, EffectiveDate FROM dbo.TransportAllowanceMaster`;
  console.log("MedicalAllowanceMaster:", med.recordset);
  console.log("TransportAllowanceMaster:", ta.recordset);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
