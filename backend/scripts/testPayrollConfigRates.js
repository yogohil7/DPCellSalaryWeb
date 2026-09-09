require("dotenv").config();
const { connectDB, sql } = require("../db");
const { calculateForEmployee } = require("../routes/salaryCalculate");

(async () => {
  await connectDB();

  const medCols = await sql.query`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'MedicalAllowanceMaster' ORDER BY ORDINAL_POSITION
  `;
  console.log("MA cols:", medCols.recordset.map((r) => r.COLUMN_NAME));

  const taCols = await sql.query`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TransportAllowanceMaster' ORDER BY ORDINAL_POSITION
  `;
  console.log("TA cols:", taCols.recordset.map((r) => r.COLUMN_NAME));

  /* Seed minimal rates if empty (non-destructive) */
  const medCount = await sql.query`SELECT COUNT(1) AS C FROM dbo.MedicalAllowanceMaster`;
  if (Number(medCount.recordset[0].C) === 0) {
    try {
      await sql.query`
        INSERT INTO dbo.MedicalAllowanceMaster
          (SrNo, AllowanceName, Amount, EffectiveFrom, Status, CreatedBy)
        VALUES
          (1, N'Medical Allowance', 1000, '2020-01-01', N'Active', N'EPC_TEST')
      `;
      console.log("Seeded MedicalAllowanceMaster Amount=1000");
    } catch (e) {
      console.warn("MA seed skipped:", e.message);
    }
  }

  const taCount = await sql.query`SELECT COUNT(1) AS C FROM dbo.TransportAllowanceMaster`;
  if (Number(taCount.recordset[0].C) === 0) {
    try {
      await sql.query`
        INSERT INTO dbo.TransportAllowanceMaster
          (EffectiveDate, PayLevelGroup, CityClass, TAAmount, Description, Status, CreatedBy)
        VALUES
          ('2020-01-01', N'All', N'Z', 1600, N'Test TA', N'Active', N'EPC_TEST')
      `;
      console.log("Seeded TransportAllowanceMaster TAAmount=1600");
    } catch (e) {
      console.warn("TA seed skipped:", e.message);
    }
  }

  const empId = 1;
  const active = await sql.query`
    SELECT TOP 1 Id FROM dbo.EmployeePayrollConfiguration
    WHERE EmployeeId = ${empId} AND IsActive = 1
  `;
  const id = active.recordset[0]?.Id;

  const save = async (ma, ta) => {
    const r = new sql.Request();
    r.input("Id", sql.Int, id);
    r.input("EmployeeId", sql.Int, empId);
    r.input("MedicalAllowanceApplicable", sql.Bit, ma ? 1 : 0);
    r.input("TransportAllowanceApplicable", sql.Bit, ta ? 1 : 0);
    r.input("HraPreviousLocationApplicable", sql.Bit, 0);
    r.input("ProfessionalTaxApplicable", sql.Bit, 0);
    r.input("NppaApplicable", sql.NVarChar(10), "NA");
    r.input("EffectiveFrom", sql.Date, new Date().toISOString().slice(0, 10));
    r.input("EffectiveTo", sql.Date, null);
    r.input("IsActive", sql.Bit, 1);
    r.input("Actor", sql.NVarChar(100), "TEST");
    await r.execute("usp_EmployeePayrollConfiguration_Save");
  };

  await save(true, true);
  let calc = await calculateForEmployee(empId);
  console.log("WITH rates MA+TA YES:", {
    basic: calc.basicPay,
    ma: calc.earnings.ma,
    ta: calc.earnings.ta,
  });

  await save(false, false);
  calc = await calculateForEmployee(empId);
  console.log("WITH rates MA+TA NO:", {
    basic: calc.basicPay,
    ma: calc.earnings.ma,
    ta: calc.earnings.ta,
  });

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
