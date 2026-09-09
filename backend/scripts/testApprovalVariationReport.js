/**
 * Salary Approval Variation Report — previous salary month vs current.
 * Usage: node scripts/testApprovalVariationReport.js
 */
/* Phase 9: no credential literal in tests. Supply the password via the
   environment; the suite reports BLOCKED when it is not configured. */
const TEST_ADMIN_PASSWORD = String(
  process.env.TEST_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || ""
).trim();

require("dotenv").config();
const assert = require("assert");
const { connectDB, sql } = require("../db");
const { buildSalaryVariationReport } = require("../utils/salaryVariationReport");

function check(name, cond) {
  assert.ok(cond, name);
  console.log(`  PASS  ${name}`);
}

async function login() {
  for (const [u, p] of [
    ["admin", TEST_ADMIN_PASSWORD],
    ["Admin", TEST_ADMIN_PASSWORD],
  ]) {
    const res = await fetch("http://127.0.0.1:5000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: u, password: p }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.token || data.data?.token;
  }
  throw new Error("Admin login failed");
}

async function api(token, path) {
  const res = await fetch(`http://127.0.0.1:5000${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("Approval Variation Report tests\n");
  await connectDB();

  const unit = await buildSalaryVariationReport({
    billCode: "JAN-2027",
    instituteCode: "CPD-06",
    compareMode: "previousSalaryMonth",
  }).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });

  if (!unit) {
    /* Fall back to any approved/submitted bill with SED rows */
    const pick = await sql.query`
      SELECT TOP 1 b.BillCode, d.InstituteCode
      FROM dbo.SalaryEmployeeDetails d
      INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
      WHERE UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      ORDER BY b.SalaryYear DESC, TRY_CONVERT(INT, b.SalaryMonthNumber) DESC
    `;
    if (!pick.recordset[0]) {
      console.log("SKIP: no salary detail rows");
      process.exit(0);
    }
    const report = await buildSalaryVariationReport({
      billCode: pick.recordset[0].BillCode,
      instituteCode: pick.recordset[0].InstituteCode,
      compareMode: "previousSalaryMonth",
    });
    runAssertions(report);
  } else {
    runAssertions(unit);
  }

  const token = await login();
  const sample = await sql.query`
    SELECT TOP 1 b.BillCode, d.InstituteCode
    FROM dbo.SalaryEmployeeDetails d
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = d.SalaryBillCodeId
    WHERE UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
    ORDER BY b.SalaryYear DESC, TRY_CONVERT(INT, b.SalaryMonthNumber) DESC
  `;
  const billCode = sample.recordset[0].BillCode;
  const instituteCode = sample.recordset[0].InstituteCode;

  const aoApi = await api(
    token,
    `/api/salary-bill-approval/variation-report?billCode=${encodeURIComponent(
      billCode
    )}&instituteCode=${encodeURIComponent(instituteCode)}`
  );
  check("AO variation API → 200", aoApi.status === 200);
  const data = aoApi.data.data || aoApi.data;
  check("API returns comparisonRows", Array.isArray(data.comparisonRows));
  check("API returns fields catalog", Array.isArray(data.fields) && data.fields.length >= 10);
  check(
    "API includes chequeAmount field",
    data.fields.some((f) => f.key === "chequeAmount")
  );

  console.log("\nAll Approval Variation Report tests passed.");
  process.exit(0);
}

function runAssertions(report) {
  check("report has comparisonRows", Array.isArray(report.comparisonRows));
  check("report has fields", Array.isArray(report.fields) && report.fields.length > 0);
  check(
    "fields include Salary Entry components",
    ["basicPay", "da", "hra", "ma", "ta", "cla", "grossSalary", "nps", "netSalary", "chequeAmount"].every(
      (k) => report.fields.some((f) => f.key === k)
    )
  );

  for (const row of report.comparisonRows) {
    check(`employeeId present (${row.employeeId})`, Number(row.employeeId) > 0);
    for (const field of report.fields) {
      const c = row.components[field.key];
      assert.ok(c, `missing component ${field.key}`);
      const expected = Number((c.current - c.previous).toFixed(2));
      assert.strictEqual(
        Number(c.variation.toFixed(2)),
        expected,
        `${row.employeeId} ${field.key} variation mismatch`
      );
    }
  }
  console.log(
    `  PASS  Variation = Current - Previous for ${report.comparisonRows.length} employee(s)`
  );

  if (report.fieldTotals) {
    const net = report.fieldTotals.netSalary;
    check("fieldTotals.netSalary present", !!net);
  }

  /* Emp 2002 if present */
  const emp2002 = report.comparisonRows.find((r) => Number(r.employeeId) === 2002);
  if (emp2002) {
    console.log("  INFO  Employee 2002 row:", {
      basicPrev: emp2002.components.basicPay.previous,
      basicCurr: emp2002.components.basicPay.current,
      basicVar: emp2002.components.basicPay.variation,
      hraPrev: emp2002.components.hra.previous,
      hraCurr: emp2002.components.hra.current,
      hraVar: emp2002.components.hra.variation,
    });
    check("Employee 2002 matched by EmployeeId", emp2002.employeeId === 2002);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
