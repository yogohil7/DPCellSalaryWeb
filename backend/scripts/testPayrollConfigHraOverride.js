/**
 * Regression: Payroll Configuration HRA/MA/TA override in Salary Entry calc.
 * Tests 1–5 from business rules + live employee 2002 JAN-2027.
 *
 * Usage: node scripts/testPayrollConfigHraOverride.js
 */
require("dotenv").config();
const assert = require("assert");
const {
  defaultPayrollConfig,
  isHraApplicable,
  isHraForcedZero,
  loadActivePayrollConfig,
} = require("../utils/payrollConfig");
const { calculateSalaryAmounts } = require("../utils/salaryBasicCalc");

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  section("Unit: polarity helpers + salaryBasicCalc");

  const yesCfg = { hraPreviousLocationApplicable: true };
  const noCfg = { hraPreviousLocationApplicable: false };
  assert.strictEqual(isHraApplicable(yesCfg), true);
  assert.strictEqual(isHraForcedZero(yesCfg), false);
  assert.strictEqual(isHraApplicable(noCfg), false);
  assert.strictEqual(isHraForcedZero(noCfg), true);
  assert.strictEqual(isHraApplicable(null), true);
  assert.strictEqual(isHraForcedZero(defaultPayrollConfig()), false);
  assert.strictEqual(defaultPayrollConfig().hraPreviousLocationApplicable, true);
  assert.strictEqual(defaultPayrollConfig().medicalAllowanceApplicable, true);
  assert.strictEqual(defaultPayrollConfig().transportAllowanceApplicable, true);

  /* payrollHra=true means force HRA=0 (HRA NO) */
  const withHra = calculateSalaryAmounts({
    basic: 34400,
    daPercentage: 55,
    hraPercentage: 24,
    payrollHra: false,
  });
  const withoutHra = calculateSalaryAmounts({
    basic: 34400,
    daPercentage: 55,
    hraPercentage: 24,
    payrollHra: true,
  });
  assert.ok(withHra.hra > 0, "TEST1: HRA YES must calculate");
  assert.strictEqual(withoutHra.hra, 0, "TEST2: HRA NO must be 0");
  console.log("OK unit polarity + basic calc");

  const { connectDB, sql } = require("../db");
  await connectDB();
  const { calculateForEmployee } = require("../routes/salaryCalculate");

  section("TEST 4: default when no employee config");
  const fakeId = 999999001;
  const def = await loadActivePayrollConfig(fakeId, "2027-01-01");
  assert.strictEqual(def.isDefault, true);
  assert.strictEqual(isHraForcedZero(def), false);
  console.log("OK default HRA YES");

  section("TEST 2 + 5: Employee 2002 JAN-2027 (HRA NO, MA YES, TA YES)");
  const cfg2002 = await loadActivePayrollConfig(2002, "2027-01-01");
  assert.strictEqual(cfg2002.isDefault, false);
  assert.strictEqual(cfg2002.hraPreviousLocationApplicable, false);
  assert.strictEqual(cfg2002.medicalAllowanceApplicable, true);
  assert.strictEqual(cfg2002.transportAllowanceApplicable, true);
  assert.strictEqual(isHraForcedZero(cfg2002), true);

  const calc2002 = await calculateForEmployee(2002, "2027-01-01");
  assert.strictEqual(Number(calc2002.earnings.hra), 0, "emp 2002 HRA must be 0");
  assert.ok(
    Number(calc2002.earnings.ma) > 0,
    "emp 2002 MA must calculate when YES"
  );
  assert.ok(
    Number(calc2002.earnings.ta) > 0,
    "emp 2002 TA must calculate when YES"
  );
  assert.strictEqual(calc2002.payrollConfig.houseRentAllowanceYes, false);
  assert.strictEqual(calc2002.payrollConfig.hraForcedZero, true);
  console.log("OK emp 2002 JAN-2027", {
    hra: calc2002.earnings.hra,
    ma: calc2002.earnings.ma,
    ta: calc2002.earnings.ta,
  });

  section("TEST 1: employee with HRA YES calculates HRA");
  const yesRow = await sql.query`
    SELECT TOP 1 EmployeeId
    FROM dbo.EmployeePayrollConfiguration
    WHERE HraPreviousLocationApplicable = 1
      AND EffectiveFrom <= '2027-01-01'
      AND (EffectiveTo IS NULL OR EffectiveTo >= '2027-01-01')
    ORDER BY Id DESC
  `;
  if (yesRow.recordset[0]) {
    const eid = yesRow.recordset[0].EmployeeId;
    const calcYes = await calculateForEmployee(eid, "2027-01-01");
    assert.strictEqual(calcYes.payrollConfig.hraForcedZero, false);
    assert.ok(
      Number(calcYes.earnings.hra) > 0 ||
        Number(calcYes.earnings.basicPay) === 0,
      `emp ${eid} HRA YES should calculate when basic exists`
    );
    console.log(`OK emp ${eid} HRA YES →`, calcYes.earnings.hra);
  } else {
    console.log("SKIP TEST1: no HRA=YES config row for JAN-2027 in DB");
  }

  section("TEST 3: EffectiveFrom as-of selection (synthetic)");
  /* Use transaction + rollback so we never leave duplicate/test data. */
  const tx = new sql.Transaction();
  await tx.begin();
  try {
    const probe = await new sql.Request(tx).query`
      SELECT TOP 1 EmployeeId FROM dbo.EmployeeMaster
      WHERE EmployeeId NOT IN (
        SELECT EmployeeId FROM dbo.EmployeePayrollConfiguration
      )
      AND ISNULL(IsActive, 1) = 1
      ORDER BY EmployeeId
    `;
    const probeId = probe.recordset[0]?.EmployeeId;
    if (!probeId) {
      console.log("SKIP TEST3: no employee without existing payroll config");
    } else {
      await new sql.Request(tx).query`
        INSERT INTO dbo.EmployeePayrollConfiguration (
          EmployeeId, MedicalAllowanceApplicable, TransportAllowanceApplicable,
          HraPreviousLocationApplicable, ProfessionalTaxApplicable, NppaApplicable,
          EffectiveFrom, EffectiveTo, IsActive, CreatedBy
        ) VALUES (
          ${probeId}, 1, 1, 1, 0, N'NA',
          '2026-01-01', '2026-07-31', 0, N'TEST_HRA'
        )
      `;
      await new sql.Request(tx).query`
        INSERT INTO dbo.EmployeePayrollConfiguration (
          EmployeeId, MedicalAllowanceApplicable, TransportAllowanceApplicable,
          HraPreviousLocationApplicable, ProfessionalTaxApplicable, NppaApplicable,
          EffectiveFrom, EffectiveTo, IsActive, CreatedBy
        ) VALUES (
          ${probeId}, 1, 1, 0, 0, N'NA',
          '2026-08-01', NULL, 1, N'TEST_HRA'
        )
      `;

      const before = await new sql.Request(tx).query`
        SELECT TOP 1 HraPreviousLocationApplicable, EffectiveFrom, IsActive
        FROM dbo.EmployeePayrollConfiguration
        WHERE EmployeeId = ${probeId}
          AND EffectiveFrom <= '2026-06-01'
          AND (EffectiveTo IS NULL OR EffectiveTo >= '2026-06-01')
        ORDER BY EffectiveFrom DESC, Id DESC
      `;
      const after = await new sql.Request(tx).query`
        SELECT TOP 1 HraPreviousLocationApplicable, EffectiveFrom, IsActive
        FROM dbo.EmployeePayrollConfiguration
        WHERE EmployeeId = ${probeId}
          AND EffectiveFrom <= '2027-01-01'
          AND (EffectiveTo IS NULL OR EffectiveTo >= '2027-01-01')
        ORDER BY EffectiveFrom DESC, Id DESC
      `;
      assert.strictEqual(
        before.recordset[0].HraPreviousLocationApplicable,
        true,
        "before EffectiveFrom change → HRA YES"
      );
      assert.strictEqual(
        after.recordset[0].HraPreviousLocationApplicable,
        false,
        "on/after EffectiveFrom → HRA NO"
      );
      console.log("OK as-of EffectiveFrom history for emp", probeId);
    }
  } finally {
    await tx.rollback();
  }

  console.log("\nAll payroll HRA override tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
